import type * as z from "zod/v4";
import type { CommandResponse, ErrorPayload } from "@roxy/ae-protocol";
import type { PreviewEngine } from "@roxy/preview-engine";
import type { Logger } from "@roxy/shared";

export interface BridgeStatus {
  listening: boolean;
  port: number;
  bridgeError: string | null;
  connected: boolean;
  plugin: { name: string; version: string } | null;
  host: Record<string, unknown> | null;
  connectedAt: string | null;
  lastMessageAgoMs: number | null;
  pendingRequests: number;
  pluginCommands: string[];
}

export interface ToolContext {
  /** Send one command to the AE plugin. Never throws for AE-side failures: check `success`. */
  execute(command: string, args: unknown, opts?: { timeoutMs?: number; source?: string }): Promise<CommandResponse>;
  preview: PreviewEngine;
  logger: Logger;
  status(): BridgeStatus;
}

export interface ToolImage {
  base64: string;
  mimeType: string;
}

/** Transport-agnostic tool result; the MCP server converts it to MCP content. */
export interface ToolOutcome {
  ok: boolean;
  opId?: string;
  data?: unknown;
  error?: ErrorPayload;
  warnings?: string[];
  images?: ToolImage[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodObject;
  /** MCP annotations hints. */
  readOnly?: boolean;
  destructive?: boolean;
  handler(args: any, ctx: ToolContext): Promise<ToolOutcome>;
}

export function fromResponse(res: CommandResponse): ToolOutcome {
  const out: ToolOutcome = { ok: res.success, opId: res.id };
  if (res.success) out.data = res.data;
  else out.error = res.error;
  if (res.warnings?.length) out.warnings = res.warnings;
  return out;
}
