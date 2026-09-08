import { CommandPill } from "../components/command-pill";
import { PlainState } from "../components/plain-state";
import { Shell } from "../components/shell";
import { COMMAND } from "../lib/constants";

/** Every page that does not exist is still this site, with one line and one thing to do. */
export default function NotFound() {
  return (
    <Shell>
      <div className="ac-page">
        <PlainState
          title="There is nothing at this address."
          line="The report is one word away."
          action={<CommandPill command={COMMAND} size="hero" />}
        />
      </div>
    </Shell>
  );
}
