import type { MetadataRoute } from "next";

// The installable app (Phase 3 Stage 4d): served at /manifest.webmanifest. public/sw.js makes it work offline-ish.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CourseMate AI",
    short_name: "CourseMate",
    description: "Your PDFs as a study companion: chat, quizzes, flashcards, exams and a boss arena.",
    id: "/study",
    start_url: "/study",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#101117",
    theme_color: "#101117",
    categories: ["education", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Study", url: "/study", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Daily review", url: "/study?tab=review", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Arena", url: "/hero?tab=arena", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
