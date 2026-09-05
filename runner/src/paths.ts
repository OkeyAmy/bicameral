// Repo-root resolution.
//
// Deliberately avoids BOTH `new URL(..., import.meta.url)` and `node:path`:
// the web app bundles this module, webpack statically analyses those URLs at
// build time, and a bundled `node:path` shim receives module ids instead of
// strings. Plain string joins from `process.cwd()` work identically in the `tsx`
// scripts and inside the Next.js server. POSIX separators only, which is what
// every target here uses.
import { existsSync, readFileSync } from "node:fs";

let cached: string | undefined;

const parent = (dir: string) => {
  const i = dir.lastIndexOf("/");
  return i <= 0 ? "/" : dir.slice(0, i);
};

export const join = (...parts: string[]) =>
  parts.filter(Boolean).join("/").replace(/\/{2,}/g, "/");

export function repoRoot(): string {
  if (cached) return cached;

  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        if (JSON.parse(readFileSync(pkg, "utf8")).name === "bicameral") {
          cached = dir;
          return dir;
        }
      } catch {
        /* keep walking */
      }
    }
    const up = parent(dir);
    if (up === dir) break;
    dir = up;
  }

  // Fall back to cwd rather than throwing: the only consequence is that .env and
  // the Foundry artifacts are looked for relative to where the process started.
  cached = process.cwd();
  return cached;
}

export const fromRoot = (...parts: string[]) => join(repoRoot(), ...parts);
export const ARTIFACTS = () => fromRoot("contracts", "out");
export const RESULTS = () => fromRoot("results");
export const ENV_FILE = () => fromRoot(".env");
