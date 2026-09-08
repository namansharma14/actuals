/**
 * The landing's beats as server-rendered sections, in the vision's order: the arrival and the
 * command on one pinned track, the night, the turn, the bright chapter. Every word is
 * LANDING-COPY rev 2; every number is the fixture's. The scene (scene.tsx) draws over these
 * and reads them by data attribute; without it the page is complete: the copy in flow, the
 * report in its window, the terminal's output printed, the figures at value.
 */
import { Fragment, type CSSProperties } from "react";
import { COMMAND } from "../../lib/constants";
import { CommandPill } from "../../components/command-pill";
import { L, STDOUT } from "./data";
import type { SceneData } from "./drawing-data";
import { Window } from "./sections";
import { FlatDrawing } from "./drawing";
import { StickerDrawing } from "../../components/sticker";
import { demoReport } from "../../lib/report";
import { renderShareText } from "../../../src/render/share.js";

const REPORT = "/demo/report";

const money = (n: number): string => `$${Math.round(n).toLocaleString("en-US")}`;
/* the figures at their final widths from the first frame: the count never moves a caption */
const width = (ch: number): CSSProperties => ({ "--w": ch }) as CSSProperties;

export function Open() {
  return (
    <section className="sc-open" data-beat="open">
      <div className="sc-open-stage">
        <div className="sc-hero-copy" data-hero-copy>
          <h1 className="sc-h sc-h1">
            <span>See what your agents</span>
            <span>
              <em>actually</em> shipped.
            </span>
          </h1>
          <p className="sc-lede">
            Your coding agent says done. Actuals reads your Claude Code sessions and your git history, right on your
            machine, and shows what the agents actually left behind: what was kept, what got thrown away, what quietly
            died, and what it cost. The report is a file you own, and nothing leaves your computer.
          </p>
          <div data-pill>
            <CommandPill command={COMMAND} />
          </div>
          <p className="sc-fine">Runs on your machine. No account, no upload. Free.</p>
          <p className="sc-fine">One real repository, redacted, measured today.</p>
        </div>
        <div className="sc-win" data-window data-embed-at="instrument">
          <Window src={REPORT} host="127.0.0.1" note="opened on this machine" cover="open" />
        </div>
        <a className="sc-still" href="/demo">
          <span className="sc-still-win">
            <span className="sc-still-bar">
              <i />
              <i />
              <i />
              <span>127.0.0.1</span>
            </span>
            <span className="sc-still-body">
              <img src="/tallest-tree.png" width={328} height={760} alt="the report's tallest-tree section: 31 Aug, 13:16 to 15:13 UTC, thirty-one runs, twenty at once, three dead, drawn to time" />
            </span>
          </span>
          <span className="sc-still-link">
            <span>open the report</span>
          </span>
        </a>
        <div className="sc-cmd-copy" data-cmd-copy>
          <h2 className="sc-h sc-h2">
            <span>One command.</span>
          </h2>
          <p className="sc-lede">
            It reads the sessions already on your disk and opens a report on <code>127.0.0.1</code>. No sign up, no key,
            no upload. Node 20 or newer.
          </p>
        </div>
        <div className="sc-term" data-term>
          <span className="sc-term-p">$</span> <span data-typed>{"npx actuals"}</span>
          <span className="sc-caret" data-caret />
          {STDOUT.map((line, i) => (
            <span key={i} className="sc-term-o" data-k={i}>
              {"\n"}
              {line}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Bright({ data, sessionId }: { data: SceneData; sessionId: string }) {
  const h = data.head;
  return (
    <section className="sc-bright" data-beat="bright">
      <div className="sc-bright-stage" />
      <div className="sc-paper" data-paper>
        <div className="sc-paper-copy" data-paper-copy>
          <h2 className="sc-h sc-h2">
            <span>The whole run</span>
            <span>on one screen.</span>
          </h2>
          <p className="sc-lede">
            You kicked off the work. Here is what came of it. Every session your agents ran, every subagent they
            spawned, and what each one cost, counted once per request so the number is real. Not a guess, not the bill
            weeks later. The cost of the work, the day you did it.
          </p>
          <p className="sc-fine">
            One real repository, redacted. Files still on disk are counted today; costs are estimated at list rates.
            A run counts as kept only when the files it wrote are still on disk and tracked in git.
          </p>
        </div>
      </div>
      <div className="sc-frame" data-frame>
        <div className="sc-frame-bar">
          <i />
          <i />
          <i />
          <span>127.0.0.1</span>
          <span>opened on this machine</span>
        </div>
        <div className="sc-frame-body">
          <div className="sc-frame-doc" data-frame-doc>
            <div className="sc-grid sc-figs">
              <div className="sc-fig sc-fig-wide">
                <b data-fig="cost" style={width(6)}>
                  {money(h.cost)}
                </b>
                <span>of tokens across {h.sessions} sessions, estimated at list rates</span>
              </div>
              <div className="sc-fig">
                <b data-fig="commits" style={width(3)}>
                  {h.commits}
                </b>
                <span>commits made inside those sessions, measured from git</span>
              </div>
              <div className="sc-fig">
                <b data-fig="per" style={width(6)}>
                  ${h.per.toFixed(2)}
                </b>
                <span>of tokens for each of them, estimated</span>
              </div>
            </div>
            <div className="sc-chart-slot" data-chart-slot>
              {/* the report's own chart, at full scale on the content grid; the phone gets its own width */}
              <div className="sc-flat-desk">
                <FlatDrawing data={data} />
              </div>
              <div className="sc-flat-phone">
                <FlatDrawing data={data} w={340} />
              </div>
            </div>
            <div className="sc-grid sc-kept">
              <p className="sc-kept-head">The six costliest sessions, costs estimated at list rates</p>
              {data.kept.map((row, i) => {
                const gone = row.written - row.alive;
                const untracked = row.alive - row.tracked;
                const [day, mon] = row.day.split(" ");
                return (
                  <div key={row.day + i} className="sc-row" data-row={i}>
                    <span className="sc-day">
                      <b>{day}</b> {mon}
                    </span>
                    {/* the three states a written file can be in, so the sum closes on what was written */}
                    <span>
                      <span className="sc-state">{row.tracked} kept,</span> <span className="sc-state">{untracked} untracked,</span>{" "}
                      <span className="sc-state">{gone} gone</span>
                    </span>
                    <span className="sc-written">of {row.written} written</span>
                    {row.per === null ? (
                      <span className="sc-amt sc-amt-none">
                        <b>${row.cost.toFixed(2)}</b> <i>no commit</i>
                      </span>
                    ) : (
                      <span className="sc-amt">
                        <b>${row.per.toFixed(2)}</b> <i>per commit</i>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="sc-frame-foot">
              {h.alive} of {h.written} files the agents wrote are still on disk, measured today.
            </p>
          </div>
        </div>
        <div className="sc-frame-embed" data-frame-embed>
          <iframe data-src={`${REPORT}?session=${sessionId}`} title="127.0.0.1: the report with the 31 August session open" loading="lazy" />
        </div>
        <div className="sc-frame-status" data-frame-status>
          <span data-status-typed>{L.status}</span>
          <span className="sc-caret" data-status-caret />
          <span className="sc-frame-status-note">an example session</span>
        </div>
        <button type="button" className="sc-frame-card" data-frame-card aria-pressed="false" aria-label="the card this run becomes; press to read the post">
          <span className="sc-card-face sc-card-front">
            <StickerDrawing report={demoReport} />
          </span>
          <span className="sc-card-face sc-card-back">
            {/* the command's own share text for the fixture, the bytes actuals share writes, verbatim */}
            <span className="sc-card-post" data-card-post>
              {renderShareText(demoReport)}
            </span>
            <span className="sc-card-post-note">the post the command writes</span>
          </span>
        </button>
      </div>
    </section>
  );
}

export function Card() {
  return (
    <section className="sc-card" data-beat="card">
      <div className="sc-card-stage">
        <div className="sc-card-copy" data-card-copy>
          <p className="sc-card-line">One card, for the post.</p>
          <p className="sc-card-note">the post the command writes</p>
        </div>
        {/* without the scene, the card itself, in flow */}
        <div className="sc-card-static">
          <StickerDrawing report={demoReport} />
        </div>
      </div>
    </section>
  );
}

export function Status() {
  return (
    <section className="sc-status" data-beat="status">
      <div className="sc-status-stage">
        <div className="sc-status-copy" data-status-copy>
          <h2 className="sc-h sc-h2">
            <span>While you work.</span>
          </h2>
          <p className="sc-lede">
            Run actuals watch once and one line sits in your Claude Code status bar: what this session has cost so far
            at list rates, how much of the context is used, how many agents are open, and whether any died. It installs
            with the change shown first and comes out byte for byte.
          </p>
          <p className="sc-fine" data-status-fine>An example line, in the exact format the command prints.</p>
        </div>
        {/* without the scene, the line itself, at value, in flow */}
        <p className="sc-status-static">
          {/* the line breaks only before a separator, never after one: the space sits between the parts */}
          <span>
            {L.status.split(" · ").map((part, i) => (
              <Fragment key={i}>
                {i > 0 ? " " : ""}
                <span className="sc-status-part">
                  {i > 0 ? "· " : ""}
                  {part}
                </span>
              </Fragment>
            ))}
          </span>
          <span className="sc-frame-status-note">an example session</span>
        </p>
      </div>
    </section>
  );
}

export function Drawer() {
  return (
    <section className="sc-drawer" data-beat="drawer">
      <div className="sc-drawer-stage">
        <div className="sc-drawer-copy" data-drawer-copy>
          <h2 className="sc-h sc-h2">
            <span>See every agent, click into any of it.</span>
          </h2>
          <p className="sc-lede">
            The report is not a screenshot. It opens. Click a session for its files, its commits, and its agent tree drawn
            to time. Click a single agent run and it opens: which model, who started it, why it landed or died, and what
            it wrote. Try it on this page.
          </p>
          <h3 className="sc-h sc-h3">
            <span>Say what mattered.</span>
          </h3>
          <p className="sc-sub">The one column only you can fill.</p>
          <p className="sc-lede">
            The report measures what survived. It cannot know what you meant to keep. Mark a session kept, retired, dead,
            or open, in one line, and the numbers become yours. Your labels stay on your machine.
          </p>
        </div>
        {/* without the scene, the drawer's final frame: the real report with the session open, static */}
        <div className="sc-drawer-static" data-drawer-static>
          <Window src={`${REPORT}?session=${L.tree.id}`} host="127.0.0.1" note="opened on this machine" cover="none" deferred />
        </div>
      </div>
    </section>
  );
}
