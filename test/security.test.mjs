// Regression tests for file confinement and the HTTP bridge defaults.
// Run with: npm test   (builds first, then runs this file with node:test)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, existsSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const { resolveInside } = await import(DIST + "utils/paths.js");

const sandbox = realpathSync(mkdtempSync(join(tmpdir(), "socialcalc-mcp-test-")));
const root = join(sandbox, "files");
const outside = join(sandbox, "outside");
mkdirSync(root);
mkdirSync(outside);
after(() => rmSync(sandbox, { recursive: true, force: true }));

test("resolveInside accepts paths inside the root, including files that do not exist yet", () => {
  assert.equal(resolveInside("a.json", root), join(root, "a.json"));
  assert.equal(resolveInside("sub/dir/new.json", root), join(root, "sub", "dir", "new.json"));
  assert.equal(resolveInside(join(root, "abs.json"), root), join(root, "abs.json"));
});

test("resolveInside rejects traversal, absolute paths outside, and sibling-prefix directories", () => {
  assert.throws(() => resolveInside("../outside/x.json", root), /Access denied/);
  assert.throws(() => resolveInside(join(outside, "x.json"), root), /Access denied/);
  assert.throws(() => resolveInside("/etc/passwd", root), /Access denied/);
  const sibling = root + "-evil";
  mkdirSync(sibling);
  assert.throws(() => resolveInside(join(sibling, "x.json"), root), /Access denied/);
  assert.throws(() => resolveInside("a\0.json", root), /Invalid path/);
});

test("resolveInside rejects symlinks that point outside the root", () => {
  symlinkSync(outside, join(root, "link"));
  assert.throws(() => resolveInside("link/x.json", root), /Access denied/);
  symlinkSync(join(outside, "not-created.json"), join(root, "dangling.json"));
  assert.throws(() => resolveInside("dangling.json", root), /Access denied/);
});

// --- running server ---------------------------------------------------------

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function startServer(extraArgs, env) {
  const child = spawn(process.execPath, [DIST + "index.js", ...extraArgs], {
    env: { ...process.env, SOCIALCALC_FILES_DIR: root, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start: " + stderr)), 8000);
    const check = setInterval(() => {
      if (stderr.includes("running on stdio")) {
        clearTimeout(timer);
        clearInterval(check);
        resolve();
      }
    }, 50);
  });
  return { child, ready, log: () => stderr };
}

test("HTTP bridge is off unless enabled", async () => {
  const port = await freePort();
  const srv = startServer([], { SOCIALCALC_PORT: String(port) });
  await srv.ready;
  const open = await new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1");
    sock.on("connect", () => { sock.destroy(); resolve(true); });
    sock.on("error", () => resolve(false));
  });
  srv.child.kill();
  assert.equal(open, false);
  assert.doesNotMatch(srv.log(), /HTTP bridge listening/);
});

test("HTTP bridge: loopback bind, bearer token, JSON only, no CORS by default, files confined", async () => {
  const port = await freePort();
  const token = "test-token-123";
  const srv = startServer(["--http"], { SOCIALCALC_PORT: String(port), SOCIALCALC_HTTP_TOKEN: token });
  await srv.ready;
  const base = `http://127.0.0.1:${port}`;
  const auth = { Authorization: `Bearer ${token}` };
  const json = { "Content-Type": "application/json", ...auth };
  try {
    assert.match(srv.log(), new RegExp(`listening on http://127\\.0\\.0\\.1:${port}`));

    // no token / wrong token
    assert.equal((await fetch(base + "/tools")).status, 401);
    assert.equal((await fetch(base + "/tools", { headers: { Authorization: "Bearer nope" } })).status, 401);

    // token works, and no wildcard CORS header is sent
    const ok = await fetch(base + "/tools", { headers: { ...auth, Origin: "https://evil.example" } });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("access-control-allow-origin"), null);
    assert.equal((await ok.json()).tools.length, 39);

    // a "simple" cross-site POST (text/plain) is rejected even with a token
    const plain = await fetch(base + "/call", { method: "POST", headers: { ...auth, "Content-Type": "text/plain" }, body: "{}" });
    assert.equal(plain.status, 415);

    // /call cannot create files outside the root
    const target = join(outside, "pwned.json");
    const call = await fetch(base + "/call", {
      method: "POST", headers: json,
      body: JSON.stringify({ name: "new_workbook", arguments: { workbookPath: target } }),
    });
    assert.match((await call.json()).content[0].text, /Access denied/);
    assert.equal(existsSync(target), false);

    // ...but can inside it
    const inside = await fetch(base + "/call", {
      method: "POST", headers: json,
      body: JSON.stringify({ name: "new_workbook", arguments: { workbookPath: "ok.json" } }),
    });
    assert.equal((await inside.json()).isError, undefined);
    assert.equal(existsSync(join(root, "ok.json")), true);

    // /sync and /read-file are confined too
    const sync = await fetch(base + "/sync", {
      method: "POST", headers: json,
      body: JSON.stringify({ workbookPath: "../outside/synced.json", mscData: { a: 1 } }),
    });
    assert.equal(sync.status, 400);
    assert.equal(existsSync(join(outside, "synced.json")), false);
    writeFileSync(join(outside, "secret.json"), "{}");
    const read = await fetch(base + "/read-file?path=" + encodeURIComponent(join(outside, "secret.json")), { headers: auth });
    assert.equal(read.status, 400);
  } finally {
    srv.child.kill();
  }
});

test("HTTP bridge: only listed origins get CORS headers; token is generated when unset", async () => {
  const port = await freePort();
  const srv = startServer(["--http"], { SOCIALCALC_PORT: String(port), SOCIALCALC_CORS_ORIGINS: "http://localhost:3000" });
  await srv.ready;
  try {
    const m = srv.log().match(/HTTP bridge token: (\S+)/);
    assert.ok(m, "a token should be printed when none is configured");
    const headers = { Authorization: `Bearer ${m[1]}` };
    const base = `http://127.0.0.1:${port}`;

    const allowed = await fetch(base + "/tools", { headers: { ...headers, Origin: "http://localhost:3000" } });
    assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:3000");

    const other = await fetch(base + "/tools", { headers: { ...headers, Origin: "http://evil.example" } });
    assert.equal(other.headers.get("access-control-allow-origin"), null);
  } finally {
    srv.child.kill();
  }
});

test("stdio tools are confined as well", async () => {
  const { SocialcalcMcpServer } = await import(DIST + "server.js");
  process.env.SOCIALCALC_FILES_DIR = root;
  const server = new SocialcalcMcpServer();

  const denied = await server.executeTool("new_workbook", { workbookPath: join(outside, "x.json") });
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /Access denied/);

  const csv = await server.executeTool("export_to_csv", { workbookPath: "ok.json", csvPath: "../outside/x.csv" });
  assert.equal(csv.isError, true);

  const listing = await server.executeTool("list_workbooks", { directoryPath: "/etc" });
  assert.equal(listing.isError, true);

  const allowed = await server.executeTool("list_workbooks", { directoryPath: "." });
  assert.equal(allowed.isError, undefined);
});
