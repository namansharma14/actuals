import type { Metadata } from "next";
import { ShareView, longDay } from "../../components/share-view";
import { Shell } from "../../components/shell";
import { StickerDrawing } from "../../components/sticker";
import { demoReport } from "../../lib/report";

export const dynamic = "force-static";

const money = (n: number | null): string =>
  n === null ? "n/a" : n >= 100 ? `$${Math.round(n).toLocaleString("en-US")}` : `$${n.toFixed(2)}`;

/* The description is the run's own numbers, never typed in. It is checked against the words
   the page is meant to say, so a regenerated fixture stops the build instead of quietly
   shipping a description that no longer matches the report underneath it. */
const DESCRIPTION = `${demoReport.sessions.length} sessions and ${demoReport.headline.commits.value} commits measured, ${money(
  demoReport.headline.cost_per_commit.value,
)} a commit estimated at list rates. The report one command writes, from a real repository, redacted.`;


export const metadata: Metadata = {
  title: "A real Actuals report",
  description: DESCRIPTION,
};

export default function DemoPage() {
  return (
    <Shell>
      <div className="ac-page ac-page-wide">
        <ShareView
          report={demoReport}
          reportSrc="/demo/report"
          stickerDrawing={<StickerDrawing report={demoReport} />}
          headNote={`The sample run: one repository, redacted, measured ${longDay(demoReport.generated_at)}.`}
          lead="Aggregates only: no prompt, no path, no file name, no commit message, no line of code. Every number says how it was made."
          marksLine="Measured is read from your transcripts and your git history today. Estimated is token counts priced at list rates. On a plan you pay a flat fee, so the dollars show the size of the work, not the bill."
          closing="Nothing left a machine for this page: the report is the file the command wrote, redacted."
        />
      </div>
    </Shell>
  );
}
