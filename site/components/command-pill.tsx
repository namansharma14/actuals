"use client";

import { useState } from "react";
import "./components.css";

declare global {
  interface Window {
    va?: (event: "event", data: { name: string }) => void;
  }
}

/**
 * `npx actuals` and nothing else. The most prominent interactive thing on the landing, and
 * the only copy control it has.
 */
export function CommandPill({
  command,
  size = "hero",
  label,
}: {
  command: string;
  size?: "hero" | "foot" | "inline";
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="ac-pill-wrap">
      <div className="ac-pill" data-size={size}>
        <code>
          <span className="ac-pill-p">$</span>
          {command}
        </code>
        <button
          type="button"
          aria-label={`copy ${command}`}
          onClick={() => {
            void navigator.clipboard.writeText(command).then(
              () => {
                setCopied(true);
                /* the one thing we count: the command was copied */
                window.va?.("event", { name: "copy" });
                setTimeout(() => setCopied(false), 1800);
              },
              () => undefined,
            );
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      {label ? <span className="ac-pill-label">{label}</span> : null}
    </div>
  );
}
