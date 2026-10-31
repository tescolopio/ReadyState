import type { Metadata } from "next";
import { Inter, Source_Sans_3, Source_Serif_4 } from "next/font/google";
import "./globals.css";

// Self-hosted by next/font: no requests go to Google from the browser.
const sourceSerif = Source_Serif_4({ variable: "--font-source-serif", subsets: ["latin"] });
const sourceSans = Source_Sans_3({ variable: "--font-source-sans", subsets: ["latin"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ReadyState: practice the unexpected",
  description:
    "Tabletop exercises for households: practice emergency decisions, learn what to consider, and build a plan.",
};

/**
 * Picks the visual style (A Journal, B Modern) before first paint, so there's
 * no flash of the wrong one: `?style=a|b` sets and remembers it, otherwise the
 * remembered choice, otherwise A (work item F14 adds random assignment).
 */
const STYLE_SCRIPT = `(function(){try{var p=new URLSearchParams(location.search).get("style");var s=p==="a"||p==="b"?p:localStorage.getItem("readystate-style");if(p==="a"||p==="b")localStorage.setItem("readystate-style",p);document.documentElement.dataset.style=s==="b"?"b":"a";}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-style="a"
      suppressHydrationWarning
      className={`${sourceSerif.variable} ${sourceSans.variable} ${inter.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: STYLE_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
