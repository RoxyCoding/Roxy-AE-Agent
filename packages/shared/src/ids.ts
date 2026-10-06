let counter = 0;

/** Operation / request id: unique per process, sortable by creation time. */
export function createOperationId(prefix = "op"): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}
