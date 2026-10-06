/**
 * Runs the CEP extension's ExtendScript host (apps/ae-cep-plugin/jsx/*.jsx) in a Node vm context
 * that imitates ExtendScript: ES5+ built-ins (JSON, Array.prototype.map, Object.keys, ...) are removed
 * and the AE globals (app, File, enums) are provided by the fake AE.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import vm from "node:vm";
import { ENUMS, fake, FakeKeyframeEase, FakeShape } from "./fake-ae.js";

export const JSX_DIR = join(__dirname, "..", "..", "apps", "ae-cep-plugin", "jsx");

export function bundleJsx(): string {
  return readdirSync(JSX_DIR)
    .filter((f) => f.endsWith(".jsx"))
    .sort()
    .map((f) => readFileSync(join(JSX_DIR, f), "utf8"))
    .join("\n");
}

/** Minimal ExtendScript File stand-in (only what host.jsx uses with saveFrameToPng/save). */
class FakeFile {
  fsName: string;
  name: string;
  constructor(path: string) {
    this.fsName = path;
    this.name = basename(path);
  }
  get parent() {
    return new FakeFile(dirname(this.fsName));
  }
  get exists() {
    return existsSync(this.fsName);
  }
}

const STRIP_ES5 = `
  delete Array.prototype.map; delete Array.prototype.forEach; delete Array.prototype.filter;
  delete Array.prototype.indexOf; delete Array.prototype.lastIndexOf; delete Array.prototype.reduce;
  delete Array.prototype.reduceRight; delete Array.prototype.some; delete Array.prototype.every;
  delete Array.isArray; delete Object.keys; delete Object.create; delete String.prototype.trim;
  delete Function.prototype.bind; delete Date.now; delete this.JSON;
`;

/**
 * Real AE 26.5 finding: enums such as KeyframeInterpolationType resolve as identifiers but are not
 * properties of the global object. Mimic that by moving them from global properties to script-scope
 * `const` bindings (visible as identifiers, invisible to globalObject["Name"]).
 */
function hideEnumsFromGlobal(context: vm.Context): void {
  const names = ["KeyframeInterpolationType", "ParagraphJustification", "BlendingMode", "MaskMode", "CloseOptions"];
  const ctx = context as Record<string, unknown>;
  const values: Record<string, unknown> = {};
  for (const n of names) {
    values[n] = ctx[n];
    delete ctx[n];
  }
  ctx.__roxyEnums = values;
  vm.runInContext(names.map((n) => `const ${n} = __roxyEnums.${n};`).join("\n"), context);
}

export function createCepEvalScript(): (script: string) => Promise<string> {
  const context = vm.createContext({
    app: fake,
    File: FakeFile,
    // ExtendScript exposes these enums as globals (values are irrelevant for the fake).
    KeyframeInterpolationType: { LINEAR: 6612, BEZIER: 6613, HOLD: 6614 },
    ParagraphJustification: { LEFT_JUSTIFY: 7413, RIGHT_JUSTIFY: 7414, CENTER_JUSTIFY: 7415 },
    BlendingMode: ENUMS.BlendingMode,
    MaskMode: ENUMS.MaskMode,
    CloseOptions: ENUMS.CloseOptions,
    Shape: FakeShape,
    KeyframeEase: FakeKeyframeEase,
    ImportOptions: fake.ImportOptions,
  });
  vm.runInContext(STRIP_ES5, context);
  hideEnumsFromGlobal(context);
  vm.runInContext(bundleJsx(), context, { filename: "host.jsx" });
  return async (script) => {
    try {
      return String(vm.runInContext(script, context));
    } catch {
      return "EvalScript error.";
    }
  };
}
