import type { MetadataRoute } from "next";

/** Installable PWA, so phones get an app-like experience before native apps exist. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ReadyState",
    short_name: "ReadyState",
    description: "AI-powered tabletop exercises for household emergency preparedness.",
    start_url: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
