/**
 * The landing's shared pieces: the window (a real page in a titled frame), the receipt's body and
 * the close, where the receipt appears once, complete, with the pill under it.
 */
import Link from "next/link";
import { CommandPill } from "../../components";
import { L, RECEIPT } from "./data";

export function Window({
  src,
  host,
  note,
  cover,
  deferred,
}: {
  src: string;
  host: string;
  note: string;
  cover: "link" | "open" | "none";
  /** load the embed only once its section is on screen (an embed that scrolls itself into view on load would scroll the page to it) */
  deferred?: boolean;
}) {
  return (
    <div className="lp-win">
      <div className="lp-win-bar">
        <span className="lp-win-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="lp-win-host">{host}</span>
        <span className="lp-win-note">{note}</span>
      </div>
      <div className="lp-win-body">
        {deferred ? (
          <iframe data-src={src} title={`${host}: ${note}`} loading="lazy" />
        ) : (
          <iframe src={src} title={`${host}: ${note}`} loading="lazy" />
        )}
        {cover === "none" ? null : cover === "link" ? (
          <Link className="lp-win-cover" href="/demo" aria-label="open the sample report">
            <span>open the report</span>
          </Link>
        ) : (
          <button type="button" className="lp-win-cover" data-cover="open">
            <span>click to explore</span>
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------- hero, run, the month, what was kept */


function ReceiptBody({ lines }: { lines: typeof RECEIPT }) {
  return (
    <>
      <div className="lp-rc-head">
        <span className="lp-rc-brand">ACTUALS</span>
        <span className="lp-rc-sub">
          <span>one real run, redacted</span> · <span>{L.periodShort}</span>
        </span>
      </div>
      <div className="lp-rc-rule" />
      {lines.map((l, i) => (
        <div key={i} className={`lp-rc-line${l.warn ? " lp-rc-warn" : ""}${l.v === "" ? " lp-rc-sentence" : ""}`} data-at={l.at}>
          <span>{l.k}</span>
          {l.v === "" ? null : (
            <span>
              {l.warn ? <i className="lp-rc-mark" aria-hidden="true" /> : null}
              {l.v}
            </span>
          )}
        </div>
      ))}
    </>
  );
}


/** The close: the receipt settled in the centre, complete; the pill alone under it; the footer unpinned. */
export function Close({ children }: { children?: React.ReactNode }) {
  return (
    <section className="lp-close" id="run">
      <div className="lp-close-centre">
        <div className="lp-rc lp-rc-final">
          <ReceiptBody lines={RECEIPT} />
        </div>
        <div className="lp-pill">
          <CommandPill command={L.command} size="hero" />
        </div>
      </div>
      {children}
      <footer className="lp-foot">
        <span className="lp-foot-word">ACTUALS</span>
        <span>
          The report on this page is one real repository, redacted, measured on {L.measuredOn}. The words are about
          yours. Free and source available. Claude Code today, Codex next.
        </span>
        <nav aria-label="site">
          <Link href="/how-to-use">how to use</Link>
        </nav>
      </footer>
    </section>
  );
}
