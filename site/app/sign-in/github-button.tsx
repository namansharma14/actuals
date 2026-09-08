"use client";

import { useState } from "react";
import { useSignIn } from "@clerk/nextjs";

/**
 * One button. It sends the person to GitHub, GitHub sends them to `/sso-callback`, and the
 * callback sends them on to `back`. A new person gets an account on the way; an existing one
 * is signed in. Any error prints as one plain line under the button.
 */
export function GitHubButton({ back }: { back: string }) {
  const { signIn, fetchStatus } = useSignIn();
  const [error, setError] = useState<string | null>(null);
  const working = fetchStatus === "fetching";

  return (
    <div className="ac-focus-action">
      <button
        type="button"
        className="ac-btn"
        disabled={working}
        onClick={async () => {
          setError(null);
          const { error: err } = await signIn.sso({
            strategy: "oauth_github",
            redirectUrl: back,
            redirectCallbackUrl: "/sso-callback",
          });
          if (err) setError(err.message || "GitHub did not answer. Try again.");
        }}
      >
        {working ? "Opening GitHub…" : "Continue with GitHub"}
      </button>
      {error ? <p className="ac-err">{error}</p> : null}
    </div>
  );
}
