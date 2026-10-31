import AppShell from "@/components/shell/AppShell";

// Study, Hero and Account share one frame (sidebar / bottom bar). The login page and the full-screen hero forge don't.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
