/**
 * Design tokens for the report (instrument direction, 2026-09-03).
 * Dark on screen; a light variant under @media print so the same layout prints. No remote
 * fonts, no remote anything: the fonts are embedded (fonts.ts).
 */
export const TOKENS_CSS: string = `
:root {
  --bg: #0A0C0F; --panel: #0E1115; --rule: #262C34; --grid: #1A1F26;
  --ink: #E8E4DA; --text: #D9D6CF; --muted: #9DA3AB; --faint: #7E848D;
  --mark: #98B2C4; --warn: #FF6A3D;
  --d1: #E8E4DA; --d2: #A9A59B; --d3: #6F6C64; --dim: #4B5058; --dimmer: #2A2F37;
  --mono: "Martian Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --sans: "Instrument Sans", system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px; --s7: 44px; --s8: 64px;
  color-scheme: dark;
}
@media print {
  :root {
    --bg: #FFFFFF; --panel: #F5F4F1; --rule: #C9C6BF; --grid: #E6E4DF;
    --ink: #121212; --text: #1F1F1F; --muted: #4F5257; --faint: #6C727B;
    --mark: #27506C; --warn: #C8471F;
    --d1: #1F1F1F; --d2: #6F6C64; --d3: #A9A59B; --dim: #B5B2AA; --dimmer: #D6D3CC;
    color-scheme: light;
  }
  html, body { background: #FFFFFF !important; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { padding: 24px 0 !important; }
  .break { break-before: page; }
  .avoid { break-inside: avoid; }
  .noprint { display: none !important; }
}
`;
