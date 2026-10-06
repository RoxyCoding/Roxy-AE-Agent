// Bundles the MCP server and CLI tools into self-contained ESM files in dist/.
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: {
    index: join(here, "src", "index.ts"),
    diag: join(here, "src", "cli", "diag.ts"),
    smoke: join(here, "src", "cli", "smoke.ts"),
  },
  outdir: join(here, "dist"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // Optional native accelerators of `ws`.
  external: ["bufferutil", "utf-8-validate"],
  // CJS dependencies bundled into ESM need a real `require`.
  banner: { js: "import { createRequire as __roxyCreateRequire } from 'node:module'; const require = __roxyCreateRequire(import.meta.url);" },
  sourcemap: true,
  logLevel: "info",
});
