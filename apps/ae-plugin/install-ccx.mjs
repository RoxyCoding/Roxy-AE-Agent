// Packages the plugin and installs it with Adobe's Unified Plugin Installer Agent (UPIA),
// without opening the Creative Cloud Desktop UI. Restart After Effects afterwards.
// Reference: https://helpx.adobe.com/creative-cloud/apps/integration-with-other-apps/manage-plugins/install-plugins-using-upia-tool.html
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Windows path from Adobe Help (macOS is not supported by this script).
const UPIA =
  "C:\\Program Files\\Common Files\\Adobe\\Adobe Desktop Common\\RemoteComponents\\UPI\\UnifiedPluginInstallerAgent\\UnifiedPluginInstallerAgent.exe";

if (!existsSync(UPIA)) {
  console.error(`[ROXY][PLUGIN] UPIA not found at:\n  ${UPIA}\nIs Creative Cloud Desktop installed?`);
  process.exit(1);
}

execFileSync(process.execPath, [join(here, "package.mjs")], { stdio: "inherit" });

const manifest = JSON.parse(readFileSync(join(here, "static", "manifest.json"), "utf8"));
const ccx = join(here, "release", `${manifest.id}_${manifest.version}.ccx`);

console.log(`[ROXY][PLUGIN] installing ${ccx}`);
const res = spawnSync(UPIA, ["/install", ccx], { encoding: "utf8" });
const output = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
if (output) console.log(output);
// UPIA can exit with code 0 even when it prints "Failed to install, status = -NNN".
const failed = /failed to install|status\s*=\s*-\d+/i.test(output);
if (res.status !== 0 || failed) {
  const status = output.match(/status\s*=\s*(-\d+)/i)?.[1];
  console.error(`[ROXY][PLUGIN] installation FAILED (exit code ${res.status}${status ? `, UPIA status ${status}` : ""}).`);
  if (status === "-631") {
    console.error("UPIA -631: Creative Cloud is not signed in. Sign in to Creative Cloud Desktop (and verify your email), then retry.");
  }
  console.error("If it says the same version is already installed, uninstall it in Creative Cloud (Manage plugins) first, or bump `version` in static/manifest.json.");
  process.exit(res.status || 1);
}
console.log("[ROXY][PLUGIN] installed. Restart After Effects and open the Roxy AE Agent panel.");
