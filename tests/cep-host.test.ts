/** Static + runtime checks for the CEP extension's ExtendScript host (ES3). */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { parse } from "acorn";
import { decodeComment, encodeComment } from "@roxy/ae-protocol";
import { toEs3StringLiteral } from "../apps/ae-cep-plugin/src/cep-executor.js";
import { bundleJsx, JSX_DIR } from "./fakes/cep-runtime.js";

const files = readdirSync(JSX_DIR).filter((f) => f.endsWith(".jsx"));

describe("ExtendScript host is ES3", () => {
  it.each(files)("%s parses as ECMAScript 3", (f) => {
    const src = readFileSync(join(JSX_DIR, f), "utf8");
    expect(() => parse(src, { ecmaVersion: 3 })).not.toThrow();
  });

  it("does not call ES5+ built-ins", () => {
    // Blank out comments (they legitimately mention the forbidden APIs).
    let src = bundleJsx();
    const comments: Array<[number, number]> = [];
    parse(src, { ecmaVersion: 3, onComment: (_block, _text, start, end) => comments.push([start, end]) });
    for (const [s, e] of comments.reverse()) src = src.slice(0, s) + " ".repeat(e - s) + src.slice(e);
    const forbidden = [
      // `R.map(` etc. are the host's own ES3 helpers; anything else would be an ES5 array/string method.
      /(?<!\bR)\.(map|forEach|filter|reduce|some|every|trim|bind)\(/,
      /\bJSON\./,
      /\bObject\.(keys|create|defineProperty)\b/,
      /\bArray\.isArray\b/,
      /\bDate\.now\b/,
    ];
    for (const re of forbidden) expect(src.match(re)?.[0] ?? null, String(re)).toBeNull();
  });
});

describe("ExtendScript host runtime helpers", () => {
  const ctx = vm.createContext({});
  vm.runInContext("delete this.JSON; delete Object.keys; delete Array.isArray;", ctx);
  vm.runInContext(bundleJsx(), ctx);
  const run = (code: string) => vm.runInContext(code, ctx);

  it("stringify/parse round-trip incl. Japanese and escapes", () => {
    const value = { a: [1, 2.5, -3e-7, true, null], s: '世界 "quoted" \\ \n\t', nested: { x: {} } };
    const json = run(`ROXY.stringify(ROXY.parse(${toEs3StringLiteral(JSON.stringify(value))}))`) as string;
    expect(/^[\x20-\x7e]*$/.test(json)).toBe(true); // ASCII-only output survives evalScript
    expect(JSON.parse(json)).toEqual(value);
  });

  it("rejects malformed JSON", () => {
    expect(() => run(`ROXY.parse('{"a":}')`)).toThrow();
    expect(() => run(`ROXY.parse('[1,2')`)).toThrow();
  });

  it("metadata format is compatible with @roxy/ae-protocol", () => {
    const encoded = run(`ROXY.encodeComment("note", { roxyId: "歌詞_01", role: "lyrics" })`) as string;
    expect(decodeComment(encoded)).toEqual({ userComment: "note", metadata: { roxyId: "歌詞_01", role: "lyrics" }, corrupt: false });
    const fromTs = encodeComment("x", { roxyId: "a", lockedForAI: true });
    expect(run(`ROXY.stringify(ROXY.decodeComment(${toEs3StringLiteral(fromTs)}).metadata)`)).toBe('{"roxyId":"a","lockedForAI":true}');
  });

  it("toEs3StringLiteral escapes non-ASCII and line separators", () => {
    const lit = toEs3StringLiteral("a b世");
    expect(lit).toBe('"a\\u2028b\\u4e16"');
  });
});
