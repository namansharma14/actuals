import { COMMAND } from "../lib/constants";
import type { Report } from "../lib/socket";
import { CommandPill } from "./command-pill";
import { Figure } from "./figure";
import type { MarkKind } from "./mark";
import { Frame } from "./frame";
import { Sticker } from "./sticker";
import "./components.css";

const money = (n: number | null): string =>
  n === null ? "n/a" : n >= 100 ? `$${Math.round(n).toLocaleString("en-US")}` : `$${n.toFixed(2)}`;

/** The report's own label for a number, as the chrome sets it. Anything rarer reads as an example. */
const markOf = (m: string): MarkKind => (m === "measured" ? "measured" : m === "estimated" ? "estimated" : "example");

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "5 September 2026", the way the rest of the site writes a day. */
export function longDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * One hosted run, and the sample run, are the same page: the site's own head, the report
 * itself in a frame it is never re-styled inside, one ask, and one line on what left the
 * machine. The frame loads the report from its own route so the document is served exactly
 * as the command writes it.
 */
export function ShareView({
  report,
  reportSrc,
  stickerSrc,
  stickerDrawing,
  headNote,
  lead,
  marksLine,
  closing,
}: {
  report: Report;
  reportSrc: string;
  stickerSrc?: string | null;
  stickerDrawing?: React.ReactNode;
  /** One line in the head that says what this run is. The sample page names itself here. */
  headNote?: string;
  /** The line above the frame: who this ran for, and what is on the page. */
  lead: string;
  /** The sample run explains the two marks here; a hosted run does not. */
  marksLine?: string;
  closing: string;
}) {
  const h = report.headline;
  const alivePct = h.files_alive.written > 0 ? Math.round((h.files_alive.alive / h.files_alive.written) * 100) : 0;
  const since = report.window.since ? longDay(report.window.since) : "";
  const until = report.window.until ? longDay(report.window.until) : "";

  return (
    <>
      <section className="ac-block ac-share-head">
        <div className="ac-share-when">
          <span>{longDay(report.generated_at)}</span>
          {since && until ? <span>{since} to {until}</span> : null}
        </div>
        <div className="ac-share-body">
          <div className="ac-share-figs">
            <Figure
              value={money(h.cost_usd.value)}
              mark={markOf(h.cost_usd.mark)}
              label="of tokens, at list rates"
            />
            <Figure
              value={h.commits.value.toLocaleString("en-US")}
              mark={markOf(h.commits.mark)}
              label="commits made inside those sessions"
            />
            <Figure
              value={money(h.cost_per_commit.value)}
              mark={markOf(h.cost_per_commit.mark)}
              label="for every one of them"
            />
            <Figure
              value={`${alivePct}%`}
              mark={markOf(h.files_alive.mark)}
              label={`of the files the agents wrote are still on disk, ${h.files_alive.alive} of ${h.files_alive.written}`}
            />
          </div>
          <div className="ac-share-card">
            {stickerDrawing ? (
              <Sticker size={320}>{stickerDrawing}</Sticker>
            ) : stickerSrc ? (
              <Sticker size={320} src={stickerSrc} alt="the card for this run: agent runs, commits, cost per commit" />
            ) : null}
          </div>
        </div>
        {headNote ? <p className="ac-note ac-note-wide">{headNote}</p> : null}
      </section>

      <section className="ac-block ac-report-block">
        <p className="ac-lede">{lead}</p>
        {marksLine ? <p className="ac-note ac-note-wide">{marksLine}</p> : null}
        <Frame host="the report" note="redacted" kind="document" src={reportSrc} className="ac-report-frame" alt="the report for this run">
          <p className="ac-frame-open">
            <a href={reportSrc}>Open the full report</a>
          </p>
        </Frame>
      </section>

      <section className="ac-block ac-ask">
        <CommandPill command={COMMAND} size="hero" label="Your own numbers take about a second." />
      </section>

      <p className="ac-closing">{closing}</p>
    </>
  );
}
