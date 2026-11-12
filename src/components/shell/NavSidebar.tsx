"use client";

import { Suspense, useEffect, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BookOpen, GraduationCap, Home, PanelLeft, Repeat, Search, type IconType } from "@/components/ui/icons";
import UserMenu from "@/components/shell/UserMenu";
import Logo from "@/components/brand/Logo";
import { dueBadge, useReview } from "@/hooks/useReview";
import { useCourses } from "@/hooks/useCourses";
import { useShortcutLabel } from "@/hooks/useShortcutLabel";
import { isSidebarCollapsed, SIDEBAR_EVENT, toggleSidebar } from "@/lib/sidebar";
import { ROUTES } from "@/lib/routes";
import ReviewBadge from "./ReviewBadge";
import { openCommandPalette } from "./CommandPaletteLoader";
import PortalLink from "./PortalLink";
import InsightMeter from "./InsightMeter";
import { useFocusMode } from "@/hooks/useFocusMode";
import { Hourglass as Timer } from "@/components/ui/icons";
import { useHUDStore } from "@/hooks/useHUD";
import { Flame } from "@/components/ui/icons";

/** The light bridge (two worlds, Stage 5): your level, streak and Insight, small, over the portal to the Hero world. */
function HeroChip() {
  const level = useHUDStore((s) => s.level);
  const streak = useHUDStore((s) => s.streakDays);
  return (
    <div className="side__hero-chip" data-testid="study-hero-chip">
      <p className="side__hero-line"><span>Lv {level}</span><span className="side__hero-streak"><Flame size={12} aria-hidden="true" />{streak}<span className="sr-only">-day streak</span></span></p>
      <InsightMeter compact />
    </div>
  );
}

const subscribe = (cb: () => void) => { window.addEventListener(SIDEBAR_EVENT, cb); return () => window.removeEventListener(SIDEBAR_EVENT, cb); };
/** Collapsed or not (on <html data-sidebar>, set before first paint); the server renders it expanded. */
export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, isSidebarCollapsed, () => false);
}

interface Item { label: string; href: string; Icon: IconType; current: boolean; extra?: ReactNode }

function NavLink({ label, href, Icon, current, extra }: Item) {
  return (
    <Link href={href} aria-current={current ? "page" : undefined} className="side__link" data-tip={label}>
      <Icon size={18} aria-hidden="true" className="side__icon" />
      <span className="side__label">{label}</span>
      {extra}
    </Link>
  );
}

function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div role="group" aria-labelledby={id} className="side__group">
      <p id={id} className="side__heading">{title}</p>
      {children}
    </div>
  );
}

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/** Ctrl+B (Cmd+B) collapses / expands the side panel, in either world. */
export function useSidebarShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== "b" || typing(e.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      toggleSidebar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/**
 * The Study world's sidebar (hidden below md; phones get BottomNav). Search (Ctrl K) on top, then Study (Today,
 * Study, Review with its due count, Mock exam) and your Courses (when the plan has them), the portal into the Hero
 * world, and you at the bottom (the Hero world has a panel of its own: HeroSidebar). It collapses to a 64px icon rail (the button beside the logo, or Ctrl+B): every link keeps its name
 * for screen readers and shows it as a tooltip on hover and focus.
 */
export default function NavSidebar() {
  // The tab lives in the query string; while a page is prerendered there is none yet (useSearchParams suspends).
  return <Suspense fallback={<Sidebar tab={null} doc={null} />}><WithQuery /></Suspense>;
}
function WithQuery() {
  const params = useSearchParams();
  return <Sidebar tab={params.get("tab")} doc={params.get("doc")} />;
}

function Sidebar({ tab, doc }: { tab: string | null; doc: string | null }) {
  const pathname = usePathname();
  const collapsed = useSidebarCollapsed();
  const paletteKey = useShortcutLabel(["mod", "K"]);
  const toggleKey = useShortcutLabel(["mod", "B"]);
  const due = useReview((s) => dueBadge(s.stats));
  const { courses, locked } = useCourses();

  useSidebarShortcut();

  const inStudy = pathname === ROUTES.study;
  const study: Item[] = [
    { label: "Today", href: ROUTES.today, Icon: Home, current: pathname === ROUTES.today },
    { label: "Study", href: ROUTES.study, Icon: BookOpen, current: inStudy && tab !== "review" && tab !== "exam" && !(tab === "overview" && courses.some((c) => c.id === doc)) },
    { label: "Review", href: ROUTES.studyTab("review"), Icon: Repeat, current: inStudy && tab === "review", extra: <ReviewBadge due={due} /> },
    { label: "Mock exam", href: ROUTES.studyTab("exam"), Icon: GraduationCap, current: inStudy && tab === "exam" },
  ];

  return (
    <aside className="side" data-collapsed={collapsed || undefined}>
      <div className="side__top">
        <Link href={ROUTES.today} className="side__brand" aria-label="CourseMateAI, go to Today"><Logo size={24} /></Link>
        <button type="button" className="side__toggle" onClick={toggleSidebar} aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={`${collapsed ? "Expand" : "Collapse"} sidebar (${toggleKey})`}>
          <PanelLeft size={18} aria-hidden="true" />
        </button>
      </div>

      <button type="button" className="side__search" onClick={openCommandPalette} data-tip={`Search (${paletteKey})`}>
        <Search size={16} aria-hidden="true" />
        <span className="side__label">Go to…</span>
        <kbd className="kbd side__kbd">{paletteKey}</kbd>
      </button>

      <nav aria-label="Main" className="side__nav">
        <Group id="side-study" title="Study">
          {study.map((i) => <NavLink key={i.label} {...i} />)}
          <button type="button" className="side__link side__focus" onClick={() => useFocusMode.getState().start()} data-tip="Focus mode">
            <Timer size={18} aria-hidden="true" className="side__icon" /><span className="side__label">Focus mode</span>
          </button>
        </Group>
        {!locked && courses.length > 0 && (
          <Group id="side-courses" title="Courses">
            {courses.slice(0, 6).map((c) => (
              <Link key={c.id} href={ROUTES.studyTab("overview", undefined, c.id)} className="side__link side__course"
                aria-current={inStudy && doc === c.id ? "page" : undefined} data-tip={c.name}>
                <span className="side__dot" aria-hidden="true" />
                <span className="side__label">{c.name}</span>
                <span className="side__meta" aria-hidden="true">{c.documents.length}</span>
                <span className="sr-only">, {c.documents.length} {c.documents.length === 1 ? "PDF" : "PDFs"}</span>
              </Link>
            ))}
          </Group>
        )}
      </nav>

      <HeroChip />
      <PortalLink to="hero" className="side__portal" rail />

      <div className="side__foot">
        <UserMenu />
      </div>
    </aside>
  );
}
