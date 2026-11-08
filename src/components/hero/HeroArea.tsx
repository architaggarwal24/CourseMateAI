"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import SubNav from "@/components/shell/SubNav";
import { useAuth } from "@/contexts/AuthContext";
import { ceremonyDue, useChampion } from "@/hooks/useChampion";
import { useHUDStore } from "@/hooks/useHUD";
import { useHeroStore } from "@/hooks/useHero";
import { DEFAULT_HERO_TAB, LEGACY_HERO_TABS, ROUTES, isHeroTab, type HeroTab } from "@/lib/routes";
import ChampionTab from "./ChampionTab";
import HeroHeader from "./HeroHeader";
import InventoryTab from "./InventoryTab";
import QuestsTab from "./QuestsTab";
import ShopTab from "./ShopTab";
import "./hero.css";
import "./pixel-ui.css";

const ArenaArea = dynamic(() => import("@/components/arena/ArenaArea"), { ssr: false });
const AchievementsView = dynamic(() => import("@/components/AchievementsView"), { ssr: false });
const BestiaryBook = dynamic(() => import("@/components/bestiary/BestiaryBook"), { ssr: false });
const ChampionCeremony = dynamic(() => import("@/components/champion/ChampionCeremony"), { ssr: false });

const TABS: ReadonlyArray<{ id: HeroTab; label: string }> = [
  { id: "quests", label: "Quests" },
  { id: "arena", label: "Arena" },
  { id: "bestiary", label: "Bestiary" },
  { id: "shop", label: "Shop" },
  { id: "inventory", label: "Inventory" },
  { id: "champion", label: "Champion" },
  { id: "achievements", label: "Achievements" },
];

/**
 * The Hero area: one page, one header, seven tabs. The URL holds the tab (/hero?tab=shop), so links, refresh and the
 * back button work. Level, XP, coins, streak and the champion stay in view whichever tab is open, and every tab
 * reads the same stores (useHUDStore, useHeroStore, useChampion), so what is bought, worn or chosen in one tab
 * shows in all of them. Old ?tab=avatar / ?tab=forge links land on the Champion tab.
 */
export default function HeroArea() {
  const router = useRouter();
  const params = useSearchParams();
  const tabParam = params.get("tab");
  const legacy = tabParam ? LEGACY_HERO_TABS[tabParam] : undefined;
  const tab: HeroTab = isHeroTab(tabParam) ? tabParam : legacy ?? DEFAULT_HERO_TAB;
  const { user, loading: authLoading } = useAuth();

  const loadShop = useHeroStore((s) => s.loadShop);
  const loadHud = useHUDStore((s) => s.load);
  const loadChampion = useChampion((s) => s.load);
  // a champion who joined (a Bestiary tier finished, level 25) and hasn't had a ceremony yet
  const ceremony = useChampion((s) => ceremonyDue(s.progress));

  // The shop's data is read once when the area opens; after that the stores keep it current. The HUD load shares the
  // start-up request when the app was opened on this page.
  useEffect(() => { void loadShop(); void loadHud(); }, [loadShop, loadHud]);
  useEffect(() => { if (!authLoading) void loadChampion({ signedIn: !!user, force: true }); }, [loadChampion, user, authLoading]);
  useEffect(() => { if (legacy) router.replace(ROUTES.heroTab(legacy)); }, [legacy, router]);

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
          if (next === tab) e.preventDefault();
        }}
      />

      <div className="flex-1 min-h-0 overflow-y-auto relative" data-hero-tab={tab}>
        {tab === "quests" && <QuestsTab />}
        {tab === "arena" && <ArenaArea />}
        {tab === "bestiary" && <BestiaryBook />}
        {tab === "shop" && <ShopTab />}
        {tab === "inventory" && <InventoryTab />}
        {tab === "champion" && <ChampionTab />}
        {tab === "achievements" && <AchievementsView />}
      </div>
      {/* not over a fight: the arena's result panel offers the ceremony itself ("Meet ...") */}
      {ceremony && tab !== "arena" && <ChampionCeremony />}
    </div>
  );
}
