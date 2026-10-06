import type { RoxyMetadata } from "./metadata.js";

/**
 * Lightweight project snapshot produced by `project.collectDiagnostics` in the plugin
 * and consumed by @roxy/project-validator on the server. Keep it flat and small.
 */
export interface DiagnosticsSnapshot {
  project: { name: string; path: string | null };
  comps: DiagComp[];
  footage: DiagFootage[];
  /** Comps whose layer list was truncated by maxLayersPerComp. */
  truncatedComps: number[];
}

export interface DiagComp {
  id: number;
  name: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  roxy: RoxyMetadata | null;
  layers: DiagLayer[];
}

export interface DiagLayer {
  id: number;
  index: number;
  name: string;
  type: string;
  enabled: boolean;
  threeD: boolean;
  inPoint: number;
  outPoint: number;
  parentId: number | null;
  /** Position at comp time 0 (2D/3D), null if unreadable. */
  position: number[] | null;
  /** Layer bounds in layer space at time 0 (text/shape only), null otherwise. */
  sourceRect: { left: number; top: number; width: number; height: number } | null;
  roxy: RoxyMetadata | null;
  /** Expressions that currently report an error (only transform + effect properties are scanned). */
  expressionErrors: Array<{ path: string; error: string }>;
  effects: Array<{ name: string; matchName: string }>;
}

export interface DiagFootage {
  id: number;
  name: string;
  missing: boolean;
}
