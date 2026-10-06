/**
 * Connection check without an MCP client:  npm run diag
 * Starts the bridge, waits for the AE plugin, pings it and prints a project summary.
 * (Stop any MCP client using Roxy first - the port can only be bound once.)
 */
import { callTool, print, startCli } from "./common.js";

const { bridge, ctx } = await startCli(60_000);
print("ae_status", await callTool(ctx, "ae_status", {}));
print("ae_get_project_state", await callTool(ctx, "ae_get_project_state", { detail: "summary" }));
print("ae_effect_listAvailable (first 5)", await callTool(ctx, "ae_effect_listAvailable", { limit: 5 }));
await bridge.stop();
process.exit(0);
