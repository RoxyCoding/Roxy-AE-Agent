/* comp.* / layer.* / text.* */
(function (R) {
  var H = R.handlers;
  var JUSTIFY = { left: "LEFT_JUSTIFY", center: "CENTER_JUSTIFY", right: "RIGHT_JUSTIFY" };

  H["comp.create"] = function (args, ctx) {
    var existing = R.filter(R.allComps(), function (c) { return c.name === args.name; });
    if (existing.length > 0 && !args.allowDuplicateName) {
      R.fail("CONFLICT", 'A composition named "' + args.name + '" already exists', { existing: R.map(existing, R.compRef) },
        "Use the existing comp, choose another name, or pass allowDuplicateName=true.");
    }
    var comp = R.call("items.addComp", function () {
      return app.project.items.addComp(args.name, args.width, args.height, R.def(args.pixelAspect, 1), args.duration, args.fps);
    });
    if (args.bgColor) R.call("set bgColor", function () { comp.bgColor = args.bgColor; });
    R.writeMeta(comp, R.extend({ managedBy: "roxy" }, args.roxy), ctx.warn);
    if (R.def(args.open, true)) {
      try {
        comp.openInViewer();
      } catch (e) {
        ctx.warn("openInViewer failed: " + R.errMsg(e));
      }
    }
    return { compId: comp.id, comp: R.compSummary(comp) };
  };

  H["comp.get"] = function (args) {
    var comp = R.resolveComp(args.comp);
    var out = R.compDetails(comp);
    if (R.def(args.includeLayers, true)) out.layers = R.map(R.allLayers(comp), R.layerSummary);
    return out;
  };

  H["comp.list"] = function (args) {
    var f = args.filter ? String(args.filter).toLowerCase() : null;
    var comps = R.filter(R.allComps(), function (c) { return !f || String(c.name).toLowerCase().indexOf(f) >= 0; });
    var active = R.activeComp();
    return {
      total: comps.length,
      comps: R.map(comps.slice(0, R.def(args.limit, 200)), function (c) {
        var s = R.compSummary(c);
        return { id: s.id, name: s.name, width: s.width, height: s.height, fps: s.fps, duration: s.duration, numLayers: s.numLayers };
      }),
      activeCompId: active ? active.id : null
    };
  };

  H["layer.list"] = function (args) {
    var comp = R.resolveComp(args.comp);
    var layers = R.filter(R.allLayers(comp), function (l) { return !args.type || R.layerType(l) === args.type; });
    return { comp: R.compRef(comp), total: layers.length, layers: R.map(layers.slice(0, R.def(args.limit, 300)), R.layerSummary) };
  };

  H["layer.get"] = function (args) {
    var t = R.target(args, false);
    return {
      comp: R.compRef(t.comp),
      layer: R.layerSummary(t.layer),
      transform: R.transformValues(t.layer),
      effects: R.effectsOnLayer(t.layer),
      comment: R.safe(function () { return t.layer.comment; }, "")
    };
  };

  H["layer.delete"] = function (args) {
    var t = R.target(args, true);
    var snapshot = {
      comp: R.compRef(t.comp),
      layer: R.layerSummary(t.layer),
      transform: R.transformValues(t.layer),
      effects: R.effectsOnLayer(t.layer)
    };
    if (args.dryRun) return { dryRun: true, wouldDelete: snapshot };
    R.call('remove layer "' + t.layer.name + '"', function () { t.layer.remove(); });
    return { deleted: snapshot };
  };

  H["layer.duplicate"] = function (args, ctx) {
    var t = R.target(args, false);
    R.assertNotLocked(t.comp, 'Composition "' + t.comp.name + '"');
    var dup = R.call('duplicate layer "' + t.layer.name + '"', function () { return t.layer.duplicate(); });
    if (args.newName) dup.name = args.newName;
    var meta = R.readMeta(dup);
    if (meta) {
      var rest = {};
      var keys = R.keys(meta);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i] !== "roxyId" && keys[i] !== "lockedForAI") rest[keys[i]] = meta[keys[i]];
      }
      if (args.roxyId) rest.roxyId = args.roxyId;
      R.replaceMeta(dup, rest);
      if (meta.roxyId && !args.roxyId) ctx.warn("roxyId was cleared on the duplicate to keep Roxy IDs unique");
    } else if (args.roxyId) {
      R.writeMeta(dup, { roxyId: args.roxyId }, ctx.warn);
    }
    return { source: R.layerSummary(t.layer), duplicate: R.layerSummary(dup) };
  };

  H["text.create"] = function (args, ctx) {
    var comp = R.resolveComp(args.comp);
    R.assertNotLocked(comp, 'Composition "' + comp.name + '"');
    var layer = R.call("layers.addText", function () { return comp.layers.addText(args.text); });
    if (args.name) layer.name = args.name;

    var sourceText = layer.property(R.MN.text).property(R.MN.textDocument);
    var doc = sourceText.value;
    var changed = false;
    if (args.fontSize !== undefined) { doc.fontSize = args.fontSize; changed = true; }
    if (args.font !== undefined) { doc.font = args.font; changed = true; }
    if (args.fillColor !== undefined) { doc.fillColor = args.fillColor; changed = true; }
    var just = R.enumValue("ParagraphJustification", JUSTIFY[R.def(args.justification, "center")], ctx.warn);
    if (just !== undefined) { doc.justification = just; changed = true; }
    if (changed) R.call("set Source Text", function () { sourceText.setValue(doc); });

    var transform = layer.property(R.MN.transform);
    if (R.def(args.centerAnchor, true)) {
      var rect = R.safe(function () { return layer.sourceRectAtTime(0, false); }, null);
      if (rect) {
        R.call("set anchorPoint", function () {
          transform.property(R.MN.anchorPoint).setValue([rect.left + rect.width / 2, rect.top + rect.height / 2]);
        });
      } else {
        ctx.warn("sourceRectAtTime unavailable; anchor point not centered");
      }
    }
    var position = args.position || [comp.width / 2, comp.height / 2];
    R.call("set position", function () { transform.property(R.MN.position).setValue(position); });
    R.writeMeta(layer, R.extend({ managedBy: "roxy" }, args.roxy), ctx.warn);
    return { comp: R.compRef(comp), layer: R.layerSummary(layer), transform: R.transformValues(layer) };
  };

  H["text.setText"] = function (args) {
    var t = R.target(args, true);
    var sourceText = R.safe(function () { return t.layer.property(R.MN.text).property(R.MN.textDocument); }, null);
    if (!sourceText) R.fail("INVALID_ARGS", 'Layer "' + t.layer.name + '" is not a text layer');
    var doc = sourceText.value;
    doc.text = args.text;
    if (args.time !== undefined) {
      R.call("Source Text setValueAtTime", function () { sourceText.setValueAtTime(args.time, doc); });
    } else {
      if (R.safe(function () { return sourceText.numKeys; }, 0) > 0) R.fail("INVALID_ARGS", "Source Text has keyframes; pass `time`");
      R.call("Source Text setValue", function () { sourceText.setValue(doc); });
    }
    return { layer: R.layerSummary(t.layer), text: args.text };
  };
})(ROXY);
