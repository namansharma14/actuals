/**
 * Clerk runs on the two surfaces that need a signed-in person. The upload endpoint carries
 * a licence key, the Stripe webhook carries a Stripe signature, and the landing, the demo
 * and every share page are public, so none of them is matched here.
 */
import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { clerkConfigured, clerkPublishableKey } from "./lib/config";

export default clerkConfigured() ? clerkMiddleware({ publishableKey: clerkPublishableKey() }) : () => NextResponse.next();

export const config = {
  matcher: ["/account/:path*", "/sign-in/:path*", "/pair/:path*", "/sso-callback", "/api/checkout"],
};
