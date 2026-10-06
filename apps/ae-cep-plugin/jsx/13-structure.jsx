/* Phase 2: footage import, layer create/set/reorder, generic group add/remove/attributes, project open, render */
(function (R) {
  var H = R.handlers;

  function lockedComp(sel) {
    var comp = R.resolveComp(sel);
    R.assertNotLocked(comp, 'Composition "' + comp.name + '"');
    return comp;
  }

  function upper(s) {
    return String(s).toUpperCase();
  }

  /* Enum member by name, or INVALID_ARGS with the valid names. */
  function requireEnum(enumName, key) {
    var e = R.enumObject(enumName);
    if (!e) R.fail("UNSUPPORTED", enumName + " is not available");
    var k = upper(key);
    var v = e[k];
    if (v === undefined || v === null) {
      var valid = [];
      try {
        for (var n in e) {
          if (typeof e[n] === "number") valid.push(n);
        }
      } catch (err) {
        /* host enums may not be enumerable */
      }
      R.fail("INVALID_ARGS", "Unknown " + enumName + ' "' + key + '"', { valid: valid }, "Use the member names from the After Effects scripting guide, e.g. ADD, SCREEN, SUBTRACT.");
    }
    return v;
  }

  function pickTemplate(templates, wanted) {
    var i;
    for (i = 0; i < templates.length; i++) {
      if (templates[i] === wanted) return templates[i];
    }
    var w = String(wanted).toLowerCase();
    for (i = 0; i < templates.length; i++) {
      if (String(templates[i]).toLowerCase().indexOf(w) >= 0) return templates[i];
    }
    R.fail("NOT_FOUND", 'No output-module template matches "' + wanted + '"', { templates: R.map(templates, function (t) { return t; }) });
  }

  H["footage.import"] = function (args) {
    var f = new File(args.path);
    if (!f.exists) R.fail("NOT_FOUND", "File not found: " + args.path);
    var item = R.call('importFile("' + args.path + '")', function () {
      return app.project.importFile(new ImportOptions(f));
    });
    if (args.name) item.name = args.name;
    return { item: R.itemSummary(item) };
  };

  H["layer.addItem"] = function (args, ctx) {
    var comp = lockedComp(args.comp);
    var item = R.resolveItem(args.item);
    if (item.id === comp.id) R.fail("INVALID_ARGS", "A composition cannot contain itself");
    var layer = R.call("layers.add", function () { return comp.layers.add(item); });
    if (args.startTime !== undefined) layer.startTime = args.startTime;
    if (args.name) layer.name = args.name;
    if (args.roxy) R.writeMeta(layer, args.roxy, ctx.warn);
    return { comp: R.compRef(comp), item: R.itemSummary(item), layer: R.layerSummary(layer) };
  };

  H["layer.create"] = function (args, ctx) {
    var comp = lockedComp(args.comp);
    var layer;
    if (args.kind === "null") {
      layer = R.call("addNull", function () { return comp.layers.addNull(); });
    } else if (args.kind === "shape") {
      layer = R.call("addShape", function () { return comp.layers.addShape(); });
    } else {
      var name = args.name || (args.kind === "adjustment" ? "Adjustment Layer" : "Solid");
      layer = R.call("addSolid", function () {
        return comp.layers.addSolid(args.color || [0, 0, 0], name, args.width || comp.width, args.height || comp.height, comp.pixelAspect || 1);
      });
      if (args.kind === "adjustment") layer.adjustmentLayer = true;
    }
    if (args.name) layer.name = args.name;
    if (args.startTime !== undefined) layer.startTime = args.startTime;
    R.writeMeta(layer, R.extend({ managedBy: "roxy" }, args.roxy), ctx.warn);
    return { comp: R.compRef(comp), layer: R.layerSummary(layer) };
  };

  H["layer.set"] = function (args) {
    var t = R.target(args, true);
    var layer = t.layer;
    var a = args.attributes || {};
    function set(key, fn) {
      R.call("set " + key, fn);
    }
    if (a.name !== undefined) set("name", function () { layer.name = a.name; });
    if (a.startTime !== undefined) set("startTime", function () { layer.startTime = a.startTime; });
    if (a.inPoint !== undefined) set("inPoint", function () { layer.inPoint = a.inPoint; });
    if (a.outPoint !== undefined) set("outPoint", function () { layer.outPoint = a.outPoint; });
    if (a.stretch !== undefined) set("stretch", function () { layer.stretch = a.stretch; });
    if (a.parent !== undefined) {
      if (a.parent === null) {
        set("parent", function () { layer.parent = null; });
      } else {
        var parent = R.resolveLayer(t.comp, a.parent);
        if (parent.id === layer.id) R.fail("INVALID_ARGS", "A layer cannot be its own parent");
        set("parent", function () { layer.parent = parent; });
      }
    }
    var simple = ["enabled", "motionBlur", "adjustmentLayer", "shy", "solo", "label"];
    for (var i = 0; i < simple.length; i++) {
      var key = simple[i];
      if (a[key] !== undefined) set(key, function () { layer[key] = a[key]; });
    }
    if (a.threeD !== undefined) set("threeDLayer", function () { layer.threeDLayer = a.threeD; });
    if (a.blendingMode !== undefined) {
      var mode = requireEnum("BlendingMode", a.blendingMode);
      set("blendingMode", function () { layer.blendingMode = mode; });
    }
    return { layer: R.layerSummary(layer) };
  };

  H["layer.reorder"] = function (args) {
    var t = R.target(args, true);
    var layer = t.layer;
    var to = args.to;
    if (to === "top") R.call("moveToBeginning", function () { layer.moveToBeginning(); });
    else if (to === "bottom") R.call("moveToEnd", function () { layer.moveToEnd(); });
    else {
      var other = R.resolveLayer(t.comp, to.above !== undefined ? to.above : to.below);
      if (other.id === layer.id) R.fail("INVALID_ARGS", "Cannot move a layer relative to itself");
      if (to.above !== undefined) R.call("moveBefore", function () { layer.moveBefore(other); });
      else R.call("moveAfter", function () { layer.moveAfter(other); });
    }
    return { layer: R.layerSummary(layer) };
  };

  H["property.addGroup"] = function (args) {
    var t = R.target(args, true);
    var parent = R.resolvePath(t.layer, args.path, 'layer "' + t.layer.name + '"');
    if (!R.isGroup(parent)) R.fail("INVALID_ARGS", '"' + parent.name + '" is not a property group');
    if (args.reuseExisting) {
      var n = R.safe(function () { return parent.numProperties; }, 0);
      for (var i = 1; i <= n; i++) {
        var c = R.safe(function () { return parent.property(i); }, null);
        if (c && c.matchName === args.matchName) return { index: i, reused: true, property: R.describe(c, 1, undefined, i) };
      }
    }
    if (!R.safe(function () { return parent.canAddProperty(args.matchName); }, false)) {
      R.fail("INVALID_ARGS", '"' + args.matchName + '" cannot be added under "' + parent.name + '"', undefined,
        "Check the parent path and matchName (property.get on the parent shows existing children).");
    }
    var added = R.call('addProperty("' + args.matchName + '")', function () { return parent.addProperty(args.matchName); });
    if (args.name) R.call("rename", function () { added.name = args.name; });
    var index = R.safe(function () { return added.propertyIndex; }, R.safe(function () { return parent.numProperties; }, 0));
    return { index: index, reused: false, property: R.describe(added, 1, undefined, index) };
  };

  H["property.remove"] = function (args) {
    var t = R.target(args, true);
    var prop = R.resolvePath(t.layer, args.path, 'layer "' + t.layer.name + '"');
    var snapshot = R.describe(prop, 1);
    if (args.dryRun) return { dryRun: true, wouldRemove: snapshot };
    R.call('remove "' + prop.name + '"', function () { prop.remove(); });
    return { removed: snapshot };
  };

  H["property.setAttributes"] = function (args) {
    var t = R.target(args, true);
    var prop = R.resolvePath(t.layer, args.path, 'layer "' + t.layer.name + '"');
    var a = args.attributes || {};
    if (a.name !== undefined) R.call("rename", function () { prop.name = a.name; });
    if (a.enabled !== undefined) R.call("set enabled", function () { prop.enabled = a.enabled; });
    if (a.maskMode !== undefined) {
      var mode = requireEnum("MaskMode", a.maskMode);
      R.call("set maskMode", function () { prop.maskMode = mode; });
    }
    if (a.inverted !== undefined) R.call("set inverted", function () { prop.inverted = a.inverted; });
    return { property: R.describe(prop, 0) };
  };

  H["project.open"] = function (args) {
    var f = new File(args.path);
    if (!f.exists) R.fail("NOT_FOUND", "File not found: " + args.path);
    var current = R.safe(function () { return app.project; }, null);
    if (current && R.safe(function () { return current.dirty; }, false)) {
      if (!args.discardChanges) {
        R.fail("CONFLICT", "The current project has unsaved changes", undefined,
          "Save it (project.save / checkpoint) first, or pass discardChanges=true.");
      }
      var close = requireEnum("CloseOptions", "DO_NOT_SAVE_CHANGES");
      R.call("project.close", function () { current.close(close); });
    }
    var project = R.call('open("' + args.path + '")', function () { return app.open(f); });
    return { opened: R.safe(function () { return project.file.fsName; }, args.path) };
  };

  H["render.comp"] = function (args) {
    var comp = R.resolveComp(args.comp);
    var rq = app.project.renderQueue;
    if (rq.rendering) R.fail("CONFLICT", "The Render Queue is already rendering");
    var paused = [];
    for (var i = 1; i <= rq.numItems; i++) {
      var it = rq.item(i);
      if (R.safe(function () { return it.render; }, false)) {
        try {
          it.render = false;
          paused.push(it);
        } catch (e) {
          /* finished items cannot be changed */
        }
      }
    }
    var rqi = null;
    var started = R.now();
    try {
      rqi = R.call("renderQueue.items.add", function () { return rq.items.add(comp); });
      if (args.startTime !== undefined) rqi.timeSpanStart = args.startTime;
      if (args.duration !== undefined) rqi.timeSpanDuration = args.duration;
      var om = rqi.outputModule(1);
      var template = null;
      if (args.template) {
        template = pickTemplate(om.templates, args.template);
        R.call("applyTemplate", function () { om.applyTemplate(template); });
        om = rqi.outputModule(1); // OM is invalidated after settings change
      }
      R.call("set output file", function () { om.file = new File(args.outputPath); });
      R.call("render", function () { rq.render(); });
      return {
        comp: R.compRef(comp),
        outputPath: R.safe(function () { return om.file.fsName; }, args.outputPath),
        template: template,
        elapsedMs: R.now() - started
      };
    } finally {
      if (rqi) {
        try {
          rqi.remove();
        } catch (e2) {
          /* ignore */
        }
      }
      for (var p = 0; p < paused.length; p++) {
        try {
          paused[p].render = true;
        } catch (e3) {
          /* ignore */
        }
      }
    }
  };
})(ROXY);
