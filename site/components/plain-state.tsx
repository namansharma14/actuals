import "./components.css";

/**
 * Every empty, error and unavailable state on the site. One line of display, one plain
 * sentence, and at most one thing to do. No raw page ever ships instead of this.
 */
export function PlainState({
  title,
  line,
  action,
}: {
  title: string;
  line: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="ac-block ac-plain">
      <h1 className="ac-display">
        <span className="ac-display-n">{title}</span>
      </h1>
      <p className="ac-lede">{line}</p>
      {action ? <div className="ac-plain-do">{action}</div> : null}
    </section>
  );
}
