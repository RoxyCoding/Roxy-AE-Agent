import type { Handler } from "./context.js";
import { projectHandlers } from "./project.js";
import { compHandlers } from "./comp.js";
import { layerHandlers } from "./layer.js";
import { propertyHandlers } from "./property.js";
import { effectHandlers } from "./effect.js";
import { miscHandlers } from "./misc.js";
import { structureHandlers } from "./structure.js";

export const HANDLERS: Record<string, Handler> = {
  ...projectHandlers,
  ...compHandlers,
  ...layerHandlers,
  ...propertyHandlers,
  ...effectHandlers,
  ...miscHandlers,
  ...structureHandlers,
};

export type { Handler, HandlerContext } from "./context.js";
