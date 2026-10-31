"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Modal } from "@/components/ui";
import SubNav from "@/components/shell/SubNav";
import { useHUDStore } from "@/hooks/useHUD";
import { useHeroStore } from "@/hooks/useHero";
import { DEFAULT_HERO_TAB, ROUTES, isHeroTab, type HeroTab } from "@/lib/routes";
import AvatarTab from "./AvatarTab";
import HeroHeader from "./HeroHeader";
import InventoryTab from "./InventoryTab";
import QuestsTab from "./QuestsTab";
import ShopTab from "./ShopTab";
import "./hero.css";

const ArenaArea = dynamic(() => import("@/components/arena/ArenaArea"), { ssr: false });
const AchievementsView = dynamic(() => import("@/components/AchievementsView"), { ssr: false });
const ForgeTab = dynamic(() => import("./ForgeTab"), { ssr: false });

const TABS: ReadonlyArray<{ id: HeroTab; label: string }> = [
  { id: "quests", label: "Quests" },
  { id: "arena", label: "Arena" },
  { id: "shop", label: "Shop" },
  { id: "inventory", label: "Inventory" },
  { id: "avatar", label: "Avatar" },
  { id: "forge", label: "Hero Forge" },
  { id: "achievements", label: "Achievements" },
];

/**
 * The Hero area: one page, one header, seven tabs. The URL holds the tab (/hero?tab=shop), so links, refresh and the
 * back button work. Level, XP, coins and streak (and the avatar) stay in view whichever tab is open, and every tab
 * reads the same stores (useHUDStore + useHeroStore), so what is bought, worn or claimed in one tab shows in all of them.
 */
export default function HeroArea() {
  const router = useRouter();
  const params = useSearchParams();
  const tabParam = params.get("tab");
  const tab: HeroTab = isHeroTab(tabParam) ? tabParam : DEFAULT_HERO_TAB;

  const loadShop = useHeroStore((s) => s.loadShop);
  const refreshIfStale = useHUDStore((s) => s.refreshIfStale);

  // The shop's data is read once when the area opens; after that the stores keep it current.
  useEffect(() => { void loadShop(); void refreshIfStale(); }, [loadShop, refreshIfStale]);

  // ── Leaving the forge with unsaved edits asks first ─────────────────────────────────────────────────────────
  const [pending, setPending] = useState<HeroTab | null>(null);
  const [saving, setSaving] = useState(false);
  const keepEditingRef = useRef<HTMLButtonElement>(null);

  const goTo = useCallback((next: HeroTab) => router.push(ROUTES.heroTab(next)), [router]);

  /** Go to `next`, or ask first when the forge has unsaved changes. Returns true when it navigated. */
  const requestTab = useCallback((next: HeroTab) => {
    const guard = useHeroStore.getState().forgeGuard;
    if (tab === "forge" && next !== "forge" && guard?.dirty) { setPending(next); return false; }
    goTo(next);
    return true;
  }, [tab, goTo]);

  // Closing the page or reloading with unsaved forge edits: the browser's own confirmation.
  useEffect(() => {
    if (tab !== "forge") return;
    const onUnload = (e: BeforeUnloadEvent) => {
      if (useHeroStore.getState().forgeGuard?.dirty) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [tab]);

  const items = TABS.map((t) => ({ href: ROUTES.heroTab(t.id), label: t.label, current: tab === t.id }));

  return (
    <div className="ws ws--play text-fg">
      <HeroHeader />
      <SubNav
        label="Hero"
        items={items}
        className="hero-tabs"
        onNavigate={(item, e) => {
          const next = TABS.find((t) => ROUTES.heroTab(t.id) === item.href)?.id;
          if (!next || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          if (next === tab) { e.preventDefault(); return; }
          if (!requestTab(next)) e.preventDefault();
        }}
      />

      <div className="flex-1 min-h-0 overflow-y-auto relative" data-hero-tab={tab}>
        {tab === "quests" && <QuestsTab />}
        {tab === "arena" && <ArenaArea />}
        {tab === "shop" && <ShopTab />}
        {tab === "inventory" && <InventoryTab />}
        {tab === "avatar" && <AvatarTab />}
        {tab === "forge" && <ForgeTab onBack={() => requestTab("avatar")} />}
        {tab === "achievements" && <AchievementsView />}
      </div>

      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        role="alertdialog"
        title="Unsaved changes"
        initialFocusRef={keepEditingRef}
        actions={
          <>
            <Button variant="ghost" onClick={() => { const next = pending!; setPending(null); useHeroStore.getState().setForgeGuard(null); goTo(next); }}>
              Discard
            </Button>
            <Button ref={keepEditingRef} onClick={() => setPending(null)}>Keep Editing</Button>
            <Button
              variant="primary"
              loading={saving}
              onClick={async () => {
                setSaving(true);
                const ok = await useHeroStore.getState().forgeGuard?.save();
                setSaving(false);
                if (ok === false) return;                  // the save failed: stay, nothing is lost
                const next = pending!;
                setPending(null);
                goTo(next);
              }}
            >
              Save &amp; Exit
            </Button>
          </>
        }
      >
        Your hero has unsaved changes. Save before you leave?
      </Modal>
    </div>
  );
}
