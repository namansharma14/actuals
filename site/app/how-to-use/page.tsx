import type { Metadata } from "next";
import { CommandPill } from "../../components/command-pill";
import { Shell } from "../../components/shell";

export const dynamic = "force-static";

const LEDE =
  "Actuals reads the Claude Code sessions already on your machine and tells you what your agents actually shipped: what was kept, what died, what it cost. One command, about a second, nothing leaves the computer.";

export const metadata: Metadata = {
  title: "How to use Actuals",
  description: LEDE,
  alternates: { canonical: "/how-to-use" },
};

/** A word as it appears on the report's own controls. */
const Ui = ({ children, warm }: { children: React.ReactNode; warm?: boolean }) => (
  <span className={warm ? "ac-guide-ui ac-guide-warm" : "ac-guide-ui"}>{children}</span>
);

/**
 * The field guide, on the site: seven steps in the order a first run meets them, each with
 * the report as it looks at that step, then the one difference between a terminal and VS
 * Code, and the commands. The words are the guide's; the pictures are the report on a real
 * repository, redacted.
 */
export default function HowToUse() {
  return (
    <Shell>
      <div className="ac-page ac-guide">
        <header className="ac-block ac-guide-head">
          <h1 className="ac-display">
            <span className="ac-display-s">How to use</span>
          </h1>
          <p className="ac-lede">{LEDE}</p>
          <div className="ac-guide-cmds">
            <div className="ac-guide-cmd">
              <span className="ac-guide-lab">In any repository where you have used Claude Code</span>
              <CommandPill command="npx actuals" size="foot" />
            </div>
            <div className="ac-guide-cmd">
              <span className="ac-guide-lab">While you work (installs the status line and hooks)</span>
              <CommandPill command="npx actuals watch" size="foot" />
            </div>
          </div>
        </header>

        <ol className="ac-guide-steps">
          <li className="ac-guide-step" id="run">
            <header>
              <span className="ac-guide-n">01</span>
              <h2 className="ac-guide-h2">Run it and read the top line.</h2>
            </header>
            <p>
              The report opens in your browser on 127.0.0.1. The first row is the whole story for the period: what the tokens
              cost at list rates, how many commits the sessions made, the cost per commit, how many of the files the agents
              wrote are still alive, and how many agent runs finished with nothing to show.
            </p>
            <ul className="ac-guide-do">
              <li>
                Anything marked <Ui>MEASURED</Ui> was read from transcripts and git. <Ui>ESTIMATED</Ui> means priced at list
                rates.
              </li>
              <li>
                Change the dates with <Ui>FROM</Ui> and <Ui>TO</Ui>, then <Ui>RE-RUN ON THIS SCOPE</Ui>. It takes about a
                second.
              </li>
            </ul>
            <figure className="ac-guide-fig">
              <img
                src="/guide/report-top.webp"
                width={1440}
                height={900}
                alt="The top of the Actuals report: scope controls, then the five headline figures"
                decoding="async"
              />
              <figcaption>The headline row. The line under it tells you what to do next: click a session.</figcaption>
            </figure>
          </li>

          <li className="ac-guide-step" id="scope">
            <header>
              <span className="ac-guide-n">02</span>
              <h2 className="ac-guide-h2">Pick which sessions count.</h2>
            </header>
            <p>
              Two scopes sit at the top: this repository, or every project on the machine. The sessions control opens a
              list where you can untick any session, so one runaway night does not colour a whole month.
            </p>
            <ul className="ac-guide-do">
              <li>
                Click <Ui>Every project</Ui> to see a session that ran in another folder.
              </li>
              <li>
                Click <Ui>SESSIONS</Ui> to tick or untick individual sessions, then re-run.
              </li>
            </ul>
            <figure className="ac-guide-fig">
              <img
                src="/guide/picker.webp"
                width={1440}
                height={900}
                alt="The sessions picker open over the report, with a checkbox per session, its cost and its agent count"
                loading="lazy"
                decoding="async"
              />
              <figcaption>Each session shows its date, name, cost and how many agents it started.</figcaption>
            </figure>
          </li>

          <li className="ac-guide-step" id="drawer">
            <header>
              <span className="ac-guide-n">03</span>
              <h2 className="ac-guide-h2">Click a session to see what its agents did.</h2>
            </header>
            <p>
              The session opens in a drawer on the right: every agent run, drawn to time, with its model, its minutes, its
              cost, and what became of its work. Click any run to expand it: which files it wrote, and how many of those
              are tracked in git today.
            </p>
            <ul className="ac-guide-do">
              <li>
                <Ui>landed tracked</Ui> means the run&apos;s files are in git now. A <Ui warm>died</Ui> run stopped without
                returning.
              </li>
              <li>The small chart is that session&apos;s concurrency: how many agents were alive at once.</li>
            </ul>
            <figure className="ac-guide-fig">
              <img
                src="/guide/drawer.webp"
                width={1440}
                height={900}
                alt="The session drawer: a list of agent runs with model, minutes, cost and outcome; one run expanded to show the files it wrote"
                loading="lazy"
                decoding="async"
              />
              <figcaption>One run expanded. The files it wrote are listed with how many git still tracks.</figcaption>
            </figure>
          </li>

          <li className="ac-guide-step" id="label">
            <header>
              <span className="ac-guide-n">04</span>
              <h2 className="ac-guide-h2">Say whether it mattered.</h2>
            </header>
            <p>
              The tool measures what happened on disk and in git. Only you know whether the work mattered. At the top of
              the drawer, label the session in one click and add a line on why. Labels stay on this machine and are never
              overwritten.
            </p>
            <ul className="ac-guide-do">
              <li>
                Pick <Ui>KEPT</Ui>, <Ui>RETIRED</Ui>, <Ui>DEAD</Ui> or <Ui>OPEN</Ui>, type why, <Ui>SAVE LABEL</Ui>. The
                report re-runs.
              </li>
            </ul>
            <figure className="ac-guide-fig">
              <img
                src="/guide/drawer-label.webp"
                width={1440}
                height={900}
                alt="The label control at the top of the drawer, above the session's agent-runs chart"
                loading="lazy"
                decoding="async"
              />
              <figcaption>The label row sits above the chart of that session&apos;s agent runs.</figcaption>
            </figure>
          </li>

          <li className="ac-guide-step" id="live">
            <header>
              <span className="ac-guide-n">05</span>
              <h2 className="ac-guide-h2">Watch a session live.</h2>
            </header>
            <p>
              The <Ui>LIVE</Ui> tab draws the session running right now: agents appear as they start, go warm the moment
              one dies, and the cost ticks as tokens are spent. It works once <code>npx actuals watch</code> has installed
              the hooks.
            </p>
            <ul className="ac-guide-do">
              <li>Open the tab, then start Claude Code in the same repository. The tree draws itself.</li>
              <li>The line on the right says whether yesterday&apos;s kept work is still kept today.</li>
            </ul>
            <figure className="ac-guide-fig">
              <img
                src="/guide/live.webp"
                width={1440}
                height={900}
                alt="The Live tab before a session starts: waiting for a session, and yesterday's kept-work line"
                loading="lazy"
                decoding="async"
              />
              <figcaption>Before a session starts. Once one runs, the agents draw here in real time.</figcaption>
            </figure>
          </li>

          <li className="ac-guide-step" id="fix">
            <header>
              <span className="ac-guide-n">06</span>
              <h2 className="ac-guide-h2">Apply a fix, or undo it.</h2>
            </header>
            <p>
              The fixes are written from your own numbers. The first caps the agent tree at what your machine survived, as
              two settings in <code>.claude/settings.json</code>. Every fix shows its reason and the exact change before
              anything is written, and one command restores every file byte for byte.
            </p>
            <ul className="ac-guide-do">
              <li>
                <Ui>SHOW THE CHANGE</Ui>, then <Ui>APPLY TO THIS REPOSITORY</Ui>. Or from the terminal:{" "}
                <code>actuals fix</code> and <code>actuals undo &lt;fix-id&gt;</code>.
              </li>
            </ul>
            <figure className="ac-guide-fig">
              <img
                src="/guide/fixes.webp"
                width={1440}
                height={900}
                alt="The fixes section: F1 caps the agent tree with the diff shown, F2 is opt-in, F3 is not available yet"
                loading="lazy"
                decoding="async"
              />
              <figcaption>F1 applies by default. F2 is opt-in. Nothing is written without a confirm.</figcaption>
            </figure>
          </li>

          <li className="ac-guide-step" id="share">
            <header>
              <span className="ac-guide-n">07</span>
              <h2 className="ac-guide-h2">Share the sticker.</h2>
            </header>
            <p>
              Three numbers and the curve, as a 1080 by 1080 PNG, aggregates only: no file names, no prompts, no code.
              Copy it, save it, or post it.
            </p>
            <ul className="ac-guide-do">
              <li>
                <Ui>COPY STICKER</Ui> puts the PNG on your clipboard; <Ui>POST ON X</Ui> opens a post with the text card.
                Pick light or dark ink for the photo it will sit on.
              </li>
            </ul>
            <figure className="ac-guide-fig">
              <img
                src="/guide/share.webp"
                width={1440}
                height={900}
                alt="The sticker panel: the sticker preview with three figures and the curve, and the copy, save and post controls"
                loading="lazy"
                decoding="async"
              />
              <figcaption>The sticker and its controls. The foot of the report says what left the machine: nothing.</figcaption>
            </figure>
          </li>
        </ol>

        <section className="ac-block ac-guide-sec">
          <h2 className="ac-guide-h2">Terminal or VS Code</h2>
          <p>Same command, same report. The one difference is the live line.</p>
          <table className="ac-guide-table">
            <thead>
              <tr>
                <th>Where you work</th>
                <th>
                  What <code>npx actuals watch</code> does
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>A terminal</td>
                <td>
                  Puts one line in Claude Code&apos;s status bar: cost this session at list rates, context used, agents
                  alive against the cap, and any that died.
                </td>
              </tr>
              <tr>
                <td>VS Code</td>
                <td>
                  The extension has no status bar, so it opens the Live tab instead and prints the address; pin it with{" "}
                  <Ui>Simple Browser: Show</Ui>.
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="ac-block ac-guide-sec">
          <h2 className="ac-guide-h2">The commands</h2>
          <table className="ac-guide-table">
            <thead>
              <tr>
                <th>Command</th>
                <th>What it does</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>npx actuals</code>
                </td>
                <td>Reads this repository&apos;s sessions, writes the report, opens the app.</td>
              </tr>
              <tr>
                <td>
                  <code>npx actuals --all-projects</code>
                </td>
                <td>The same across every project on the machine.</td>
              </tr>
              <tr>
                <td>
                  <code>npx actuals watch</code>
                </td>
                <td>Installs the status line and the hooks that feed the Live tab.</td>
              </tr>
              <tr>
                <td>
                  <code>npx actuals fix</code>
                </td>
                <td>
                  Applies the default fix after one confirm; <code>undo &lt;fix-id&gt;</code> restores it.
                </td>
              </tr>
              <tr>
                <td>
                  <code>npx actuals share</code>
                </td>
                <td>Writes the sticker PNG and the post text locally.</td>
              </tr>
              <tr>
                <td>
                  <code>npx actuals doctor</code>
                </td>
                <td>Says what it can read on this machine and confirms that nothing touches the network.</td>
              </tr>
            </tbody>
          </table>
          <p className="ac-guide-note">
            Nothing leaves your machine. The report, the labels and the fixes are files in your repository and your home
            folder.
          </p>
        </section>
      </div>
    </Shell>
  );
}
