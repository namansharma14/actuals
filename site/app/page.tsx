import type { Metadata } from "next";
import Link from "next/link";
import { L } from "./(landing)/data";
import { sceneData } from "./(landing)/drawing-data";
import { Motion } from "./(landing)/motion";
import { SceneLoader } from "./(landing)/scene-loader";
import { Bright, Card, Drawer, Open, Status } from "./(landing)/beats";
import { Close } from "./(landing)/sections";
import "./(landing)/landing.css";
import "./(landing)/scene.css";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Actuals: see what your agents actually shipped",
  description: `One command reads your Claude Code sessions and git history on your own machine and shows what the agents actually left behind. ${L.agentRuns} agent runs, ${L.commits.text} commits, ${L.perCommit.text} of tokens each, from one real repository. Nothing is uploaded.`,
};

/**
 * The landing, in the vision's order after the founder's realignment (reports/2026-09-06-vision.md,
 * section 0): the arrival with the real report in its window and the command on one pinned track,
 * the bright chapter riding in on its paper with the report's frame carrying the hero window's chart, the drawer
 * sliding the live report into the frame, the frame shrinking to the status strip, the card, and
 * the close where the receipt appears once, complete, with the pill under it. The page is complete
 * without script; the scene drives the pinned beats, and phones, reduced motion and no script get
 * the static stack.
 */
export default function Landing() {
  const data = sceneData();
  return (
    <div className="lp">
      <a className="lp-skip" href="#main">
        Skip to the content
      </a>
      <header className="lp-nav" data-nav>
        <Link className="lp-nav-word" href="/">
          ACTUALS
        </Link>
        <nav aria-label="site">
          <Link href="/how-to-use">how to use</Link>
        </nav>
      </header>

      <main id="main" className="lp-main">
        <Open />
        <Bright data={data} sessionId={L.tree.id} />
        <Drawer />
        <Status />
        <Card />
        <Close />
      </main>

      <SceneLoader data={data} />
      <Motion />
    </div>
  );
}
