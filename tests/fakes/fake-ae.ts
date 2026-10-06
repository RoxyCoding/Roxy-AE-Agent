/**
 * In-memory fake of the subset of the After Effects object model used by both plugins
 * (UXP: https://developer.adobe.com/after-effects/uxp/after-effects-api/ , ExtendScript:
 * https://ae-scripting.docsforadobe.dev/ ). Names, 1-based indices, property()/addProperty(),
 * keyframes, masks, shape groups, text animators, import and the Render Queue are modelled closely
 * enough to exercise the command logic. It is a test double: it does NOT prove behaviour inside AE.
 */
import { existsSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { makePng } from "./png.js";
import { setHostApp } from "../../apps/ae-plugin/src/ae/host.js";

let nextId = 100;

type Value = number | number[] | Record<string, unknown> | string | FakeShape;

const clone = <T>(v: T): T => {
  if (v instanceof FakeShape) return v.copy() as T;
  return typeof v === "object" && v !== null ? JSON.parse(JSON.stringify(v)) : v;
};

export class FakeShape {
  vertices: number[][] = [];
  inTangents: number[][] = [];
  outTangents: number[][] = [];
  closed = true;
  copy(): FakeShape {
    const s = new FakeShape();
    s.vertices = clone(this.vertices);
    s.inTangents = clone(this.inTangents);
    s.outTangents = clone(this.outTangents);
    s.closed = this.closed;
    return s;
  }
}

export class FakeKeyframeEase {
  constructor(
    public speed: number,
    public influence: number,
  ) {}
}

export const ENUMS = {
  KeyframeInterpolationType: { LINEAR: 6612, BEZIER: 6613, HOLD: 6614 },
  BlendingMode: { NORMAL: 5212, ADD: 5220, SCREEN: 5222, MULTIPLY: 5216 },
  MaskMode: { NONE: 6812, ADD: 6813, SUBTRACT: 6814, INTERSECT: 6815 },
  CloseOptions: { DO_NOT_SAVE_CHANGES: 1212, PROMPT_TO_SAVE_CHANGES: 1213, SAVE_CHANGES: 1214 },
};

type Child = FakeGroup | FakeProperty;

function indexIn(parent: FakeGroup | null, child: Child): number {
  return parent ? parent.children.indexOf(child) + 1 : 0;
}

export class FakeProperty {
  keys: Array<{ time: number; value: Value; inType?: number; outType?: number; inEase?: FakeKeyframeEase[]; outEase?: FakeKeyframeEase[] }> = [];
  expression = "";
  expressionEnabled = false;
  expressionError = "";
  canVaryOverTime = true;
  canSetExpression = true;
  /** AE lists unused text-animator properties as hidden children; they cannot be set until added. */
  hidden = false;
  parentProperty: FakeGroup | null = null;
  constructor(
    public name: string,
    public matchName: string,
    private staticValue: Value,
    public isSpatial = false,
  ) {}
  private assertVisible() {
    if (this.hidden) throw new Error("After Effects error: cannot set value; the property or a parent property is hidden");
  }
  get propertyIndex() {
    return indexIn(this.parentProperty, this);
  }
  get numKeys() {
    return this.keys.length;
  }
  get value(): Value {
    return this.valueAtTime(0, false);
  }
  setValue(v: Value) {
    this.assertVisible();
    if (this.keys.length) throw new Error("Can't use setValue on a property with keyframes");
    this.staticValue = clone(v);
  }
  setValueAtTime(t: number, v: Value) {
    this.assertVisible();
    const existing = this.keys.find((k) => Math.abs(k.time - t) < 1e-9);
    if (existing) existing.value = clone(v);
    else this.keys.push({ time: t, value: clone(v) });
    this.keys.sort((a, b) => a.time - b.time);
  }
  nearestKeyIndex(t: number) {
    let best = 1;
    this.keys.forEach((k, i) => {
      if (Math.abs(k.time - t) < Math.abs(this.keys[best - 1].time - t)) best = i + 1;
    });
    return best;
  }
  keyTime(i: number) {
    return this.keys[i - 1].time;
  }
  keyValue(i: number) {
    return clone(this.keys[i - 1].value);
  }
  removeKey(i: number) {
    if (i < 1 || i > this.keys.length) throw new Error("bad key index");
    this.keys.splice(i - 1, 1);
  }
  setInterpolationTypeAtKey(i: number, inType: number, outType?: number) {
    this.keys[i - 1].inType = inType;
    this.keys[i - 1].outType = outType ?? inType;
  }
  keyInInterpolationType(i: number) {
    return this.keys[i - 1].inType ?? ENUMS.KeyframeInterpolationType.LINEAR;
  }
  keyOutInterpolationType(i: number) {
    return this.keys[i - 1].outType ?? ENUMS.KeyframeInterpolationType.LINEAR;
  }
  private dims(): number {
    if (this.isSpatial) return 1;
    const v = this.value;
    return Array.isArray(v) && (v.length === 2 || v.length === 3) ? v.length : 1;
  }
  keyInTemporalEase(i: number) {
    return this.keys[i - 1].inEase ?? Array.from({ length: this.dims() }, () => new FakeKeyframeEase(0, 16.67));
  }
  keyOutTemporalEase(i: number) {
    return this.keys[i - 1].outEase ?? Array.from({ length: this.dims() }, () => new FakeKeyframeEase(0, 16.67));
  }
  setTemporalEaseAtKey(i: number, inEase: FakeKeyframeEase[], outEase?: FakeKeyframeEase[]) {
    if (inEase.length !== this.dims()) throw new Error(`expected ${this.dims()} ease objects, got ${inEase.length}`);
    this.keys[i - 1].inEase = inEase;
    this.keys[i - 1].outEase = outEase ?? inEase;
  }
  remove() {
    throw new Error("A simple property cannot be removed");
  }
  valueAtTime(t: number, _pre: boolean): Value {
    if (!this.keys.length) return clone(this.staticValue);
    if (t <= this.keys[0].time) return clone(this.keys[0].value);
    const last = this.keys[this.keys.length - 1];
    if (t >= last.time) return clone(last.value);
    const i = this.keys.findIndex((k) => k.time > t);
    const a = this.keys[i - 1];
    const b = this.keys[i];
    const f = (t - a.time) / (b.time - a.time);
    if (typeof a.value === "number" && typeof b.value === "number") return a.value + (b.value - a.value) * f;
    if (Array.isArray(a.value) && Array.isArray(b.value)) {
      const bv = b.value;
      return a.value.map((x, j) => x + (bv[j] - x) * f);
    }
    return clone(a.value);
  }
}

export class FakeGroup {
  children: Child[] = [];
  enabled = true;
  parentProperty: FakeGroup | null = null;
  // Mask attributes (only meaningful for "ADBE Mask Atom").
  maskMode = ENUMS.MaskMode.ADD;
  inverted = false;
  constructor(
    public name: string,
    public matchName: string,
    private addable: Record<string, () => FakeGroup | FakeProperty> = {},
  ) {}
  get numProperties() {
    return this.children.length;
  }
  get propertyIndex() {
    return indexIn(this.parentProperty, this);
  }
  add<T extends Child>(child: T): T {
    child.parentProperty = this;
    this.children.push(child);
    return child;
  }
  property(key: string | number): Child | null {
    if (typeof key === "number") return this.children[key - 1] ?? null;
    return this.children.find((c) => c.matchName === key || c.name === key) ?? null;
  }
  canAddProperty(mn: string) {
    return mn in this.addable;
  }
  addProperty(mn: string) {
    // Hidden candidate (text animator properties): adding makes it visible.
    const hidden = this.children.find((c) => c.matchName === mn && c instanceof FakeProperty && c.hidden) as FakeProperty | undefined;
    if (hidden) {
      hidden.hidden = false;
      return hidden;
    }
    const factory = this.addable[mn];
    if (!factory) throw new Error(`cannot add ${mn}`);
    return this.add(factory());
  }
  remove() {
    if (!this.parentProperty) throw new Error("cannot remove a root group");
    const siblings = this.parentProperty.children;
    siblings.splice(siblings.indexOf(this), 1);
    return true;
  }
}

const group = (name: string, mn: string, children: Child[] = [], addable: Record<string, () => Child> = {}) => {
  const g = new FakeGroup(name, mn, addable);
  for (const c of children) g.add(c);
  return g;
};

function makeGlow(): FakeGroup {
  return group("Glow", "ADBE Glo2", [
    new FakeProperty("Glow Threshold", "ADBE Glo2-0002", 60),
    new FakeProperty("Glow Radius", "ADBE Glo2-0003", 10),
  ]);
}

function makeMask(): FakeGroup {
  return group("Mask", "ADBE Mask Atom", [new FakeProperty("Mask Path", "ADBE Mask Shape", new FakeShape())]);
}

const SHAPE_ITEMS: Record<string, () => Child> = {
  "ADBE Vector Shape - Rect": () =>
    group("Rectangle Path", "ADBE Vector Shape - Rect", [
      new FakeProperty("Size", "ADBE Vector Rect Size", [100, 100]),
      new FakeProperty("Roundness", "ADBE Vector Rect Roundness", 0),
    ]),
  "ADBE Vector Shape - Ellipse": () =>
    group("Ellipse Path", "ADBE Vector Shape - Ellipse", [new FakeProperty("Size", "ADBE Vector Ellipse Size", [100, 100])]),
  "ADBE Vector Graphic - Fill": () =>
    group("Fill", "ADBE Vector Graphic - Fill", [new FakeProperty("Color", "ADBE Vector Fill Color", [1, 0, 0, 1])]),
  "ADBE Vector Graphic - Stroke": () =>
    group("Stroke", "ADBE Vector Graphic - Stroke", [
      new FakeProperty("Color", "ADBE Vector Stroke Color", [1, 1, 1, 1]),
      new FakeProperty("Stroke Width", "ADBE Vector Stroke Width", 2),
    ]),
};

function makeShapeGroup(): FakeGroup {
  return group("Group", "ADBE Vector Group", [group("Contents", "ADBE Vectors Group", [], SHAPE_ITEMS)]);
}

const ANIMATOR_PROPS: Record<string, () => Child> = {
  "ADBE Text Opacity": () => new FakeProperty("Opacity", "ADBE Text Opacity", 100),
  "ADBE Text Position 3D": () => new FakeProperty("Position", "ADBE Text Position 3D", [0, 0, 0], true),
  "ADBE Text Scale 3D": () => new FakeProperty("Scale", "ADBE Text Scale 3D", [100, 100, 100]),
  "ADBE Text Rotation": () => new FakeProperty("Rotation", "ADBE Text Rotation", 0),
  "ADBE Text Tracking Amount": () => new FakeProperty("Tracking Amount", "ADBE Text Tracking Amount", 0),
  "ADBE Text Blur": () => new FakeProperty("Blur", "ADBE Text Blur", [0, 0]),
};

function makeRangeSelector(): FakeGroup {
  return group("Range Selector 1", "ADBE Text Selector", [
    new FakeProperty("Start", "ADBE Text Percent Start", 0),
    new FakeProperty("End", "ADBE Text Percent End", 100),
    new FakeProperty("Offset", "ADBE Text Percent Offset", 0),
  ]);
}

function makeAnimator(): FakeGroup {
  // Mirrors AE 26.5: the animator comes with "Range Selector 1", and its Properties group lists every
  // candidate property as a HIDDEN child until it is added.
  const props = group("Properties", "ADBE Text Animator Properties", [], ANIMATOR_PROPS);
  for (const factory of Object.values(ANIMATOR_PROPS)) {
    const p = props.add(factory()) as FakeProperty;
    p.hidden = true;
  }
  return group("Animator 1", "ADBE Text Animator", [
    group("Selectors", "ADBE Text Selectors", [makeRangeSelector()], { "ADBE Text Selector": makeRangeSelector }),
    props,
  ]);
}

export class FakeFootage {
  id = nextId++;
  comment = "";
  footageMissing = false;
  mainSource = {};
  constructor(
    public name: string,
    public duration: number,
    public hasAudio: boolean,
    public hasVideo: boolean,
  ) {}
}

export class FakeLayer {
  id = nextId++;
  comment = "";
  enabled = true;
  locked = false;
  threeDLayer = false;
  parent: FakeLayer | null = null;
  inPoint = 0;
  outPoint: number;
  startTime = 0;
  stretch = 100;
  motionBlur = false;
  shy = false;
  solo = false;
  label = 0;
  blendingMode = ENUMS.BlendingMode.NORMAL;
  nullLayer = false;
  adjustmentLayer = false;
  source: unknown = null;
  private root = new FakeGroup("root", "root");
  constructor(
    public containingComp: FakeComp,
    public name: string,
    public matchName: string,
    text?: string,
  ) {
    this.outPoint = containingComp.duration;
    const t = this.root.add(group("Transform", "ADBE Transform Group"));
    t.add(new FakeProperty("Anchor Point", "ADBE Anchor Point", [0, 0], true));
    t.add(new FakeProperty("Position", "ADBE Position", [0, 0], true));
    t.add(new FakeProperty("Scale", "ADBE Scale", [100, 100]));
    t.add(new FakeProperty("Rotation", "ADBE Rotate Z", 0));
    t.add(new FakeProperty("Opacity", "ADBE Opacity", 100));
    this.root.add(group("Masks", "ADBE Mask Parade", [], { "ADBE Mask Atom": makeMask }));
    this.root.add(group("Effects", "ADBE Effect Parade", [], { "ADBE Glo2": makeGlow }));
    if (matchName === "ADBE Vector Layer") {
      this.root.add(group("Contents", "ADBE Root Vectors Group", [], { "ADBE Vector Group": makeShapeGroup, ...SHAPE_ITEMS }));
    }
    if (text !== undefined) {
      this.root.add(
        group("Text", "ADBE Text Properties", [
          new FakeProperty("Source Text", "ADBE Text Document", { text, fontSize: 36, font: "Arial", applyFill: true, fillColor: [1, 1, 1], justification: 0 }),
          group("Animators", "ADBE Text Animators", [], { "ADBE Text Animator": makeAnimator }),
        ]),
      );
    }
  }
  get index() {
    return this.containingComp.layerList.indexOf(this) + 1;
  }
  get numProperties() {
    return this.root.numProperties;
  }
  property(key: string | number) {
    return this.root.property(key);
  }
  sourceRectAtTime() {
    return { left: 0, top: -50, width: 300, height: 60 };
  }
  duplicate() {
    const dup = new FakeLayer(this.containingComp, this.name, this.matchName, "dup");
    dup.comment = this.comment;
    this.containingComp.layerList.splice(this.index - 1, 0, dup);
    return dup;
  }
  remove() {
    this.containingComp.layerList.splice(this.index - 1, 1);
    return true;
  }
  private moveToIndex(i: number) {
    const list = this.containingComp.layerList;
    list.splice(list.indexOf(this), 1);
    list.splice(i, 0, this);
  }
  moveToBeginning() {
    this.moveToIndex(0);
  }
  moveToEnd() {
    this.moveToIndex(this.containingComp.layerList.length);
  }
  moveBefore(other: FakeLayer) {
    const list = this.containingComp.layerList;
    list.splice(list.indexOf(this), 1);
    list.splice(list.indexOf(other), 0, this);
  }
  moveAfter(other: FakeLayer) {
    const list = this.containingComp.layerList;
    list.splice(list.indexOf(this), 1);
    list.splice(list.indexOf(other) + 1, 0, this);
  }
}

export class FakeComp {
  id = nextId++;
  comment = "";
  time = 0;
  layerList: FakeLayer[] = [];
  pixelAspect: number;
  constructor(
    public name: string,
    public width: number,
    public height: number,
    pixelAspect: number,
    public duration: number,
    public frameRate: number,
  ) {
    this.pixelAspect = pixelAspect;
  }
  get frameDuration() {
    return 1 / this.frameRate;
  }
  get numLayers() {
    return this.layerList.length;
  }
  layer(i: number) {
    return this.layerList[i - 1];
  }
  private push(l: FakeLayer) {
    this.layerList.unshift(l);
    return l;
  }
  get layers() {
    return {
      addText: (text: string) => this.push(new FakeLayer(this, text, "ADBE Text Layer", text)),
      addNull: () => {
        const l = new FakeLayer(this, "Null 1", "ADBE AV Layer");
        l.nullLayer = true;
        return this.push(l);
      },
      addShape: () => this.push(new FakeLayer(this, "Shape Layer 1", "ADBE Vector Layer")),
      addSolid: (color: number[], name: string) => {
        const l = new FakeLayer(this, name, "ADBE AV Layer");
        l.source = { mainSource: { color }, hasVideo: true, hasAudio: false };
        return this.push(l);
      },
      add: (item: FakeFootage | FakeComp) => {
        const l = new FakeLayer(this, item.name, "ADBE AV Layer");
        l.source = item;
        return this.push(l);
      },
    };
  }
  openInViewer() {
    fake.project.activeItem = this;
  }
  saveFrameToPng(_t: number, file: string | { fsName: string }) {
    const path = typeof file === "string" ? file : file.fsName;
    // Mimic an async DeferredCall: write the file shortly after returning.
    setTimeout(() => writeFileSync(path, makePng(Math.min(this.width, 64), Math.min(this.height, 36))), 30);
    return { duration: 0 };
  }
}

/** Accepts a UXP path string or an ExtendScript File. */
const pathOf = (f: string | { fsName: string }) => (typeof f === "string" ? f : f.fsName);

class FakeOutputModule {
  templates = ["Lossless", "H.264 - Match Render Settings - 15 Mbps", "PNG Sequence"];
  template: string | null = null;
  file: string | { fsName: string } = "";
  applyTemplate(t: string) {
    if (!this.templates.includes(t)) throw new Error(`no template ${t}`);
    this.template = t;
  }
}

class FakeRQItem {
  render = true;
  timeSpanStart = 0;
  timeSpanDuration = 0;
  private om = new FakeOutputModule();
  constructor(public comp: FakeComp) {
    this.timeSpanDuration = comp.duration;
  }
  outputModule(_i: number) {
    return this.om;
  }
  remove() {
    const list = fake.project.renderQueue.list;
    list.splice(list.indexOf(this), 1);
  }
}

export const undoLog: string[] = [];

/** Clear all fake project state between test suites. */
export function resetFake(): void {
  fake.project.comps.length = 0;
  fake.project.activeItem = null;
  fake.project.file = null;
  fake.project.dirty = false;
  fake.project.renderQueue.list.length = 0;
  fake.opened.length = 0;
  undoLog.length = 0;
}

export const fake = {
  appName: "After Effects (Fake)",
  version: "27.0.0",
  effects: [
    { displayName: "Glow", matchName: "ADBE Glo2", category: "Stylize", version: "1" },
    { displayName: "Gaussian Blur", matchName: "ADBE Gaussian Blur 2", category: "Blur & Sharpen", version: "1" },
  ],
  ...ENUMS,
  Shape: FakeShape,
  KeyframeEase: FakeKeyframeEase,
  ImportOptions: class {
    file: unknown;
    constructor(file?: unknown) {
      this.file = file;
    }
  },
  opened: [] as string[],
  open(file: string | { fsName: string }) {
    fake.opened.push(pathOf(file));
    return fake.project;
  },
  project: {
    file: null as string | null,
    dirty: false,
    activeItem: null as FakeComp | null,
    /** All project items (comps and footage). */
    comps: [] as Array<FakeComp | FakeFootage>,
    get numItems() {
      return this.comps.length;
    },
    item(i: number) {
      return this.comps[i - 1];
    },
    itemByID(id: number) {
      return this.comps.find((c) => c.id === id) ?? null;
    },
    get items() {
      return {
        addComp: (name: string, w: number, h: number, pa: number, d: number, fps: number) => {
          const c = new FakeComp(name, w, h, pa, d, fps);
          fake.project.comps.push(c);
          return c;
        },
      };
    },
    importFile(io: { file: string | { fsName: string } }) {
      const p = pathOf(io.file);
      if (!existsSync(p)) throw new Error(`File not found: ${p}`);
      const audio = /\.(mp3|wav|aac|m4a)$/i.test(p);
      const f = new FakeFootage(basename(p), 180, true, !audio);
      fake.project.comps.push(f);
      return f;
    },
    save(path?: string) {
      if (path) this.file = path;
      return true;
    },
    close(_opts: number) {
      return true;
    },
    renderQueue: {
      rendering: false,
      lastError: "",
      list: [] as FakeRQItem[],
      get numItems() {
        return this.list.length;
      },
      item(i: number) {
        return this.list[i - 1];
      },
      get items() {
        return {
          add: (comp: FakeComp) => {
            const it = new FakeRQItem(comp);
            fake.project.renderQueue.list.push(it);
            return it;
          },
        };
      },
      render() {
        for (const it of this.list) {
          if (!it.render) continue;
          const om = it.outputModule(1);
          writeFileSync(pathOf(om.file), `rendered ${it.comp.name} with ${om.template ?? "default"}`);
        }
      },
    },
  },
  beginUndoGroup(name: string) {
    undoLog.push(`begin:${name}`);
    return true;
  },
  endUndoGroup() {
    undoLog.push("end");
    return true;
  },
};

/** Install as the After Effects host Application object (UXP plugin tests). */
export function installFakeAe(): void {
  setHostApp(fake);
}
