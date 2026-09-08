import type { Metadata } from "next";
import { Instrument_Serif } from "next/font/google";
import { SITE_HEAD_CSS } from "../lib/theme";
import { SITE_FONT_PRELOAD } from "../lib/site-fonts";
import "./site.css";

const SITE = "https://getactuals.net";
const DESCRIPTION =
  "One command reads your Claude Code sessions and git history on your machine and shows what the agents actually left behind: what was kept, what got thrown away, what quietly died, and what it cost. Nothing leaves your computer.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Actuals: see what your agents actually shipped", template: "%s" },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Actuals",
    url: SITE,
    title: "Actuals: see what your agents actually shipped",
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: { card: "summary_large_image", title: "Actuals: see what your agents actually shipped", description: DESCRIPTION },
  robots: { index: true, follow: true },
};

/** The display face. The sans and the mono are embedded with the report's own tokens. */
const serif = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "swap",
  variable: "--ac-serif",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The landing sets one attribute on <html> before first paint; without this a
    // development build reports that attribute as a hydration mismatch.
    <html lang="en" className={serif.variable} suppressHydrationWarning>
      <head>
        {/* The report's two faces as files, preloaded, and the report's palette inline. */}
        {SITE_FONT_PRELOAD.map((href) => (
          <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="anonymous" />
        ))}
        <style dangerouslySetInnerHTML={{ __html: SITE_HEAD_CSS }} />
      </head>
      <body>
        {children}
        {/* Vercel Web Analytics, cookieless: the script the platform serves on its own domain, only where it exists */}
        {process.env.VERCEL === "1" ? (
          <>
            <script dangerouslySetInnerHTML={{ __html: "window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};" }} />
            <script defer src="/_vercel/insights/script.js" />
          </>
        ) : null}
      </body>
    </html>
  );
}
