/**
 * Roxy AE Agent - CEP extension entry (After Effects 2024 / 2025 / 2026).
 *
 * Panel (Chromium) <-> MCP server over WebSocket; After Effects is driven by jsx/host.jsx
 * (loaded by CEP through <ScriptPath>) via window.__adobe_cep__.evalScript.
 */
import { bootPanel, whenDomReady } from "@roxy/plugin-panel";
import { CepExecutor, type EvalScript } from "./cep-executor.js";

declare const __PLUGIN_VERSION__: string;

interface CepBridge {
  evalScript(script: string, callback: (result: string) => void): void;
}

const evalScript: EvalScript = (script) =>
  new Promise((resolve, reject) => {
    const cep = (window as unknown as { __adobe_cep__?: CepBridge }).__adobe_cep__;
    if (!cep) {
      reject(new Error("window.__adobe_cep__ is not available (not running inside a CEP host)"));
      return;
    }
    cep.evalScript(script, (result) => resolve(result));
  });

whenDomReady(() => {
  void bootPanel({
    pluginName: "roxy-ae-cep",
    version: __PLUGIN_VERSION__,
    createExecutor: async (log) => {
      const executor = new CepExecutor(evalScript, log);
      await executor.init();
      return executor;
    },
  });
});
