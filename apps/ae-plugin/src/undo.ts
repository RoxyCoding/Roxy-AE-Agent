import { ErrorCode, RoxyError } from "@roxy/ae-protocol";

export interface UndoHost {
  beginUndoGroup(name: string): unknown;
  endUndoGroup(): unknown;
}

/**
 * Undo grouping policy:
 *  - An explicit group (undo.beginGroup/endGroup) absorbs every command until closed.
 *  - Otherwise each mutating command / batch gets its own group, so one Edit>Undo reverts it.
 *  - AE undo groups are not nested: while any group is open, inner calls just run.
 */
export class UndoManager {
  private explicitName: string | null = null;
  private implicitDepth = 0;

  constructor(private readonly host: () => UndoHost) {}

  get explicitOpen(): string | null {
    return this.explicitName;
  }

  beginExplicit(name: string): void {
    if (this.explicitName !== null) {
      throw new RoxyError(ErrorCode.CONFLICT, `Undo group "${this.explicitName}" is already open`, {
        hint: "Call undo.endGroup first.",
      });
    }
    this.host().beginUndoGroup(name);
    this.explicitName = name;
  }

  /** Returns the closed group's name, or null if none was open. */
  endExplicit(): string | null {
    if (this.explicitName === null) return null;
    const name = this.explicitName;
    this.explicitName = null;
    this.host().endUndoGroup();
    return name;
  }

  async runGrouped<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
    if (this.explicitName !== null || this.implicitDepth > 0) return fn();
    this.host().beginUndoGroup(name);
    this.implicitDepth++;
    try {
      return await fn();
    } finally {
      this.implicitDepth--;
      this.host().endUndoGroup();
    }
  }

  /** Called when the server connection drops so no group is left dangling. */
  closeAll(): void {
    if (this.explicitName !== null) this.endExplicit();
  }
}
