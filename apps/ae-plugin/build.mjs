// Bundles the UXP plugin into dist/ (load dist/manifest.json with UXP Developer Tool).
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist");
const watch = process.argv.includes("--watch");
const manifest = JSON.parse(readFileSync(join(here, "static", "manifest.json"), "utf8"));

mkdirSync(out, { recursive: true });
cpSync(join(here, "static"), out, { recursive: true });

const options = {
  entryPoints: [join(here, "src", "main.ts")],
  outfile: join(out, "main.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  // Conservative target for the UXP JavaScript engine.
  target: "es2019",
  // Host modules are provided by UXP at runtime.
  external: ["aftereffects", "uxp"],
  define: { __PLUGIN_VERSION__: JSON.stringify(manifest.version) },
  sourcemap: "inline",
  logLevel: "info",
};

if (watch) {
  const { context } = await import("esbuild");
  const ctx = await context(options);
  await ctx.watch();
  console.log("[ROXY][PLUGIN] watching for changes...");
} else {
  await build(options);
}
