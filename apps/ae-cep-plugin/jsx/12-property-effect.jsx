/* transform.* / property.* / keyframe.* / effect.* */
(function (R) {
  var H = R.handlers;
  var INTERP = { linear: "LINEAR", bezier: "BEZIER", hold: "HOLD" };

  /* Number of KeyframeEase objects setTemporalEaseAtKey expects: 2/3 for TwoD/ThreeD values, 1 for spatial/other. */
  function easeDimensions(prop) {
    if (R.safe(function () { return prop.isSpatial; }, false)) return 1;
    var v = R.safe(function () { return prop.value; }, undefined);
    return R.isArray(v) && (v.length === 2 || v.length === 3) ? v.length : 1;
  }

  /* Easy ease = Bezier + KeyframeEase(0, 33.33) on the eased side(s); the other side keeps its current settings. */
  function applyEase(prop, idx, ease, warn) {
    var bezier = R.enumValue("KeyframeInterpolationType", "BEZIER", warn);
    if (bezier === undefined) return;
    var n = easeDimensions(prop);
    function eased() {
      var list = [];
      for (var i = 0; i < n; i++) list.push(new KeyframeEase(0, 33.33));
      return list;
    }
    var inSide = ease !== "easeOut";
    var outSide = ease !== "easeIn";
    var inType = inSide ? bezier : R.safe(function () { return prop.keyInInterpolationType(idx); }, bezier);
    var outType = outSide ? bezier : R.safe(function () { return prop.keyOutInterpolationType(idx); }, bezier);
    var inEase = inSide ? eased() : R.call("keyInTemporalEase", function () { return prop.keyInTemporalEase(idx); });
    var outEase = outSide ? eased() : R.call("keyOutTemporalEase", function () { return prop.keyOutTemporalEase(idx); });
    R.call("setInterpolationTypeAtKey", function () { prop.setInterpolationTypeAtKey(idx, inType, outType); });
    R.call("setTemporalEaseAtKey", function () { prop.setTemporalEaseAtKey(idx, inEase, outEase); });
  }

  H["transform.get"] = function (args) {
    var t = R.target(args, false);
    return { layer: R.layerSummary(t.layer), time: R.def(args.time, null), transform: R.transformValues(t.layer, args.time) };
  };

  H["transform.set"] = function (args, ctx) {
    var t = R.target(args, true);
    var group = t.layer.property(R.MN.transform);
    var keys = R.filter(R.keys(args.values || {}), function (k) { return args.values[k] !== undefined; });
    if (keys.length === 0) R.fail("INVALID_ARGS", "`values` is empty");
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var prop = R.MN[key] ? R.safe(function () { return group.property(R.MN[key]); }, null) : null;
      if (!prop) {
        ctx.warn('Transform property "' + key + '" is not available on this layer (2D layer?)');
        continue;
      }
      R.setValue(prop, args.values[key], args.time, ctx.warn);
    }
    return { layer: R.layerSummary(t.layer), transform: R.transformValues(t.layer, args.time) };
  };

  H["property.get"] = function (args) {
    var t = R.target(args, false);
    if (args.path === undefined) {
      return { layer: R.layerSummary(t.layer), groups: R.listChildren(t.layer, 50), hint: "Common: transform, effects, text, masks" };
    }
    var prop = R.resolvePath(t.layer, args.path, 'layer "' + t.layer.name + '"');
    return { layer: { id: t.layer.id, name: t.layer.name }, property: R.describe(prop, R.def(args.depth, 1), args.time) };
  };

  H["property.set"] = function (args, ctx) {
    var t = R.target(args, true);
    var prop = R.resolvePath(t.layer, args.path, 'layer "' + t.layer.name + '"');
    return R.extend({ layer: { id: t.layer.id, name: t.layer.name } }, R.applyChange(prop, args, ctx.warn));
  };

  H["keyframe.add"] = function (args, ctx) {
    var t = R.target(args, true);
    var prop = R.resolvePath(t.layer, args.path, 'layer "' + t.layer.name + '"');
    if (R.isGroup(prop)) R.fail("INVALID_ARGS", '"' + prop.name + '" is a group; keyframes need a property');
    if (!R.safe(function () { return prop.canVaryOverTime; }, true)) R.fail("INVALID_ARGS", '"' + prop.name + '" cannot be animated');
    var keys = args.keys || [];
    var i;
    for (i = 0; i < keys.length; i++) {
      if (keys[i].time > t.comp.duration + 1e-6) ctx.warn("Key at " + keys[i].time + "s is beyond the comp duration (" + t.comp.duration + "s)");
    }
    var times = [];
    for (i = 0; i < keys.length; i++) {
      var k = keys[i];
      R.setValue(prop, k.value, k.time, ctx.warn);
      var idx = R.call("nearestKeyIndex", function () { return prop.nearestKeyIndex(k.time); });
      if (k.interpolation) {
        var it = R.enumValue("KeyframeInterpolationType", INTERP[k.interpolation], ctx.warn);
        if (it !== undefined) R.call("setInterpolationTypeAtKey", function () { prop.setInterpolationTypeAtKey(idx, it, it); });
      }
      if (k.ease) applyEase(prop, idx, k.ease, ctx.warn);
      times.push(R.safe(function () { return prop.keyTime(idx); }, k.time));
    }
    return {
      layer: { id: t.layer.id, name: t.layer.name },
      property: { name: prop.name, matchName: prop.matchName },
      added: R.map(times, function (tm) { return { time: tm, keyIndex: R.safe(function () { return prop.nearestKeyIndex(tm); }, null) }; }),
      numKeys: R.safe(function () { return prop.numKeys; }, 0)
    };
  };

  H["keyframe.remove"] = function (args) {
    var t = R.target(args, true);
    var prop = R.resolvePath(t.layer, args.path, 'layer "' + t.layer.name + '"');
    var numKeys = R.safe(function () { return prop.numKeys; }, 0);
    var modes = (args.time !== undefined ? 1 : 0) + (args.keyIndex !== undefined ? 1 : 0) + (args.all === true ? 1 : 0);
    if (modes !== 1) R.fail("INVALID_ARGS", "Specify exactly one of `time`, `keyIndex`, `all`");
    var indices = [];
    var i;
    if (args.all) {
      for (i = 1; i <= numKeys; i++) indices.push(i);
    } else if (args.keyIndex !== undefined) {
      indices.push(args.keyIndex);
    } else if (numKeys > 0) {
      var idx = prop.nearestKeyIndex(args.time);
      if (Math.abs(prop.keyTime(idx) - args.time) <= t.comp.frameDuration / 2 + 1e-9) indices.push(idx);
    }
    var bad = indices.length === 0;
    for (i = 0; i < indices.length; i++) {
      if (indices[i] < 1 || indices[i] > numKeys) bad = true;
    }
    if (bad) {
      var keyTimes = [];
      for (i = 1; i <= Math.min(numKeys, 100); i++) keyTimes.push(R.safe(function () { return prop.keyTime(i); }, null));
      R.fail("NOT_FOUND", 'No matching keyframe on "' + prop.name + '"', { keyTimes: keyTimes });
    }
    var removed = R.map(indices, function (n) {
      return { keyIndex: n, time: prop.keyTime(n), value: R.toJson(R.safe(function () { return prop.keyValue(n); }, null)) };
    });
    if (args.dryRun) return { dryRun: true, wouldRemove: removed };
    indices.sort(function (a, b) { return b - a; });
    for (i = 0; i < indices.length; i++) {
      var n = indices[i];
      R.call("removeKey(" + n + ")", function () { prop.removeKey(n); });
    }
    return { property: { name: prop.name, matchName: prop.matchName }, removed: removed, numKeys: R.safe(function () { return prop.numKeys; }, 0) };
  };

  /* ---------------- effects ---------------- */

  function installed() {
    var list = R.safe(function () { return app.effects; }, null);
    if (!list) R.fail("UNSUPPORTED", "app.effects is not available in this After Effects build");
    var out = [];
    for (var i = 0; i < list.length; i++) {
      out.push({ displayName: list[i].displayName, matchName: list[i].matchName, category: list[i].category });
    }
    return out;
  }

  function resolveEffect(layer, sel) {
    var parade = layer.property(R.MN.effects);
    var s = typeof sel === "string" ? { name: sel } : typeof sel === "number" ? { index: sel } : sel;
    var applied = R.effectsOnLayer(layer);
    var matches = R.filter(applied, function (e) {
      return (s.index === undefined || e.index === s.index) && (s.name === undefined || e.name === s.name) &&
        (s.matchName === undefined || e.matchName === s.matchName);
    });
    if (matches.length === 1) return parade.property(matches[0].index);
    if (matches.length === 0) R.fail("NOT_FOUND", "No effect matches " + R.stringify(sel) + ' on layer "' + layer.name + '"', { applied: applied });
    R.fail("AMBIGUOUS_SELECTOR", matches.length + " effects match " + R.stringify(sel), { candidates: matches }, "Select by index.");
  }

  H["effect.listAvailable"] = function (args) {
    var f = args.filter ? String(args.filter).toLowerCase() : null;
    var c = args.category ? String(args.category).toLowerCase() : null;
    var all = R.filter(installed(), function (e) {
      return (!f || String(e.displayName).toLowerCase().indexOf(f) >= 0 || String(e.matchName).toLowerCase().indexOf(f) >= 0) &&
        (!c || String(e.category || "").toLowerCase().indexOf(c) >= 0);
    });
    var offset = R.def(args.offset, 0);
    return { total: all.length, offset: offset, effects: all.slice(offset, offset + R.def(args.limit, 50)) };
  };

  H["effect.listOnLayer"] = function (args) {
    var t = R.target(args, false);
    return { layer: { id: t.layer.id, name: t.layer.name }, effects: R.effectsOnLayer(t.layer) };
  };

  H["effect.add"] = function (args) {
    var t = R.target(args, true);
    var matchName = args.matchName;
    if (!matchName) {
      if (!args.displayName) R.fail("INVALID_ARGS", "Provide `matchName` (preferred) or `displayName`");
      var wanted = String(args.displayName).toLowerCase();
      var all = installed();
      var found = R.filter(all, function (e) { return String(e.displayName).toLowerCase() === wanted; });
      if (found.length === 0) {
        var similar = R.filter(all, function (e) {
          return String(e.displayName).toLowerCase().indexOf(wanted) >= 0 || String(e.matchName).toLowerCase().indexOf(wanted) >= 0;
        }).slice(0, 15);
        R.fail("NOT_FOUND", 'No installed effect named "' + args.displayName + '"', { similar: similar },
          "Use effect.listAvailable with a filter, then pass matchName.");
      }
      if (found.length > 1) R.fail("AMBIGUOUS_SELECTOR", found.length + ' installed effects are named "' + args.displayName + '"', { candidates: found });
      matchName = found[0].matchName;
    }
    var parade = t.layer.property(R.MN.effects);
    if (!R.safe(function () { return parade.canAddProperty(matchName); }, false)) {
      R.fail("NOT_FOUND", 'Effect "' + matchName + '" cannot be added to layer "' + t.layer.name + '"', undefined,
        "Check the matchName with effect.listAvailable (the effect may not be installed).");
    }
    var fx = R.call('addProperty("' + matchName + '")', function () { return parade.addProperty(matchName); });
    if (args.name) fx.name = args.name;
    return { layer: { id: t.layer.id, name: t.layer.name }, effect: R.describe(fx, 1, undefined, R.safe(function () { return fx.propertyIndex; }, undefined)) };
  };

  H["effect.getProperties"] = function (args) {
    var t = R.target(args, false);
    var fx = resolveEffect(t.layer, args.effect);
    return {
      layer: { id: t.layer.id, name: t.layer.name },
      effect: R.describe(fx, R.def(args.depth, 2), args.time, R.safe(function () { return fx.propertyIndex; }, undefined))
    };
  };

  H["effect.setProperty"] = function (args, ctx) {
    var t = R.target(args, true);
    var fx = resolveEffect(t.layer, args.effect);
    var prop = R.resolvePath(fx, args.property, 'effect "' + fx.name + '"');
    return R.extend({ layer: { id: t.layer.id, name: t.layer.name }, effect: { name: fx.name, matchName: fx.matchName } },
      R.applyChange(prop, args, ctx.warn));
  };
})(ROXY);
