/* Entry points called by the CEP panel through evalScript. Every call returns a JSON string. */
(function (R) {
  /*
   * Undo policy: an explicit group (undo.beginGroup/endGroup) absorbs every command until closed;
   * otherwise each mutating command / batch gets its own group. AE undo groups do not nest.
   */
  R.undo = {
    explicitName: null,
    depth: 0,
    beginExplicit: function (name) {
      if (this.explicitName !== null) R.fail("CONFLICT", 'Undo group "' + this.explicitName + '" is already open', undefined, "Call undo.endGroup first.");
      app.beginUndoGroup(name);
      this.explicitName = name;
    },
    endExplicit: function () {
      if (this.explicitName === null) return null;
      var name = this.explicitName;
      this.explicitName = null;
      app.endUndoGroup();
      return name;
    },
    runGrouped: function (name, fn) {
      if (this.explicitName !== null || this.depth > 0) return fn();
      app.beginUndoGroup(name);
      this.depth++;
      try {
        return fn();
      } finally {
        this.depth--;
        app.endUndoGroup();
      }
    }
  };

  /** Execute one command; never throws. */
  R.exec = function (command, args) {
    var warnings = [];
    var ctx = {
      warn: function (m) {
        warnings.push(m);
      }
    };
    try {
      var h = R.handlers[command];
      if (!h) R.fail("UNKNOWN_COMMAND", 'Unknown command "' + command + '"');
      return { success: true, data: h(args || {}, ctx), warnings: warnings };
    } catch (e) {
      return { success: false, error: R.toPayload(e), warnings: warnings };
    }
  };
})(ROXY);

var RoxyHost = {
  describe: function () {
    return ROXY.stringify({ commands: ROXY.keys(ROXY.handlers), host: ROXY.hostInfo() });
  },

  /** payload: JSON {id, command, args, mutates}. Returns JSON {success, data|error, warnings?}. */
  dispatch: function (payload) {
    var R = ROXY;
    var res;
    try {
      var req = R.parse(payload);
      res = req.mutates
        ? R.undo.runGrouped("Roxy: " + req.command, function () { return R.exec(req.command, req.args); })
        : R.exec(req.command, req.args);
    } catch (e) {
      res = { success: false, error: R.toPayload(e), warnings: [] };
    }
    var out = { success: res.success };
    if (res.success) out.data = res.data;
    else out.error = res.error;
    if (res.warnings && res.warnings.length) out.warnings = res.warnings;
    return R.stringify(out);
  },

  closeUndo: function () {
    ROXY.undo.endExplicit();
    return "ok";
  }
};
