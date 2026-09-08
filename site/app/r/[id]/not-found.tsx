import { CommandPill } from "../../../components/command-pill";
import { PlainState } from "../../../components/plain-state";
import { Shell } from "../../../components/shell";
import { COMMAND } from "../../../lib/constants";

/** An id nobody hosted. The shell stands, and the page still offers the one thing it can. */
export default function NoSuchRun() {
  return (
    <Shell>
      <div className="ac-page">
        <PlainState
          title="There is no hosted run with that id."
          line="The link may have been mistyped, or the run was never published."
          action={<CommandPill command={COMMAND} size="hero" label="Your own numbers take about a second." />}
        />
      </div>
    </Shell>
  );
}
