/**
 * What the app and the embed hand the page beyond the report itself: the shapes the local
 * server fills in, and the two inline payloads. The static export carries neither.
 */
import type { Report } from "../schema/socket.js";
import { renderShareText } from "./share.js";
import { MONO_FACE } from "./fonts.js";
import { stickerData } from "./sticker.js";

export interface CatalogRow { id: string; date: string; title: string; cost_usd: number; agents: number; peak_concurrency: number }
export interface ProjectOption { slug: string; label: string; sessions: number; last: string | null }

export interface AppRender {
  /** per-launch token, required on every POST; embedded here and nowhere else */
  token: string;
  /** the loopback port the page came from */
  port: number;
  /** every session in the latest full run */
  catalog: CatalogRow[];
  /** every Claude Code project on this machine; slugs only, resolved server-side */
  projects: ProjectOption[];
  /** the project the current report was made for: a slug, "" for this folder, "*" for every project */
  project: string;
  /** the "this repo" segment: the launch folder's slug and its session count */
  repoTab: { slug: string; sessions: number };
  /** the scope the current report was made with */
  scope: { since: string | null; until: string | null; sessionIds: string[] | null };
  /** fix ids with an undo store on disk */
  applied: string[];
  /** where the static file of the current run lives */
  staticPath: string;
  /** yesterday's kept work re-tested today (git and disk), or null when there is no yesterday */
  dailyKept?: { n: number; m: number } | null;
}

export interface EmbedRender {
  /** sessionId -> the pre-rendered session view, inlined so the embed needs no server */
  drawers: Record<string, string>;
}

export function embedData(embed: EmbedRender): string {
  return JSON.stringify({ drawers: embed.drawers }).replace(/</g, "\\u003c");
}

export function appData(app: AppRender, r: Report): string {
  const data = { token: app.token, port: app.port, scope: app.scope, sticker: stickerData(r, { fontFaces: MONO_FACE }) };
  // "<" never appears raw inside the script; the JSON stays inert if a title carries markup
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/** The X post intent: the text card only; the PNG is attached by the user from the clipboard. */
export function xIntentUrl(r: Report): string {
  return "https://x.com/intent/post?text=" + encodeURIComponent(renderShareText(r));
}
