/**
 * The report's own two faces, served as files instead of the data URIs the report embeds (the report
 * stays self-contained; the site's HTML stays small and the browser fetches the fonts in parallel).
 * Generated from src/render/fonts.ts; regenerate when the fonts change.
 */
export const SITE_FONT_CSS: string = "@font-face{font-family:'Martian Mono';font-style:normal;font-weight:100 800;font-display:swap;src:url(/fonts/martian-mono-normal.woff2) format('woff2')}\n@font-face{font-family:'Instrument Sans';font-style:normal;font-weight:400 700;font-display:swap;src:url(/fonts/instrument-sans-normal.woff2) format('woff2')}\n";
export const SITE_FONT_PRELOAD: string[] = ["/fonts/martian-mono-normal.woff2","/fonts/instrument-sans-normal.woff2"];
