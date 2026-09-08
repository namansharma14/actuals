import { CommandPill } from "./command-pill";
import { Mark } from "./mark";
import { Sticker } from "./sticker";
import { dayOf } from "../lib/dates";
import type { HistoryRow } from "../lib/db";
import "./components.css";

const money = (v: string | number | null): string => {
  if (v === null || v === undefined) return "n/a";
  const n = Number(v);
  if (!Number.isFinite(n)) return "n/a";
  return n >= 100 ? `$${Math.round(n).toLocaleString("en-US")}` : `$${n.toFixed(2)}`;
};

/**
 * Every run this account chose to host, newest first, as the squares they became. The old
 * run table and the old gallery are one thing now: a square, its day, and what a commit
 * cost that run.
 */
export function StickerGallery({ runs, emptyCommand }: { runs: HistoryRow[]; emptyCommand: string }) {
  if (runs.length === 0) {
    return (
      <div className="ac-empty">
        <div className="ac-empty-square">
          <CommandPill command={emptyCommand} size="foot" />
        </div>
        <p className="ac-lede">
          No hosted runs yet. Run <code>actuals share --hosted</code> and the report becomes a page you can send. It
          lists exactly what would leave your machine first, and waits for you to say yes. Five are free.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="ac-gallery">
        {runs.map((r) => (
          <figure key={r.id}>
            <Sticker
              href={`/r/${r.id}`}
              size={240}
              src={r.sticker_path ? `/r/${r.id}/sticker.png` : undefined}
              alt={`the card for the run of ${dayOf(r.generated_at ?? r.created_at)}`}
            >
              {r.sticker_path ? undefined : <span className="ac-sticker-none">no card for this run</span>}
            </Sticker>
            <figcaption>
              <span className="ac-gallery-day">{dayOf(r.generated_at ?? r.created_at)}</span>
              <span className="ac-gallery-fig">
                {money(r.cost_per_commit)} a commit <Mark kind="estimated" />
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="ac-note">Every page carries its own link to copy and its own card to save.</p>
    </>
  );
}
