/**
 * Thin access layer over the After Effects UXP host module.
 *
 * API reference: https://developer.adobe.com/after-effects/uxp/after-effects-api/
 * (early preview, AE 27.0+). Everything AE-specific goes through here so that a future
 * ExtendScript/aerender fallback executor can be slotted in without touching command logic.
 */
import { ErrorCode, RoxyError } from "@roxy/ae-protocol";

declare const require: (id: string) => any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AE = any;

let cachedApp: AE | null = null;

/** `require("aftereffects")` returns the Application object (see API overview). */
export function getApp(): AE {
  if (cachedApp) return cachedApp;
  try {
    cachedApp = require("aftereffects");
  } catch (e) {
    throw new RoxyError(ErrorCode.UNSUPPORTED, `Cannot load the "aftereffects" UXP module: ${(e as Error).message}`, {
      hint: "Run the plugin inside After Effects 27.0+ (UXP support).",
    });
  }
  return cachedApp;
}

export function getProject(): AE {
  const project = getApp().project;
  if (!project) throw new RoxyError(ErrorCode.NOT_FOUND, "No project is open in After Effects");
  return project;
}

/**
 * Enumerations (KeyframeInterpolationType, ParagraphJustification, ...).
 * The early-preview docs list enum *names* but not how they are exposed in UXP, so we probe
 * the host module and the global scope. Callers must handle `undefined`.
 */
export function getEnum(name: string): Record<string, number> | undefined {
  const app = getApp();
  const candidates = [app?.[name], (globalThis as any)[name]];
  for (const c of candidates) if (c && typeof c === "object") return c;
  return undefined;
}

/**
 * Resolve an enum member. Numeric values are deliberately NOT hard-coded (they are not
 * documented for UXP); if the host does not expose the enum, the caller skips the optional step
 * and a warning is returned to the AI.
 */
export function enumValue(enumName: string, key: string, warn: (m: string) => void): number | undefined {
  const e = getEnum(enumName);
  if (e && typeof e[key] === "number") return e[key];
  warn(`${enumName}.${key} is not exposed by this AE build; the step was skipped`);
  return undefined;
}

/**
 * Wait for a DeferredCall (saveFrameToPng, getRenderGUID, ...).
 * The docs only say it "resolves" and mention `.wait()`; the exact contract is not documented yet.
 * We await it if it is thenable and otherwise return immediately - callers that need the result
 * on disk (preview) verify it independently (the MCP server polls for the PNG).
 */
export async function settleDeferred(dc: unknown): Promise<{ awaited: boolean; value?: unknown }> {
  if (dc && typeof (dc as PromiseLike<unknown>).then === "function") {
    return { awaited: true, value: await (dc as PromiseLike<unknown>) };
  }
  return { awaited: false, value: dc };
}

/** Read an attribute, returning `fallback` if the host throws (some attributes throw by design). */
export function safeGet<T>(fn: () => T, fallback: T): T {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

/** Convert a host exception into a structured AE_ERROR with operation context. */
export function aeCall<T>(what: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RoxyError) throw e;
    throw new RoxyError(ErrorCode.AE_ERROR, `${what} failed: ${(e as Error)?.message ?? String(e)}`);
  }
}

export function hostInfo(): { appName?: string; version?: string; buildNumber?: number; isBeta?: boolean; language?: string } {
  try {
    const app = getApp();
    return {
      appName: safeGet(() => app.appName, undefined),
      version: safeGet(() => app.version, undefined),
      buildNumber: safeGet(() => app.buildNumber, undefined),
      isBeta: safeGet(() => app.isBeta, undefined),
      language: safeGet(() => app.isoLanguage, undefined),
    };
  } catch {
    return {};
  }
}
