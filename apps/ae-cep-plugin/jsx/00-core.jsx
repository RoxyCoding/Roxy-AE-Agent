/*
 * Roxy AE Agent - ExtendScript host (After Effects 2024-2026, loaded by the CEP extension).
 *
 * ES3 ONLY: ExtendScript has no JSON, no Array.prototype.map/forEach/filter/indexOf,
 * no Object.keys, no String.prototype.trim, no Date.now. tests/cep-host.test.ts parses this
 * file as ES3 and runs it with those built-ins removed.
 *
 * Files in jsx/ are concatenated in name order into dist/jsx/host.jsx by build.mjs.
 */
var ROXY = ROXY || {};

(function (R) {
  var toStr = Object.prototype.toString;
  var hasOwn = Object.prototype.hasOwnProperty;

  R.global = (function () {
    return this;
  })();

  R.isArray = function (v) {
    return toStr.call(v) === "[object Array]";
  };

  R.keys = function (o) {
    var out = [];
    for (var k in o) {
      if (hasOwn.call(o, k)) out.push(k);
    }
    return out;
  };

  R.map = function (arr, fn) {
    var out = [];
    for (var i = 0; i < arr.length; i++) out.push(fn(arr[i], i));
    return out;
  };

  R.filter = function (arr, fn) {
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      if (fn(arr[i], i)) out.push(arr[i]);
    }
    return out;
  };

  R.contains = function (arr, v) {
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] === v) return true;
    }
    return false;
  };

  R.extend = function (target, src) {
    if (src) {
      for (var k in src) {
        if (hasOwn.call(src, k)) target[k] = src[k];
      }
    }
    return target;
  };

  R.now = function () {
    return new Date().getTime();
  };

  /* ---------------- JSON (ASCII-safe output) ---------------- */

  function quote(s) {
    var out = '"';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      var code = s.charCodeAt(i);
      if (c === '"') out += '\\"';
      else if (c === "\\") out += "\\\\";
      else if (code < 0x20 || code > 0x7e) {
        var h = code.toString(16);
        while (h.length < 4) h = "0" + h;
        out += "\\u" + h;
      } else out += c;
    }
    return out + '"';
  }

  R.stringify = function (v) {
    if (v === null || v === undefined) return "null";
    var t = typeof v;
    if (t === "number") return isFinite(v) ? String(v) : "null";
    if (t === "boolean") return v ? "true" : "false";
    if (t === "string") return quote(v);
    if (t === "function") return "null";
    var parts = [];
    if (R.isArray(v)) {
      for (var i = 0; i < v.length; i++) parts.push(R.stringify(v[i]));
      return "[" + parts.join(",") + "]";
    }
    for (var k in v) {
      if (hasOwn.call(v, k) && v[k] !== undefined && typeof v[k] !== "function") {
        parts.push(quote(k) + ":" + R.stringify(v[k]));
      }
    }
    return "{" + parts.join(",") + "}";
  };

  R.parse = function (text) {
    var i = 0;
    function err(m) {
      throw new Error("JSON parse: " + m + " at " + i);
    }
    function ws() {
      while (i < text.length) {
        var c = text.charAt(i);
        if (c === " " || c === "\t" || c === "\n" || c === "\r") i++;
        else break;
      }
    }
    function lit(word, val) {
      if (text.substring(i, i + word.length) !== word) err("unexpected token");
      i += word.length;
      return val;
    }
    function num() {
      var start = i;
      while (i < text.length && "-+0123456789.eE".indexOf(text.charAt(i)) >= 0) i++;
      var s = text.substring(start, i);
      if (!/^-?(0|[1-9]\d*)(\.\d+)?([eE][+\-]?\d+)?$/.test(s)) err("bad number");
      return parseFloat(s);
    }
    function str() {
      var out = "";
      i++;
      while (i < text.length) {
        var c = text.charAt(i++);
        if (c === '"') return out;
        if (c === "\\") {
          c = text.charAt(i++);
          if (c === "u") {
            var h = text.substring(i, i + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(h)) err("bad unicode escape");
            out += String.fromCharCode(parseInt(h, 16));
            i += 4;
          } else if (c === "n") out += "\n";
          else if (c === "t") out += "\t";
          else if (c === "r") out += "\r";
          else if (c === "b") out += "\b";
          else if (c === "f") out += "\f";
          else if (c === '"' || c === "\\" || c === "/") out += c;
          else err("bad escape");
        } else out += c;
      }
      err("unterminated string");
    }
    function arr() {
      var a = [];
      i++;
      ws();
      if (text.charAt(i) === "]") {
        i++;
        return a;
      }
      for (;;) {
        a.push(value());
        ws();
        var c = text.charAt(i++);
        if (c === "]") return a;
        if (c !== ",") err("expected , or ]");
      }
    }
    function obj() {
      var o = {};
      i++;
      ws();
      if (text.charAt(i) === "}") {
        i++;
        return o;
      }
      for (;;) {
        ws();
        if (text.charAt(i) !== '"') err("expected key");
        var k = str();
        ws();
        if (text.charAt(i++) !== ":") err("expected :");
        o[k] = value();
        ws();
        var c = text.charAt(i++);
        if (c === "}") return o;
        if (c !== ",") err("expected , or }");
      }
    }
    function value() {
      ws();
      var c = text.charAt(i);
      if (c === "{") return obj();
      if (c === "[") return arr();
      if (c === '"') return str();
      if (c === "t") return lit("true", true);
      if (c === "f") return lit("false", false);
      if (c === "n") return lit("null", null);
      return num();
    }
    var result = value();
    ws();
    if (i < text.length) err("trailing data");
    return result;
  };

  /* ---------------- errors ---------------- */

  /** Throw a structured error (same codes as @roxy/ae-protocol ErrorCode). */
  R.fail = function (code, message, details, hint) {
    var e = { roxyError: true, code: code, message: message };
    if (details !== undefined) e.details = details;
    if (hint !== undefined) e.hint = hint;
    throw e;
  };

  R.errMsg = function (e) {
    if (e && e.message) return e.message + (e.line ? " (line " + e.line + ")" : "");
    return String(e);
  };

  R.toPayload = function (e) {
    if (e && e.roxyError) {
      var p = { code: e.code, message: e.message };
      if (e.details !== undefined) p.details = e.details;
      if (e.hint !== undefined) p.hint = e.hint;
      return p;
    }
    return { code: "AE_ERROR", message: R.errMsg(e) };
  };

  /** Read something that may throw; return fallback instead. */
  R.safe = function (fn, fallback) {
    try {
      var v = fn();
      return v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  };

  /** Run an AE call, converting host exceptions into AE_ERROR with context. */
  R.call = function (what, fn) {
    try {
      return fn();
    } catch (e) {
      if (e && e.roxyError) throw e;
      R.fail("AE_ERROR", what + " failed: " + R.errMsg(e));
    }
  };

  /*
   * Enum objects. In After Effects' ExtendScript the enums are reachable as identifiers but NOT as
   * properties of the global object (verified on AE 26.5: R.global["KeyframeInterpolationType"]
   * was undefined), so each one is referenced by name here.
   */
  R.enumObject = function (enumName) {
    var e;
    try {
      switch (enumName) {
        case "KeyframeInterpolationType":
          e = KeyframeInterpolationType;
          break;
        case "ParagraphJustification":
          e = ParagraphJustification;
          break;
        case "BlendingMode":
          e = BlendingMode;
          break;
        case "MaskMode":
          e = MaskMode;
          break;
        case "CloseOptions":
          e = CloseOptions;
          break;
        default:
          e = R.global[enumName];
      }
    } catch (err) {
      e = undefined; // ReferenceError: not defined in this host
    }
    return e || undefined;
  };

  R.enumValue = function (enumName, key, warn) {
    var e = R.enumObject(enumName);
    var v = e ? e[key] : undefined;
    if (v !== undefined && v !== null) return v;
    warn(enumName + "." + key + " is not available; the step was skipped");
    return undefined;
  };

  R.def = function (v, fallback) {
    return v === undefined || v === null ? fallback : v;
  };

  /** Resolve {"$ref":"step.path"} values (batch.execute). */
  R.resolveRefs = function (value, results) {
    if (value === null || typeof value !== "object") return value;
    if (R.isArray(value)) {
      return R.map(value, function (v) {
        return R.resolveRefs(v, results);
      });
    }
    var keys = R.keys(value);
    if (keys.length === 1 && keys[0] === "$ref" && typeof value.$ref === "string") {
      var parts = value.$ref.split(".");
      var stepId = parts[0];
      if (!hasOwn.call(results, stepId)) throw new Error('$ref "' + value.$ref + '": no earlier successful step "' + stepId + '"');
      var cur = results[stepId];
      for (var i = 1; i < parts.length; i++) {
        if (cur === null || cur === undefined || typeof cur !== "object") throw new Error('$ref "' + value.$ref + '": path not found');
        cur = cur[parts[i]];
      }
      if (cur === undefined) throw new Error('$ref "' + value.$ref + '" resolved to undefined');
      return cur;
    }
    var out = {};
    for (var j = 0; j < keys.length; j++) out[keys[j]] = R.resolveRefs(value[keys[j]], results);
    return out;
  };

  R.handlers = {};
})(ROXY);
