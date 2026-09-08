import "./components.css";

/**
 * The product is always shown inside something that admits it is a frame: hairline border, a
 * bar with three dots, the host it runs on, and one line saying what it is. The report's own
 * idiom lives in here and never reaches the chrome.
 */
export function Frame({
  host,
  note,
  kind = "still",
  src,
  alt,
  className,
  children,
}: {
  host: string;
  note?: string;
  kind?: "still" | "document";
  src?: string;
  alt?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={className ? `ac-frame ${className}` : "ac-frame"}>
      <div className="ac-frame-bar">
        <span className="ac-frame-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="ac-frame-host">{host}</span>
        {note ? <span className="ac-frame-note">{note}</span> : null}
      </div>
      <div className="ac-frame-body">
        {kind === "document" && src ? (
          <iframe src={src} title={alt ?? host} loading="lazy" />
        ) : src ? (
          <img src={src} alt={alt ?? ""} loading="lazy" decoding="async" />
        ) : null}
        {children}
      </div>
    </div>
  );
}
