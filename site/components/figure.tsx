import { Mark, type MarkKind } from "./mark";
import "./components.css";

/**
 * One number at value, with its mark. `countTo` is the value a scroll-driven count runs up
 * to; the printed text is always the finished value, so the figure reads with no script.
 */
export function Figure({
  value,
  countTo,
  pre,
  post,
  dp,
  mark,
  label,
  sub,
  rail,
}: {
  value: string;
  countTo?: number;
  pre?: string;
  post?: string;
  dp?: number;
  mark?: MarkKind;
  label: string;
  sub?: string;
  rail?: boolean;
}) {
  return (
    <div className="ac-fig" data-rail={rail ? "1" : undefined}>
      <div
        className="ac-fig-n"
        data-count={countTo}
        data-pre={pre}
        data-post={post}
        data-dp={dp}
      >
        {value}
      </div>
      <div className="ac-fig-m">
        {mark ? <Mark kind={mark} /> : null}
        {sub ? <span className="ac-fig-s">{sub}</span> : null}
      </div>
      <div className="ac-fig-l">{label}</div>
    </div>
  );
}
