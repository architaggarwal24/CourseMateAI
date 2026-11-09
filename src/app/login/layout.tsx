import type { Metadata } from "next";
import { NOINDEX } from "@/lib/site";

// The login / sign-up page (a client page, so its metadata lives here): not indexed, not in the sitemap. People
// searching for CourseMateAI land on the homepage, which links here.
export const metadata: Metadata = { title: "Log in", robots: NOINDEX };

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
