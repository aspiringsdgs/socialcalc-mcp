import * as fs from "fs";
import * as path from "path";

/**
 * Directory that every tool call and HTTP route is confined to.
 * Set SOCIALCALC_FILES_DIR to choose it; otherwise the server's working directory is used.
 */
export function getFilesRoot(): string {
  const configured = process.env.SOCIALCALC_FILES_DIR?.trim();
  return path.resolve(configured ? configured : process.cwd());
}

/**
 * Resolves `target` through symlinks as far as it exists, then re-appends the part
 * that does not exist yet (for example a file that is about to be created).
 */
function realpathOfExistingPrefix(target: string): string {
  let current = target;
  const missing: string[] = [];

  for (;;) {
    try {
      const real = fs.realpathSync(current);
      return missing.length ? path.join(real, ...missing.reverse()) : real;
    } catch (err: any) {
      if (err.code !== "ENOENT" && err.code !== "ENOTDIR") throw err;

      // A symlink whose target is missing would let a write land outside the root.
      try {
        fs.lstatSync(current);
        throw new Error(`Access denied: '${current}' is a broken symbolic link.`);
      } catch (statErr: any) {
        if (statErr.code !== "ENOENT" && statErr.code !== "ENOTDIR") throw statErr;
      }

      const parent = path.dirname(current);
      if (parent === current) return target;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  if (rel === "") return true;
  return rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
}

/**
 * Resolves a user-supplied path against the files root and rejects anything that
 * ends up outside it, including `..` segments, absolute paths and symlinks.
 * Returns the absolute, symlink-resolved path.
 */
export function resolveInside(requested: string, root: string = getFilesRoot()): string {
  if (typeof requested !== "string" || requested.length === 0 || requested.includes("\0")) {
    throw new Error("Invalid path.");
  }

  const rootReal = realpathOfExistingPrefix(path.resolve(root));
  const candidate = realpathOfExistingPrefix(path.resolve(rootReal, requested));

  if (!isInside(rootReal, candidate)) {
    throw new Error(
      `Access denied: '${requested}' is outside the allowed directory '${rootReal}'. ` +
        `Set SOCIALCALC_FILES_DIR to change the allowed directory.`
    );
  }
  return candidate;
}
