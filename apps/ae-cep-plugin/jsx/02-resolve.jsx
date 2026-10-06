/* Selector resolution (AMBIGUOUS_SELECTOR instead of guessing) */
(function (R) {
  var MAX_CANDIDATES = 20;

  R.isComp = function (item) {
    return !!item && typeof R.safe(function () {
      return item.numLayers;
    }, undefined) === "number" && !!R.safe(function () {
      return item.layers;
    }, null);
  };

  R.allComps = function () {
    var project = app.project;
    var out = [];
    for (var i = 1; i <= project.numItems; i++) {
      var item = R.safe(function () {
        return project.item(i);
      }, null);
      if (item && R.isComp(item)) out.push(item);
    }
    return out;
  };

  R.activeComp = function () {
    var item = R.safe(function () {
      return app.project.activeItem;
    }, null);
    return item && R.isComp(item) ? item : null;
  };

  R.compRef = function (c) {
    return { id: c.id, name: c.name };
  };

  function firstComps() {
    return R.map(R.allComps().slice(0, 30), R.compRef);
  }

  function pickOne(matches, what, sel, ref, available) {
    if (matches.length === 1) return matches[0];
    if (matches.length === 0) {
      R.fail("NOT_FOUND", "No " + what + " matches " + R.stringify(sel), { available: available() });
    }
    R.fail("AMBIGUOUS_SELECTOR", matches.length + " " + what + " candidates match " + R.stringify(sel),
      { candidates: R.map(matches.slice(0, MAX_CANDIDATES), ref), total: matches.length },
      "Retry with a more specific selector (id is always unique).");
  }

  R.normComp = function (sel) {
    if (sel === undefined || sel === null) return { active: true };
    if (typeof sel === "string") return { name: sel };
    if (typeof sel === "number") return { id: sel };
    if (R.keys(sel).length === 0) return { active: true };
    return sel;
  };

  R.resolveComp = function (selector) {
    var sel = R.normComp(selector);
    if (sel.active && sel.id === undefined && sel.name === undefined && sel.roxyId === undefined) {
      var a = R.activeComp();
      if (!a) R.fail("NOT_FOUND", "No active composition", { available: firstComps() },
        "Pass `comp` (name or id), or open a composition in the viewer.");
      return a;
    }
    if (sel.id !== undefined && sel.name === undefined && sel.roxyId === undefined) {
      var byId = R.safe(function () {
        return app.project.itemByID(sel.id);
      }, null);
      if (byId && R.isComp(byId)) return byId;
      R.fail("NOT_FOUND", "No composition with id " + sel.id, { available: firstComps() });
    }
    var active = sel.active ? R.activeComp() : null;
    var matches = R.filter(R.allComps(), function (c) {
      if (sel.id !== undefined && c.id !== sel.id) return false;
      if (sel.name !== undefined && c.name !== sel.name) return false;
      if (sel.roxyId !== undefined) {
        var m = R.readMeta(c);
        if (!m || m.roxyId !== sel.roxyId) return false;
      }
      if (sel.active && (!active || active.id !== c.id)) return false;
      return true;
    });
    return pickOne(matches, "composition", sel, R.compRef, firstComps);
  };

  /* AV items (footage, comps) that can become layers. Folders have no duration. */
  R.allAvItems = function () {
    var project = app.project;
    var out = [];
    for (var i = 1; i <= project.numItems; i++) {
      var item = R.safe(function () { return project.item(i); }, null);
      if (item && typeof R.safe(function () { return item.duration; }, undefined) === "number") out.push(item);
    }
    return out;
  };

  R.itemSummary = function (item) {
    return {
      id: item.id,
      name: item.name,
      kind: R.isComp(item) ? "comp" : "footage",
      duration: R.safe(function () { return item.duration; }, 0),
      width: R.safe(function () { return item.width; }, undefined),
      height: R.safe(function () { return item.height; }, undefined),
      hasAudio: R.safe(function () { return item.hasAudio; }, undefined),
      hasVideo: R.safe(function () { return item.hasVideo; }, undefined)
    };
  };

  R.resolveItem = function (selector) {
    var sel = typeof selector === "string" ? { name: selector } : typeof selector === "number" ? { id: selector } : selector || {};
    var items = R.allAvItems();
    var matches = R.filter(items, function (i) {
      return (sel.id === undefined || i.id === sel.id) && (sel.name === undefined || i.name === sel.name);
    });
    return pickOne(matches, "project item", sel, R.itemSummary, function () {
      return R.map(items.slice(0, 30), R.itemSummary);
    });
  };

  R.layerType = function (layer) {
    var mn = R.safe(function () {
      return layer.matchName;
    }, "");
    if (mn === "ADBE Text Layer") return "text";
    if (mn === "ADBE Vector Layer") return "shape";
    if (mn === "ADBE Camera Layer") return "camera";
    if (mn === "ADBE Light Layer") return "light";
    if (R.safe(function () {
      return layer.nullLayer;
    }, false)) return "null";
    if (R.safe(function () {
      return layer.adjustmentLayer;
    }, false)) return "adjustment";
    var source = R.safe(function () {
      return layer.source;
    }, null);
    if (source) {
      if (R.isComp(source)) return "precomp";
      if (R.safe(function () { return source.hasAudio; }, false) && !R.safe(function () { return source.hasVideo; }, true)) return "audio";
      var main = R.safe(function () {
        return source.mainSource;
      }, null);
      if (main && R.safe(function () {
        return main.color;
      }, undefined) !== undefined) return "solid";
      return "footage";
    }
    return mn === "ADBE AV Layer" ? "av" : "unknown";
  };

  R.layerRef = function (l) {
    return { id: l.id, index: l.index, name: l.name, type: R.layerType(l) };
  };

  R.allLayers = function (comp) {
    var out = [];
    for (var i = 1; i <= comp.numLayers; i++) {
      var l = R.safe(function () {
        return comp.layer(i);
      }, null);
      if (l) out.push(l);
    }
    return out;
  };

  R.normLayer = function (sel) {
    if (typeof sel === "string") return { name: sel };
    if (typeof sel === "number") return { id: sel };
    return sel || {};
  };

  R.resolveLayer = function (comp, selector) {
    var sel = R.normLayer(selector);
    if (R.keys(sel).length === 0) R.fail("INVALID_ARGS", "Empty layer selector");
    var layers = R.allLayers(comp);
    var matches = R.filter(layers, function (l) {
      if (sel.id !== undefined && l.id !== sel.id) return false;
      if (sel.index !== undefined && l.index !== sel.index) return false;
      if (sel.name !== undefined && l.name !== sel.name) return false;
      if (sel.type !== undefined && R.layerType(l) !== sel.type) return false;
      if (sel.roxyId !== undefined || sel.role !== undefined || sel.tag !== undefined) {
        var m = R.readMeta(l) || {};
        if (sel.roxyId !== undefined && m.roxyId !== sel.roxyId) return false;
        if (sel.role !== undefined && m.role !== sel.role) return false;
        if (sel.tag !== undefined && !(m.tags && R.contains(m.tags, sel.tag))) return false;
      }
      return true;
    });
    return pickOne(matches, 'layer in comp "' + comp.name + '"', sel, R.layerRef, function () {
      return R.map(layers.slice(0, 30), R.layerRef);
    });
  };

  /** comp + layer from args; with forWrite, refuse targets locked for AI. */
  R.target = function (args, forWrite) {
    var comp = R.resolveComp(args.comp);
    var layer = R.resolveLayer(comp, args.layer);
    if (forWrite) {
      R.assertNotLocked(comp, 'Composition "' + comp.name + '"');
      R.assertNotLocked(layer, 'Layer "' + layer.name + '"');
    }
    return { comp: comp, layer: layer };
  };
})(ROXY);
