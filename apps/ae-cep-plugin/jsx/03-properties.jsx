/* Property paths, value conversion, serialization */
(function (R) {
  var MN = {
    transform: "ADBE Transform Group",
    effects: "ADBE Effect Parade",
    masks: "ADBE Mask Parade",
    text: "ADBE Text Properties",
    textDocument: "ADBE Text Document",
    anchorPoint: "ADBE Anchor Point",
    position: "ADBE Position",
    scale: "ADBE Scale",
    orientation: "ADBE Orientation",
    xRotation: "ADBE Rotate X",
    yRotation: "ADBE Rotate Y",
    rotation: "ADBE Rotate Z",
    opacity: "ADBE Opacity"
  };
  R.MN = MN;
  R.TRANSFORM_KEYS = ["anchorPoint", "position", "scale", "orientation", "xRotation", "yRotation", "rotation", "opacity"];

  var TOP_ALIASES = { transform: MN.transform, effects: MN.effects, effect: MN.effects, masks: MN.masks, text: MN.text };
  var TRANSFORM_ALIASES = {
    anchorpoint: MN.anchorPoint,
    anchor: MN.anchorPoint,
    position: MN.position,
    scale: MN.scale,
    orientation: MN.orientation,
    xrotation: MN.xRotation,
    yrotation: MN.yRotation,
    rotation: MN.rotation,
    zrotation: MN.rotation,
    opacity: MN.opacity
  };

  R.isGroup = function (p) {
    return typeof R.safe(function () {
      return p.numProperties;
    }, undefined) === "number";
  };

  R.listChildren = function (group, limit) {
    var out = [];
    var n = R.safe(function () {
      return group.numProperties;
    }, 0);
    for (var i = 1; i <= Math.min(n, limit); i++) {
      var c = R.safe(function () {
        return group.property(i);
      }, null);
      if (c) out.push({ index: i, name: R.safe(function () { return c.name; }, ""), matchName: R.safe(function () { return c.matchName; }, "") });
    }
    return out;
  };

  function normPath(path) {
    if (typeof path === "string") {
      var raw = path.split("/");
      var segs = [];
      for (var i = 0; i < raw.length; i++) {
        var s = raw[i].replace(/^\s+|\s+$/g, "");
        if (s.length > 0) segs.push(s);
      }
      return segs;
    }
    return path;
  }

  R.resolvePath = function (root, path, rootLabel) {
    var segs = normPath(path);
    var rootIsLayer = R.safe(function () {
      return root.containingComp;
    }, undefined) !== undefined;
    var cur = root;
    var walked = [rootLabel];
    for (var i = 0; i < segs.length; i++) {
      var raw = segs[i];
      var seg = raw;
      if (typeof seg === "string") {
        var lower = seg.toLowerCase();
        var compact = lower.replace(/[\s_\-]/g, "");
        if (i === 0 && rootIsLayer && TOP_ALIASES[lower]) seg = TOP_ALIASES[lower];
        else if (R.safe(function () { return cur.matchName; }, "") === MN.transform && TRANSFORM_ALIASES[compact]) seg = TRANSFORM_ALIASES[compact];
      }
      var parent = cur;
      var next = R.safe(function () {
        return parent.property(seg);
      }, null);
      if (!next) {
        R.fail("NOT_FOUND", 'Property "' + raw + '" not found under ' + walked.join(" > "),
          { available: R.isGroup(parent) ? R.listChildren(parent, 60) : [] },
          "Use matchName (stable across languages) or a 1-based index from `available`.");
      }
      walked.push(String(R.safe(function () { return next.name; }, seg)));
      cur = next;
    }
    return cur;
  };

  R.toJson = function (v) {
    if (v === null || v === undefined) return null;
    var t = typeof v;
    if (t === "number" || t === "string" || t === "boolean") return v;
    if (R.isArray(v)) return R.map(v, R.toJson);
    if (t === "object") {
      if (typeof R.safe(function () { return v.text; }, undefined) === "string") {
        return {
          text: v.text,
          font: R.safe(function () { return v.font; }, undefined),
          fontSize: R.safe(function () { return v.fontSize; }, undefined),
          fillColor: R.safe(function () { return v.applyFill ? R.toJson(v.fillColor) : undefined; }, undefined),
          tracking: R.safe(function () { return v.tracking; }, undefined)
        };
      }
      var verts = R.safe(function () { return v.vertices; }, undefined);
      if (verts && R.isArray(verts)) return { shape: { closed: R.safe(function () { return v.closed; }, null), vertexCount: verts.length } };
      return { type: "object" };
    }
    return String(v);
  };

  R.describe = function (p, depth, time, index) {
    var info = { name: R.safe(function () { return p.name; }, ""), matchName: R.safe(function () { return p.matchName; }, "") };
    if (index !== undefined) info.index = index;
    if (R.isGroup(p)) {
      info.group = true;
      var n = R.safe(function () { return p.numProperties; }, 0);
      info.childCount = n;
      if (depth > 0) {
        info.children = [];
        for (var i = 1; i <= n; i++) {
          var c = R.safe(function () { return p.property(i); }, null);
          if (c) info.children.push(R.describe(c, depth - 1, time, i));
        }
      }
      return info;
    }
    var raw = time !== undefined
      ? R.safe(function () { return p.valueAtTime(time, false); }, undefined)
      : R.safe(function () { return p.value; }, undefined);
    if (raw !== undefined) info.value = R.toJson(raw);
    var numKeys = R.safe(function () { return p.numKeys; }, 0);
    if (numKeys > 0) info.numKeys = numKeys;
    var expr = R.safe(function () { return p.expression; }, "");
    if (expr) {
      info.expression = expr.length > 500 ? expr.substring(0, 500) + "..." : expr;
      info.expressionEnabled = R.safe(function () { return p.expressionEnabled; }, false);
      var err = R.safe(function () { return p.expressionError; }, "");
      if (err) info.expressionError = err;
    }
    if (R.safe(function () { return p.hasMin; }, false)) info.min = R.safe(function () { return p.minValue; }, undefined);
    if (R.safe(function () { return p.hasMax; }, false)) info.max = R.safe(function () { return p.maxValue; }, undefined);
    var units = R.safe(function () { return p.unitsText; }, "");
    if (units) info.units = units;
    return info;
  };

  /* {vertices, inTangents?, outTangents?, closed?} -> Shape (mask path / shape path values). */
  R.toShape = function (v) {
    var s = new Shape();
    var zeros = R.map(v.vertices, function () { return [0, 0]; });
    s.vertices = v.vertices;
    s.inTangents = v.inTangents || zeros;
    s.outTangents = v.outTangents || zeros;
    s.closed = v.closed === undefined ? true : v.closed;
    return s;
  };

  /** Adapt AI values to the property's shape (see ae-plugin coerceValue). */
  R.coerce = function (prop, value, warn) {
    var current = R.safe(function () { return prop.value; }, undefined);
    if (value && typeof value === "object" && R.isArray(value.vertices) && current && typeof current === "object" &&
        R.isArray(R.safe(function () { return current.vertices; }, undefined))) {
      return R.toShape(value);
    }
    if (R.isArray(current)) {
      if (typeof value === "number") {
        return R.map(current, function () { return value; });
      }
      if (R.isArray(value) && value.length < current.length) {
        warn("Value had " + value.length + " components, property has " + current.length + "; missing components kept from the current value");
        var filled = value.slice(0);
        for (var i = value.length; i < current.length; i++) filled.push(current[i]);
        return filled;
      }
      return value;
    }
    if (current && typeof current === "object" && typeof R.safe(function () { return current.text; }, undefined) === "string") {
      if (typeof value === "string") {
        current.text = value;
        return current;
      }
      if (value && typeof value === "object") {
        var keys = ["text", "font", "fontSize", "fillColor", "strokeColor", "strokeWidth", "tracking", "leading"];
        for (var k = 0; k < keys.length; k++) {
          if (value[keys[k]] !== undefined) current[keys[k]] = value[keys[k]];
        }
        return current;
      }
    }
    return value;
  };

  R.setValue = function (prop, value, time, warn) {
    if (R.isGroup(prop)) R.fail("INVALID_ARGS", '"' + prop.name + '" is a property group, not a property');
    var v = R.coerce(prop, value, warn);
    if (time !== undefined && time !== null) {
      R.call("setValueAtTime(" + time + ') on "' + prop.name + '"', function () { prop.setValueAtTime(time, v); });
    } else {
      if (R.safe(function () { return prop.numKeys; }, 0) > 0) {
        R.fail("INVALID_ARGS", '"' + prop.name + '" has keyframes; pass `time` to set a keyframe value', undefined,
          "Use keyframe.add / time, or remove keyframes first.");
      }
      R.call('setValue on "' + prop.name + '"', function () { prop.setValue(v); });
    }
  };

  R.setExpression = function (prop, expression) {
    if (!R.safe(function () { return prop.canSetExpression; }, false)) R.fail("INVALID_ARGS", '"' + prop.name + '" does not accept expressions');
    R.call('set expression on "' + prop.name + '"', function () { prop.expression = expression; });
    var err = R.safe(function () { return prop.expressionError; }, "");
    return err ? { expressionError: err } : {};
  };

  R.applyChange = function (prop, change, warn) {
    if (change.value === undefined && change.expression === undefined && change.expressionEnabled === undefined) {
      R.fail("INVALID_ARGS", "Provide `value`, `expression` and/or `expressionEnabled`");
    }
    if (change.value !== undefined) R.setValue(prop, change.value, change.time, warn);
    var result = {};
    if (change.expression !== undefined) R.extend(result, R.setExpression(prop, change.expression));
    if (change.expressionEnabled !== undefined) {
      R.call("set expressionEnabled", function () { prop.expressionEnabled = change.expressionEnabled; });
    }
    result.property = R.describe(prop, 0, change.time);
    return result;
  };

  /* ---------------- serialization ---------------- */

  R.compSummary = function (c) {
    return {
      id: c.id,
      name: c.name,
      width: R.safe(function () { return c.width; }, 0),
      height: R.safe(function () { return c.height; }, 0),
      fps: R.safe(function () { return c.frameRate; }, 0),
      duration: R.safe(function () { return c.duration; }, 0),
      numLayers: R.safe(function () { return c.numLayers; }, 0),
      roxy: R.readMeta(c)
    };
  };

  R.compDetails = function (c) {
    return R.extend(R.compSummary(c), {
      pixelAspect: R.safe(function () { return c.pixelAspect; }, undefined),
      bgColor: R.safe(function () { return R.toJson(c.bgColor); }, undefined),
      time: R.safe(function () { return c.time; }, undefined),
      workAreaStart: R.safe(function () { return c.workAreaStart; }, undefined),
      workAreaDuration: R.safe(function () { return c.workAreaDuration; }, undefined)
    });
  };

  R.layerSummary = function (l) {
    var parent = R.safe(function () { return l.parent; }, null);
    var roxy = R.readMeta(l);
    var s = {
      id: l.id,
      index: l.index,
      name: l.name,
      type: R.layerType(l),
      enabled: R.safe(function () { return l.enabled; }, true),
      inPoint: R.safe(function () { return l.inPoint; }, 0),
      outPoint: R.safe(function () { return l.outPoint; }, 0)
    };
    if (parent) s.parentId = parent.id;
    if (R.safe(function () { return l.locked; }, false)) s.locked = true;
    if (R.safe(function () { return l.threeDLayer; }, false)) s.threeD = true;
    if (roxy) s.roxy = roxy;
    return s;
  };

  R.transformValues = function (l, time) {
    var out = {};
    var group = R.safe(function () { return l.property(MN.transform); }, null);
    if (!group) return out;
    var is3d = R.safe(function () { return l.threeDLayer; }, false);
    for (var i = 0; i < R.TRANSFORM_KEYS.length; i++) {
      var key = R.TRANSFORM_KEYS[i];
      if ((key === "orientation" || key === "xRotation" || key === "yRotation") && !is3d) continue;
      var p = R.safe(function () { return group.property(MN[key]); }, null);
      if (!p) continue;
      var v = time !== undefined && time !== null
        ? R.safe(function () { return p.valueAtTime(time, false); }, undefined)
        : R.safe(function () { return p.value; }, undefined);
      if (v === undefined) continue;
      out[key] = R.toJson(v);
      var nk = R.safe(function () { return p.numKeys; }, 0);
      if (nk > 0) out[key + "Keys"] = nk;
    }
    return out;
  };

  R.effectsOnLayer = function (l) {
    var out = [];
    var parade = R.safe(function () { return l.property(MN.effects); }, null);
    var n = parade ? R.safe(function () { return parade.numProperties; }, 0) : 0;
    for (var i = 1; i <= n; i++) {
      var fx = R.safe(function () { return parade.property(i); }, null);
      if (fx) out.push({ index: i, name: fx.name, matchName: fx.matchName, enabled: R.safe(function () { return fx.enabled; }, true) });
    }
    return out;
  };
})(ROXY);
