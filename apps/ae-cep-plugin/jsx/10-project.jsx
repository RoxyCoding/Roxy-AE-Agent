/* project.* / metadata.* / system.ping */
(function (R) {
  var H = R.handlers;

  function filePath(f) {
    if (!f) return null;
    return typeof f === "string" ? f : R.safe(function () { return f.fsName; }, null);
  }

  function projectName(project) {
    var path = filePath(R.safe(function () { return project.file; }, null));
    if (!path) return { name: "Untitled Project", path: null };
    var base = path.split(/[\\\/]/).pop();
    return { name: base.replace(/\.aep$/i, ""), path: path };
  }

  R.hostInfo = function () {
    return {
      appName: "After Effects",
      version: R.safe(function () { return app.version; }, undefined),
      buildNumber: R.safe(function () { return app.buildNumber; }, undefined),
      language: R.safe(function () { return app.isoLanguage; }, undefined)
    };
  };

  H["system.ping"] = function () {
    return { pong: true, host: R.hostInfo(), time: R.now() };
  };

  H["project.getState"] = function (args) {
    var detail = R.def(args.detail, "summary");
    var limit = R.def(args.compLimit, 100);
    var project = app.project;
    var comps = R.allComps();
    var active = R.activeComp();
    var info = projectName(project);
    var state = {
      project: { name: info.name, path: info.path, dirty: R.safe(function () { return project.dirty; }, undefined), numItems: project.numItems },
      activeComp: active ? R.compRef(active) : null,
      compCount: comps.length,
      comps: R.map(comps.slice(0, limit), function (c) {
        return detail === "detailed" ? R.compSummary(c) : { id: c.id, name: c.name, numLayers: R.safe(function () { return c.numLayers; }, 0) };
      }),
      errors: []
    };
    if (comps.length > limit) state.compsTruncated = true;
    if (detail === "detailed") {
      var focus = args.comp !== undefined ? R.resolveComp(args.comp) : active;
      if (focus) state.focusComp = R.extend(R.compDetails(focus), { layers: R.map(R.allLayers(focus), R.layerSummary) });
      var missing = 0;
      for (var i = 1; i <= project.numItems; i++) {
        var it = R.safe(function () { return project.item(i); }, null);
        if (it && R.safe(function () { return it.footageMissing; }, false)) missing++;
      }
      if (missing > 0) state.errors.push(missing + " footage item(s) are missing");
    }
    return state;
  };

  H["project.save"] = function (args) {
    var project = app.project;
    var current = filePath(R.safe(function () { return project.file; }, null));
    if (!args.path && !current) {
      R.fail("INVALID_ARGS", "Project has never been saved; provide `path` (absolute .aep path)", undefined,
        "Saving without a path would open a blocking Save dialog in After Effects.");
    }
    R.call("project.save", function () {
      if (args.path) project.save(new File(args.path));
      else project.save();
    });
    return { saved: true, path: filePath(R.safe(function () { return project.file; }, null)) || args.path || current };
  };

  function diagLayer(layer) {
    var type = R.layerType(layer);
    var transform = R.safe(function () { return layer.property(R.MN.transform); }, null);
    var pos = transform ? R.safe(function () { return transform.property(R.MN.position).valueAtTime(0, false); }, null) : null;
    var rect = type === "text" || type === "shape" ? R.safe(function () { return layer.sourceRectAtTime(0, false); }, null) : null;
    var parent = R.safe(function () { return layer.parent; }, null);
    var exprErrors = [];
    function visit(group, path, depth) {
      if (depth > 4 || exprErrors.length >= 20) return;
      var n = R.safe(function () { return group.numProperties; }, 0);
      for (var i = 1; i <= n; i++) {
        var p = R.safe(function () { return group.property(i); }, null);
        if (!p) continue;
        var name = path + "/" + R.safe(function () { return p.name; }, String(i));
        if (R.isGroup(p)) visit(p, name, depth + 1);
        else {
          var err = R.safe(function () { return p.expressionEnabled ? p.expressionError : ""; }, "");
          if (err) exprErrors.push({ path: name, error: err });
        }
      }
    }
    var groups = [R.MN.transform, R.MN.effects];
    for (var g = 0; g < groups.length; g++) {
      var grp = R.safe(function () { return layer.property(groups[g]); }, null);
      if (grp) visit(grp, R.safe(function () { return grp.name; }, groups[g]), 0);
    }
    return {
      id: layer.id,
      index: layer.index,
      name: layer.name,
      type: type,
      enabled: R.safe(function () { return layer.enabled; }, true),
      threeD: R.safe(function () { return layer.threeDLayer; }, false),
      inPoint: R.safe(function () { return layer.inPoint; }, 0),
      outPoint: R.safe(function () { return layer.outPoint; }, 0),
      parentId: parent ? parent.id : null,
      position: pos && R.isArray(pos) ? R.toJson(pos) : null,
      sourceRect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
      roxy: R.readMeta(layer),
      expressionErrors: exprErrors,
      effects: R.map(R.effectsOnLayer(layer), function (e) { return { name: e.name, matchName: e.matchName }; })
    };
  }

  H["project.collectDiagnostics"] = function (args) {
    var maxLayers = R.def(args.maxLayersPerComp, 500);
    var project = app.project;
    var comps = args.comp !== undefined ? [R.resolveComp(args.comp)] : R.allComps();
    var snap = { project: projectName(project), comps: [], footage: [], truncatedComps: [] };
    var fx = R.safe(function () { return app.effects; }, null);
    if (fx) {
      snap.installedEffects = [];
      for (var e = 0; e < fx.length; e++) snap.installedEffects.push(fx[e].matchName);
    }
    for (var c = 0; c < comps.length; c++) {
      var comp = comps[c];
      var layers = R.allLayers(comp);
      if (layers.length > maxLayers) snap.truncatedComps.push(comp.id);
      snap.comps.push({
        id: comp.id, name: comp.name, width: comp.width, height: comp.height, duration: comp.duration, fps: comp.frameRate,
        roxy: R.readMeta(comp),
        layers: R.map(layers.slice(0, maxLayers), diagLayer)
      });
    }
    for (var i = 1; i <= project.numItems; i++) {
      var item = R.safe(function () { return project.item(i); }, null);
      if (!item || R.isComp(item)) continue;
      var missing = R.safe(function () { return item.footageMissing; }, undefined);
      if (missing === undefined) continue;
      snap.footage.push({ id: item.id, name: item.name, missing: !!missing });
    }
    return snap;
  };

  H["metadata.get"] = function (args) {
    var comp = R.resolveComp(args.comp);
    if (args.layer === undefined) return { comp: R.compRef(comp), metadata: R.readMeta(comp) };
    var layer = R.resolveLayer(comp, args.layer);
    return { comp: R.compRef(comp), layer: { id: layer.id, name: layer.name }, metadata: R.readMeta(layer) };
  };

  H["metadata.set"] = function (args, ctx) {
    var comp = R.resolveComp(args.comp);
    var target = args.layer === undefined ? comp : R.resolveLayer(comp, args.layer);
    var keys = R.keys(args.metadata || {});
    var raisingLockOnly = keys.length === 1 && keys[0] === "lockedForAI" && args.metadata.lockedForAI === true;
    if (!raisingLockOnly) R.assertNotLocked(target, '"' + target.name + '"');
    var merged = R.writeMeta(target, args.metadata || {}, ctx.warn);
    return { target: { id: target.id, name: target.name }, metadata: merged };
  };
})(ROXY);
