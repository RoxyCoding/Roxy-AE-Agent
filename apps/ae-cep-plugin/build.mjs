// Builds the CEP extension into dist/ :
//   dist/CSXS/manifest.xml, dist/index.html, dist/.debug  (static/)
//   dist/main.js       panel bundle (esbuild)
//   dist/jsx/host.jsx  ExtendScript host (jsx/*.jsx concatenated in name order)
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist");
const version = JSON.parse(readFileSync(join(here, "package.json"), "utf8")).version;

function bundleJsx() {
  const dir = join(here, "jsx");
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsx")).sort();
  return files.map((f) => `// ---- ${f} ----\n` + readFileSync(join(dir, f), "utf8")).join("\n");
}

mkdirSync(join(out, "jsx"), { recursive: true });
cpSync(join(here, "static"), out, { recursive: true });
writeFileSync(join(out, "jsx", "host.jsx"), bundleJsx());

await build({
  entryPoints: [join(here, "src", "main.ts")],
  outfile: join(out, "main.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome80",
  define: { __PLUGIN_VERSION__: JSON.stringify(version) },
  sourcemap: "inline",
  logLevel: "info",
});
