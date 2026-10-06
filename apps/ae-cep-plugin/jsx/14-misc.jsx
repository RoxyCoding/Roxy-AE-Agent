/* preview.* / undo.* / batch.execute */
(function (R) {
  var H = R.handlers;
  var NOT_IN_BATCH = ["batch.execute", "undo.beginGroup", "undo.endGroup", "preview.renderFrame"];

  /**
   * Fallback renderer using only documented APIs: a temporary Render Queue item rendering one frame
   * with the first output-module template whose name contains "PNG". Other queued items are
   * un-queued during the render and restored afterwards.
   */
  function renderViaQueue(comp, time, outputPath) {
    var rq = app.project.renderQueue;
    if (rq.rendering) R.fail("CONFLICT", "The Render Queue is currently rendering");
    var target = new File(outputPath);
    var folder = target.parent;
    var stamp = "roxyrq_" + R.now();
    var restore = [];
    for (var i = 1; i <= rq.numItems; i++) {
      var it = rq.item(i);
      if (R.safe(function () { return it.render; }, false)) {
        try {
          it.render = false;
          restore.push(it);
        } catch (e) {
          /* finished items cannot be changed */
        }
      }
    }
    var rqi = null;
    try {
      rqi = rq.items.add(comp);
      rqi.timeSpanStart = time;
      rqi.timeSpanDuration = comp.frameDuration;
      var om = rqi.outputModule(1);
      var templates = om.templates;
      var tpl = null;
      for (var t = 0; t < templates.length; t++) {
        if (/png/i.test(templates[t])) {
          tpl = templates[t];
          break;
        }
      }
      if (!tpl) {
        R.fail("UNSUPPORTED", "No PNG output-module template found for preview rendering", { templates: templates },
          "Create an output-module template using the PNG format (any name containing 'PNG') in After Effects.");
      }
      om.applyTemplate(tpl);
      om = rqi.outputModule(1); // the OM object is invalidated after settings change (documented bug)
      om.file = new File(folder.fsName + "/" + stamp + "_[#####].png");
      rq.render();
      var produced = folder.getFiles(stamp + "_*.png");
      if (!produced || produced.length === 0) R.fail("PREVIEW_FAILED", "Render Queue finished but no PNG was written", { folder: folder.fsName });
      if (target.exists) target.remove();
      if (!produced[0].rename(target.name)) R.fail("PREVIEW_FAILED", "Could not rename " + produced[0].fsName + " to " + target.name);
    } finally {
      if (rqi) {
        try {
          rqi.remove();
        } catch (e2) {
          /* ignore */
        }
      }
      for (var r = 0; r < restore.length; r++) {
        try {
          restore[r].render = true;
        } catch (e3) {
          /* ignore */
        }
      }
    }
  }

  H["preview.renderFrame"] = function (args, ctx) {
    var comp = R.resolveComp(args.comp);
    var time = args.time !== undefined ? args.time : R.safe(function () { return comp.time; }, 0);
    if (time > comp.duration + 1e-6) R.fail("INVALID_ARGS", "time " + time + "s is beyond the comp duration (" + comp.duration + "s)");
    var started = R.now();
    var method;
    // saveFrameToPng is not in the ExtendScript docs (undocumented); use it only if present.
    if (typeof comp.saveFrameToPng === "function") {
      method = "saveFrameToPng";
      if (args.draft) ctx.warn("draft is not supported by the ExtendScript host; rendered at full quality");
      R.call("saveFrameToPng", function () { comp.saveFrameToPng(time, new File(args.outputPath)); });
    } else {
      method = "renderQueue";
      renderViaQueue(comp, time, args.outputPath);
    }
    return {
      comp: R.compRef(comp),
      time: time,
      outputPath: args.outputPath,
      compWidth: comp.width,
      compHeight: comp.height,
      method: method,
      elapsedMs: R.now() - started
    };
  };

  H["undo.beginGroup"] = function (args) {
    R.undo.beginExplicit(R.def(args.name, "Roxy AE Agent"));
    return { open: true, name: args.name };
  };

  H["undo.endGroup"] = function () {
    var name = R.undo.endExplicit();
    return { closed: name !== null, name: name };
  };

  H["batch.execute"] = function (args, ctx) {
    var steps = args.commands || [];
    var i;
    for (i = 0; i < steps.length; i++) {
      if (!H[steps[i].command]) R.fail("UNKNOWN_COMMAND", "Step " + i + ': unknown command "' + steps[i].command + '"');
      if (R.contains(NOT_IN_BATCH, steps[i].command)) R.fail("INVALID_ARGS", "Step " + i + ': "' + steps[i].command + '" is not allowed inside batch.execute');
    }
    var stopOnError = R.def(args.onError, "stop") === "stop";
    return R.undo.runGrouped(R.def(args.undoGroup, "Roxy batch"), function () {
      var stepResults = {};
      var results = [];
      var failed = 0;
      var stoppedAt = null;
      for (var s = 0; s < steps.length; s++) {
        var step = steps[s];
        var stepId = step.id !== undefined ? step.id : String(s);
        var entry = { id: stepId, command: step.command };
        var stepArgs;
        try {
          stepArgs = R.resolveRefs(step.args || {}, stepResults);
        } catch (e) {
          entry.success = false;
          entry.error = { code: "INVALID_ARGS", message: R.errMsg(e) };
          results.push(entry);
          failed++;
          if (stopOnError) {
            stoppedAt = s;
            break;
          }
          continue;
        }
        var res = R.exec(step.command, stepArgs);
        entry.success = res.success;
        if (res.success) {
          entry.data = res.data;
          stepResults[stepId] = res.data;
        } else {
          entry.error = res.error;
          failed++;
        }
        if (res.warnings.length) entry.warnings = res.warnings;
        results.push(entry);
        if (!res.success && stopOnError) {
          stoppedAt = s;
          break;
        }
      }
      return {
        total: steps.length,
        executed: results.length,
        succeeded: results.length - failed,
        failed: failed,
        stoppedAt: stoppedAt,
        rolledBack: false,
        results: results
      };
    });
  };
})(ROXY);
