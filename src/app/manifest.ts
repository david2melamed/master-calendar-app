import type { MetadataRoute } from "next";

/** Makes the site installable as an app (Chrome on Mac, Safari "Add to Home Screen" on iPhone). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Master Calendar",
    short_name: "Calendar",
    description: "All your calendars, email events, and to-dos in one place.",
    id: "/calendar",
    start_url: "/calendar",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#0b1f3a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Today", url: "/calendar?view=day", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "To-Do", url: "/todo", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
