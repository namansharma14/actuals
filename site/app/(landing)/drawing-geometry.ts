/**
 * Where every run stands, as pure arithmetic shared by the WebGL scene (client) and the SVG
 * drawing (server, phones, no script): the tree form puts a run at the radius of its
 * concurrency slot, at its parent's angle plus a fixed offset per child so siblings fan around
 * the parent and the trunk's children fan across the half that faces the reader; the flat form
 * puts the same slots in one plane. Units are the object's own: the trunk is H tall.
 */
import type { SceneRun } from "./drawing-data";

export const H = 4.4;
/** one lane's radius in the tree */
export const LR = 0.11;
/** one lane's width once flat */
export const SP = 0.16;
/** the broken end on a run that died, as a fraction of the trunk */
export const CAP = 0.12;
/** children of a bar fan this far apart; the trunk's children fan across this arc facing the reader */
export const FAN = 0.42;
export const ARC = 1.1 * Math.PI;
export const TRUNK_R = 0.044;

export interface Placed extends SceneRun {
  theta: number;
  rad: number;
  /** tree form: x and z at the run's slot and angle */
  tx: number;
  tz: number;
  /** flat form: the lane along z, left of the trunk once the object turns */
  fz: number;
  len: number;
}

export function radiusOf(r: Pick<SceneRun, "d">): number {
  return r.d === 1 ? 0.035 : r.d === 2 ? 0.028 : 0.022;
}

export function placeRuns(runs: readonly SceneRun[]): Placed[] {
  const byId = new Map<number, Placed>();
  const kids = new Map<number | "trunk", number[]>();
  for (const r of runs) {
    const k = r.p === null ? "trunk" : r.p;
    const list = kids.get(k) ?? [];
    list.push(r.id);
    kids.set(k, list);
  }
  const out: Placed[] = [];
  for (const r of [...runs].sort((p, q) => p.d - q.d || p.a - q.a)) {
    const parent = r.p !== null ? byId.get(r.p) : undefined;
    const sibs = kids.get(r.p === null ? "trunk" : r.p) ?? [r.id];
    const k = sibs.indexOf(r.id);
    const theta = parent ? parent.theta + (k - (sibs.length - 1) / 2) * FAN : (k - (sibs.length - 1) / 2) * (ARC / Math.max(1, sibs.length - 1));
    const rad = (r.l + 1) * LR;
    const placed: Placed = { ...r, theta, rad, tx: Math.cos(theta) * rad, tz: Math.sin(theta) * rad, fz: -(r.l + 1) * SP, len: (r.b - r.a) * H };
    byId.set(r.id, placed);
    out.push(placed);
  }
  return out.sort((p, q) => p.id - q.id);
}

export function alive(runs: readonly SceneRun[], t: number): number {
  return runs.reduce((n, r) => n + (r.a <= t && r.b > t ? 1 : 0), 0);
}

export function reachTree(runs: readonly Placed[], t: number): number {
  return runs.reduce((R, r) => (r.a <= t && r.b > t ? Math.max(R, r.rad) : R), 0);
}

export function addMin(hhmm: string, add: number): string {
  let h = Number(hhmm.slice(0, 2));
  let m = Number(hhmm.slice(3)) + add;
  h += Math.floor(m / 60);
  m %= 60;
  return `${h < 10 ? "0" : ""}${h}:${m < 10 ? "0" : ""}${m}`;
}
