import { PreviewEngine } from "@roxy/preview-engine";
import type { ToolContext } from "@roxy/ae-tools";
import type { Logger } from "@roxy/shared";
import { WsBridge } from "./bridge/ws-bridge.js";
import { SERVER_INFO, type ServerConfig } from "./config.js";

/** Bridge + preview engine + ToolContext, shared by the MCP entry and the CLI tools. */
export function createRuntime(
  config: ServerConfig,
  logger: Logger,
  options: { retryBindMs?: number } = {},
): { bridge: WsBridge; ctx: ToolContext } {
  const bridge = new WsBridge({
    host: config.host,
    port: config.port,
    logger,
    serverInfo: SERVER_INFO,
    token: config.token,
    defaultTimeoutMs: config.timeoutMs,
    retryBindMs: options.retryBindMs,
  });
  const preview = new PreviewEngine({ dir: config.previewDir, logger });
  const ctx: ToolContext = {
    execute: (command, args, opts) => bridge.request(command, args, opts),
    preview,
    logger,
    status: () => bridge.status(),
  };
  return { bridge, ctx };
}
