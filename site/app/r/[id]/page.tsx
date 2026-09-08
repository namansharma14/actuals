import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CommandPill } from "../../../components/command-pill";
import { PlainState } from "../../../components/plain-state";
import { ShareView } from "../../../components/share-view";
import { Shell } from "../../../components/shell";
import { readBlobText } from "../../../lib/blob";
import { COMMAND } from "../../../lib/constants";
import { dbConfigured } from "../../../lib/db";
import { runById } from "../../../lib/meter";
import { checkRedactedSocket } from "../../../lib/socket";
import { hostedEnabled } from "../../../lib/hosted";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "An Actuals run",
  description:
    "Aggregates only from one Claude Code repository: cost per commit, files still alive, the biggest agent tree.",
};

function Sorry({ title, line }: { title: string; line: string }) {
  return (
    <Shell>
      <div className="ac-page">
        <PlainState title={title} line={line} action={<CommandPill command={COMMAND} size="hero" />} />
      </div>
    </Shell>
  );
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  if (!hostedEnabled()) notFound();
  if (!dbConfigured()) {
    return <Sorry title="Hosted pages are not available here." line="This site cannot read hosted runs. The command still runs on your own machine." />;
  }

  const { id } = await params;
  const run = await runById(id);
  if (!run?.report_path) notFound();

  let stored: unknown;
  try {
    stored = JSON.parse(await readBlobText(run.report_path));
  } catch {
    return <Sorry title="The report could not be read." line="Nothing about this run is shown rather than part of it." />;
  }

  const checked = checkRedactedSocket(stored);
  if (!checked.ok) {
    return <Sorry title="The report could not be read." line="Nothing about this run is shown rather than part of it." />;
  }

  return (
    <Shell>
      <div className="ac-page ac-page-wide">
        <ShareView
          report={checked.report}
          reportSrc={`/r/${id}/report`}
          stickerSrc={run.sticker_path ? `/r/${id}/sticker.png` : null}
          lead="Someone hosted this run. Aggregates only: no prompt, no path, no file name, no commit message, no line of code. Every number says how it was made."
          closing="What left the machine for this page: this redacted report and one image."
        />
      </div>
    </Shell>
  );
}
