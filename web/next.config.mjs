import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const runnerSrc = path.join(here, "..", "runner", "src");

/**
 * The web app shares the runner's chain code rather than duplicating it — one
 * definition of discovery, ABIs and config for both surfaces.
 *
 * The runner is TypeScript ESM using `.js` specifiers (correct for NodeNext), so
 * the alias below maps `@bicameral/runner/src/x.js` onto the real `.ts` source
 * and `transpilePackages` compiles it.
 *
 * @type {import('next').NextConfig}
 */
export default {
  transpilePackages: ["@bicameral/runner"],
  // Keep the SDK out of the bundle: it is resolved with createRequire, which
  // returns numeric module ids under webpack instead of a path.
  serverExternalPackages: ["@somnia-chain/markets-sdk"],
  experimental: { externalDir: true },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@bicameral/runner/src": runnerSrc,
    };
    // Let `./markets.js` inside the runner resolve to `markets.ts`.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};
