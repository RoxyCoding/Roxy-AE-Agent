/**
 * Batch step references.
 *
 * Inside `batch.execute`, an argument value of the form `{ "$ref": "<stepId>.<path>" }`
 * is replaced by a value from an earlier step's result data, e.g.
 *   { "$ref": "mkcomp.comp.id" }  -> results["mkcomp"].comp.id
 */

export function isRef(value: unknown): value is { $ref: string } {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as Record<string, unknown>).$ref === "string"
  );
}

export function containsRef(value: unknown): boolean {
  if (isRef(value)) return true;
  if (Array.isArray(value)) return value.some(containsRef);
  if (value && typeof value === "object") return Object.values(value).some(containsRef);
  return false;
}

export function resolveRefs(value: unknown, results: Record<string, unknown>): unknown {
  if (isRef(value)) return lookup(value.$ref, results);
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, results));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveRefs(v, results);
    return out;
  }
  return value;
}

function lookup(ref: string, results: Record<string, unknown>): unknown {
  const [stepId, ...path] = ref.split(".");
  if (!stepId || !(stepId in results)) {
    throw new Error(`$ref "${ref}": no earlier successful step with id "${stepId}"`);
  }
  let cur: unknown = results[stepId];
  for (const key of path) {
    if (cur === null || cur === undefined || typeof cur !== "object") {
      throw new Error(`$ref "${ref}": path segment "${key}" not found`);
    }
    cur = (cur as Record<string, unknown>)[key];
  }
  if (cur === undefined) throw new Error(`$ref "${ref}" resolved to undefined`);
  return cur;
}
