/**
 * Roxy AE Agent - After Effects UXP plugin entry (AE 27.0+).
 *
 * Role: execution layer only. It receives commands from the MCP server over WebSocket,
 * executes them through the AE UXP API and returns structured results. No agent logic here.
 */
import * as z from "zod/v4";
import { bootPanel, whenDomReady } from "@roxy/plugin-panel";
import { Dispatcher } from "./dispatcher.js";
import { HANDLERS } from "./commands/index.js";
import { UndoManager } from "./undo.js";
import { getApp, hostInfo } from "./ae/host.js";

declare const require: (id: string) => any;
declare const __PLUGIN_VERSION__: string;

// UXP may forbid eval/new Function; force zod's interpreter mode.
z.config({ jitless: true });

// UXP entrypoints: a single panel; the connection lives as long as the plugin is loaded.
try {
  const { entrypoints } = require("uxp");
  entrypoints.setup({
    panels: {
      roxyPanel: {
        show() {
          /* UI is static HTML; nothing to do */
        },
      },
    },
  });
} catch (e) {
  console.error("[ROXY][PLUGIN] entrypoints.setup failed", e);
}

whenDomReady(() => {
  void bootPanel({
    pluginName: "roxy-ae-plugin",
    version: __PLUGIN_VERSION__,
    createExecutor: (log) => {
      const undo = new UndoManager(() => getApp());
      const dispatcher = new Dispatcher(HANDLERS, undo, log);
      return {
        commandNames: () => dispatcher.commandNames,
        hostInfo,
        handle: (req) => dispatcher.handle(req),
        onDisconnect: () => undo.closeAll(),
      };
    },
  });
});
