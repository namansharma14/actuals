"use client";

import { SignOutButton } from "@clerk/nextjs";
import "./components.css";

/** The only thing under the handle. No dropdown, no menu, no avatar. */
export function SignOut() {
  return (
    <SignOutButton redirectUrl="/">
      <button type="button" className="ac-signout-btn">
        sign out
      </button>
    </SignOutButton>
  );
}
