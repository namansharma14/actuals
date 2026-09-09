import Link from "next/link";
import type { Report } from "../lib/socket";
import { stickerData } from "../../src/render/sticker.js";
import "./components.css";

/**
 * The square a run becomes: the card the command already draws, aggregates only. A hosted
 * run has its own PNG and is shown as one; the sample run is drawn here from the report so
 * the page carries no capture and no stored image.
 */
export function Sticker({
  src,
  size = 300,
  href,
  alt,
  children,
}: {
  src?: string;
  size?: number;
  href?: string;
  alt?: string;
  children?: React.ReactNode;
}) {
  const inner = children ?? (src ? <img src={src} alt={alt ?? ""} loading="lazy" decoding="async" width={1080} height={1080} /> : null);
  /* The size is a custom property, not an inline width, so a narrow screen can still say
     otherwise in the sheet. */
  const style = { "--ac-sticker-w": `${size}px` } as React.CSSProperties;
  if (href) {
    return (
      <Link className="ac-sticker" style={style} href={href}>
        {inner}
      </Link>
    );
  }
  return (
    <div className="ac-sticker" style={style}>
      {inner}
    </div>
  );
}

/* ------------------------------------------------------------------ the drawing */

/**
 * The card is drawn by the product's own module (src/render/sticker.ts), the same string the
 * app rasterises and `actuals share` writes, so the site can never show a different card.
 */
export function StickerDrawing({ report }: { report: Report }) {
  const svg = stickerData(report).svg.replace("<svg ", '<svg class="ac-sticker-svg" ');
  return <div style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: svg }} />;
}
