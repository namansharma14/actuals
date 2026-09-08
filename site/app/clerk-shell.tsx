import { ClerkProvider } from "@clerk/nextjs";
import { clerkConfigured, clerkPublishableKey } from "../lib/config";

/**
 * Sign-in only wraps the pages that need a person, so the public pages stay static and
 * keyless. The provider carries the site's own palette and its square corners, so the one
 * borrowed surface on the site does not arrive in someone else's design.
 */
export function ClerkShell({ children }: { children: React.ReactNode }) {
  if (!clerkConfigured()) return <>{children}</>;
  return (
    <ClerkProvider
      publishableKey={clerkPublishableKey()}
      appearance={{
        variables: {
          colorBackground: "#05070A",
          colorPrimary: "#F2EDE3",
          colorPrimaryForeground: "#05070A",
          colorForeground: "#F2EDE3",
          colorMutedForeground: "#8E949D",
          colorInput: "transparent",
          colorInputForeground: "#F2EDE3",
          colorBorder: "rgba(242,237,227,0.16)",
          colorShadow: "transparent",
          borderRadius: "0px",
          fontFamily: "var(--sans)",
          fontFamilyMono: "var(--mono)",
        },
        elements: {
          /* The page already says, in its own line, what this is for. */
          header: { display: "none" },
          card: { boxShadow: "none" },
        },
      }}
    >
      {children}
    </ClerkProvider>
  );
}
