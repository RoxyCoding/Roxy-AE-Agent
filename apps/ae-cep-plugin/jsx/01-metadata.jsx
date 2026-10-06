/* Roxy Metadata in the `comment` attribute - same format as @roxy/ae-protocol/metadata.ts */
(function (R) {
  var PREFIX = "#roxy:";

  R.decodeComment = function (comment) {
    var text = comment ? String(comment) : "";
    var lines = text.split(/\r\n|\r|\n/);
    var rest = [];
    var meta = null;
    var corrupt = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.substring(0, PREFIX.length) === PREFIX) {
        try {
          var m = R.parse(line.substring(PREFIX.length));
          if (m && typeof m === "object" && !R.isArray(m)) meta = m;
          else corrupt = true;
        } catch (e) {
          corrupt = true;
        }
      } else {
        rest.push(line);
      }
    }
    return { userComment: rest.join("\n").replace(/\n+$/, ""), metadata: meta, corrupt: corrupt };
  };

  R.encodeComment = function (userComment, meta) {
    var base = String(userComment || "").replace(/\n+$/, "");
    if (!meta || R.keys(meta).length === 0) return base;
    var line = PREFIX + R.stringify(meta);
    return base.length > 0 ? base + "\n" + line : line;
  };

  R.readMeta = function (target) {
    return R.decodeComment(R.safe(function () {
      return target.comment;
    }, "")).metadata;
  };

  /** Merge a patch. lockedForAI can be raised by the AI but never lowered. */
  R.writeMeta = function (target, patch, warn) {
    var decoded = R.decodeComment(R.safe(function () {
      return target.comment;
    }, ""));
    if (decoded.corrupt) warn("Existing Roxy metadata line was unreadable and has been replaced");
    var merged = R.extend(R.extend({}, decoded.metadata), patch);
    if (decoded.metadata && decoded.metadata.lockedForAI === true && patch.lockedForAI === false) {
      merged.lockedForAI = true;
      warn("lockedForAI cannot be cleared by the AI; it stays true (the user must unlock it in AE)");
    }
    target.comment = R.encodeComment(decoded.userComment, merged);
    return merged;
  };

  R.replaceMeta = function (target, meta) {
    var decoded = R.decodeComment(R.safe(function () {
      return target.comment;
    }, ""));
    target.comment = R.encodeComment(decoded.userComment, meta);
  };

  R.assertNotLocked = function (target, label) {
    var meta = R.readMeta(target);
    if (meta && meta.lockedForAI === true) {
      R.fail("LOCKED_FOR_AI", label + " is locked for AI (Roxy metadata lockedForAI=true)",
        { roxyId: meta.roxyId === undefined ? null : meta.roxyId }, "Ask the user to unlock it, or work on another element.");
    }
  };
})(ROXY);
