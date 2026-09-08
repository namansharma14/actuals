/**
 * The site wears the report's own palette and the report's own embedded fonts, from the
 * same two files the CLI bundles. Dark on screen, light in print, and light for a viewer
 * whose system asks for light: that last one is the report's print palette, lifted out of
 * the print block so there is still only one set of colours in the repository.
 */
import { FONT_FACES } from "../../src/render/fonts.js";
import { TOKENS_CSS } from "../../src/render/tokens.js";
import { SITE_FONT_CSS } from "./site-fonts";

function lightFromPrint(): string {
  const m = /@media print\s*\{\s*(:root\s*\{[^}]*\})/.exec(TOKENS_CSS);
  return m && m[1] ? `@media (prefers-color-scheme: light) {\n${m[1]}\n}` : "";
}

export const HEAD_CSS: string = [FONT_FACES, TOKENS_CSS, lightFromPrint()].join("\n");
/** The same head for the site's own pages, with the fonts as files (lib/site-fonts.ts) instead of data URIs. */
export const SITE_HEAD_CSS: string = [SITE_FONT_CSS, TOKENS_CSS, lightFromPrint()].join("\n");
