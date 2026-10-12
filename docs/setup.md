# Setup

How to install `socialcalc-mcp`, connect it to an AI client, and run it from source.

## Requirements

| Requirement | Notes |
| :--- | :--- |
| Node.js | 18 or newer |
| npm | Ships with Node.js |
| An MCP client | Claude Desktop, Claude Code, Cursor, VS Code, Windsurf, or any client that can launch a stdio MCP server |

## Option A: use the published package (recommended)

Nothing to install. Configure your client to run the package through `npx`:

```json
{
  "mcpServers": {
    "socialcalc-mcp": {
      "command": "npx",
      "args": ["-y", "socialcalc-mcp"]
    }
  }
}
```

`-y` makes `npx` download the package without asking. To pin a version, use `"socialcalc-mcp@1.0.6"` in `args`.

To install it globally instead:

```bash
npm install -g socialcalc-mcp
# then use "command": "socialcalc-mcp" with no args
```

### Where the config goes

| Client | File or command |
| :--- | :--- |
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Code | `claude mcp add socialcalc-mcp -- npx -y socialcalc-mcp` |
| Cursor | `~/.cursor/mcp.json`, or `.cursor/mcp.json` in a project |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| VS Code | `.vscode/mcp.json`, which uses a `servers` key and `"type": "stdio"` |

The VS Code format differs from the others:

```json
{
  "servers": {
    "socialcalc-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "socialcalc-mcp"]
    }
  }
}
```

Restart the client after editing its configuration.

## Option B: install from GitHub Packages

The same package is mirrored to GitHub Packages as `@aspiringsdgs/socialcalc-mcp`. GitHub's npm registry requires a token even for public packages.

1. Create a personal access token (classic) with the `read:packages` scope.
2. Add to your user `~/.npmrc`:

   ```ini
   @aspiringsdgs:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=YOUR_TOKEN
   ```

3. Install it:

   ```bash
   npm install -g @aspiringsdgs/socialcalc-mcp
   ```

Unless you need GitHub Packages specifically, prefer Option A.

## Option C: run from source

```bash
git clone https://github.com/aspiringsdgs/socialcalc-mcp.git
cd socialcalc-mcp
npm install
npm run build
```

Point a client at the compiled entry point:

```json
{
  "mcpServers": {
    "socialcalc-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/socialcalc-mcp/dist/index.js"]
    }
  }
}
```

Useful scripts:

| Command | What it does |
| :--- | :--- |
| `npm run build` | Compiles `src/` to `dist/` with `tsc` |
| `npm start` | Runs `dist/index.js` |
| `npm run dev` | Runs `src/index.ts` directly with `tsx` |

## Verify the connection

1. Ask the client: "List the tools on the socialcalc-mcp server." You should see 39 tools.
2. Ask it to run `new_workbook` with a path inside your allowed directory (see [Configuration](#configuration)), then `write_range` and `read_sheet` on it.

You can also check the server without a client by enabling the HTTP bridge:

```bash
SOCIALCALC_HTTP_TOKEN=local-secret npx -y socialcalc-mcp --http &
curl -H "Authorization: Bearer local-secret" http://127.0.0.1:5002/tools
```

## Configuration

| Setting | How | Default |
| :--- | :--- | :--- |
| Allowed directory | `SOCIALCALC_FILES_DIR` environment variable | The server's working directory |
| Default for `list_workbooks` | `directoryPath` argument | `data/` inside the allowed directory |
| HTTP bridge | `--http` flag or `SOCIALCALC_HTTP=1` | Off |
| HTTP bridge port | `SOCIALCALC_PORT` | `5002` |
| HTTP bridge address | `SOCIALCALC_HOST` | `127.0.0.1` |
| HTTP bridge token | `SOCIALCALC_HTTP_TOKEN` | Random, printed to stderr at startup |
| Browser origins allowed to call the bridge | `SOCIALCALC_CORS_ORIGINS` (comma-separated) | None |

Tools can only read and write files inside the allowed directory. GUI clients do not start the server in your project folder, so set it explicitly:

```json
{
  "mcpServers": {
    "socialcalc-mcp": {
      "command": "npx",
      "args": ["-y", "socialcalc-mcp"],
      "env": { "SOCIALCALC_FILES_DIR": "/Users/you/Documents/sheets" }
    }
  }
}
```

## Troubleshooting

| Symptom | Cause and fix |
| :--- | :--- |
| Client shows the server as failed or disconnected | Run `npx -y socialcalc-mcp` in a terminal and read stderr. Check that `node --version` is 18 or newer and that your client can find `npx` on its `PATH`. |
| `[Warning] HTTP server port 5002 is already in use` | The HTTP bridge is enabled and another process holds the port. Stdio still works. Set `SOCIALCALC_PORT` to a free port. |
| HTTP bridge returns `401` | Send `Authorization: Bearer <token>`. If you did not set `SOCIALCALC_HTTP_TOKEN`, the generated token is printed to stderr at startup |
| A browser page cannot reach the bridge | Add its origin to `SOCIALCALC_CORS_ORIGINS` and send the token and `Content-Type: application/json` |
| `Access denied: ... is outside the allowed directory` | The file is outside `SOCIALCALC_FILES_DIR` (or the working directory). Move it inside, or point `SOCIALCALC_FILES_DIR` at its folder |
| Tools say a file cannot be found | Relative paths resolve against the allowed directory, which for GUI clients is not your project. Set `SOCIALCALC_FILES_DIR` |
| `Invalid file extension` | Core tools only open `.json` and `.msc` workbooks. Import CSV files with `import_from_csv` first. |
| `XLSX export is not implemented` | `export_to_xlsx` and `import_from_xlsx` are placeholders in this version. Use CSV. |
| Changes made by a tool are not visible in a browser UI | Tools write the workbook file on disk. Reload the file in your UI, or use the HTTP bridge's `/read-file` endpoint. |
| `npm error 404` when installing `@aspiringsdgs/socialcalc-mcp` | The `.npmrc` registry line for the `@aspiringsdgs` scope is missing, or the token lacks `read:packages`. |
