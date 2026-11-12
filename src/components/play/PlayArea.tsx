"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import SubNav from "@/components/shell/SubNav";
import { useAuth } from "@/contexts/AuthContext";
import { ceremonyDue, useChampion } from "@/hooks/useChampion";
import { useMyHero } from "@/hooks/useMyHero";
import { useForge } from "@/hooks/useForge";
import { useHUDStore } from "@/hooks/useHUD";
import { useHeroStore } from "@/hooks/useHero";
import { sfx } from "@/lib/sound/chip";
import { DEFAULT_CHAMPION_TAB, LEGACY_HERO_TABS, ROUTES, isChampionTab, isHeroTab, type ChampionTab as ChampionTabId, type HeroTab, type PlayPage } from "@/lib/routes";
import ChampionTab from "./ChampionTab";
import ForgeTab from "./ForgeTab";
import HeroHeader from "./HeroHeader";
import InventoryTab from "./InventoryTab";
import MasteryTab from "./MasteryTab";
import PurchaseFlow from "./PurchaseFlow";
import QuestsTab from "./QuestsTab";
import ShopTab from "./ShopTab";
import "./hero.css";
import "./pixel-ui.css";

const ArenaArea = dynamic(() => import("@/components/arena/ArenaArea"), { ssr: false });
const AchievementsView = dynamic(() => import("@/components/play/AchievementsView"), { ssr: false });
const BestiaryBook = dynamic(() => import("@/components/bestiary/BestiaryBook"), { ssr: false });
const ChampionCeremony = dynamic(() => import("@/components/champion/ChampionCeremony"), { ssr: false });

const TABS: ReadonlyArray<{ id: ChampionTabId; label: string }> = [
  { id: "champion", label: "Champion" },
  { id: "inventory", label: "Inventory" },
  { id: "forge", label: "Forge" },
  { id: "shop", label: "Shop" },
  { id: "achievements", label: "Achievements" },
  { id: "mastery", label: "Mastery" },
];

/**
 * The play pages: Quests, Arena and Bestiary (each a page of its own in the side panel) and Champion, one page with
 * six tabs whose URL holds the tab (/champion?tab=shop), so links, refresh and the back button work. Level, XP,
 * coins, streak and the champion stay on top of every one of them, and they all read the same stores (useHUDStore,
 * useHeroStore, useChampion), so what is bought, worn or chosen in one place shows everywhere. A Champion link with
 * an old tab (?tab=avatar) or a tab that now has its own page (?tab=arena) is sent to the right place.
 */
export default function PlayArea({ page }: { page: PlayPage | "champion" }) {
  const router = useRouter();
  const params = useSearchParams();
  const tabParam = params.get("tab");
  const legacy = tabParam ? LEGACY_HERO_TABS[tabParam] : undefined;
  // /champion?tab=arena (a Champion link to what is now a page of its own): go there instead
  const moved: HeroTab | undefined = page === "champion" && isHeroTab(tabParam) && !isChampionTab(tabParam) ? tabParam : undefined;
  const tab: ChampionTabId = isChampionTab(tabParam) ? tabParam : (legacy && isChampionTab(legacy) ? legacy : DEFAULT_CHAMPION_TAB);
  /** What is on screen: the page, or (on Champion) its tab. */
  const screen: HeroTab = page === "champion" ? tab : page;
  const { user, loading: authLoading } = useAuth();

  const loadShop = useHeroStore((s) => s.loadShop);
  const loadHud = useHUDStore((s) => s.load);
  const loadChampion = useChampion((s) => s.load);
  // a champion who joined (a Bestiary tier finished, level 25) and hasn't had a ceremony yet
  const ceremony = useChampion((s) => ceremonyDue(s.progress));

  // The shop's data is read once when a play page opens; after that the stores keep it current. The HUD load shares
  // the start-up request when the app was opened on this page.
  useEffect(() => { void loadShop(); void loadHud(); }, [loadShop, loadHud]);
  useEffect(() => { if (!authLoading) void loadChampion({ signedIn: !!user, force: true }); }, [loadChampion, user, authLoading]);
  useEffect(() => { if (!authLoading && user) { void useMyHero.getState().load(true); void useForge.getState().load(true); } }, [user, authLoading]);
  useEffect(() => {
    if (page !== "champion") return;
    if (moved) router.replace(ROUTES.heroTab(moved));
    else if (legacy) router.replace(ROUTES.heroTab(legacy));
  }, [page, moved, legacy, router]);

  // Phones: the whole page scrolls (the header goes, the tabs stay pinned). A new tab starts at its top, just under
  // the pinned tabs, instead of wherever the last tab was scrolled to.
  const pageRef = useRef<HTMLDivElement>(null);
  const pin = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const p = pageRef.current, t = pin.current;
    if (p && t && p.scrollHeight > p.clientHeight && p.scrollTop > t.offsetTop) p.scrollTop = t.offsetTop;
  }, [tab]);

  const items = TABS.map((t) => ({ href: ROUTES.heroTab(t.id), label: t.label, current: tab === t.id }));

  return (
    <div ref={pageRef} className="ws ws--play ws--page text-fg" data-play-page={page}>
      <HeroHeader />
      {page === "champion" && (
        <div ref={pin} className="ws-page__pin hero-tabs-pin">
          <SubNav
            label="Champion"
            items={items}
            className="hero-tabs"
            onNavigate={(item, e) => {
              const next = TABS.find((t) => ROUTES.heroTab(t.id) === item.href)?.id;
              if (!next || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              if (next === tab) e.preventDefault(); else sfx("select");
            }}
          />
        </div>
      )}

      <div className="ws-page__body flex-1 min-h-0 overflow-y-auto relative" data-hero-tab={screen}>
        {screen === "quests" && <QuestsTab />}
        {screen === "arena" && <ArenaArea />}
        {screen === "bestiary" && <BestiaryBook />}
        {screen === "shop" && <ShopTab />}
        {screen === "inventory" && <InventoryTab />}
        {screen === "champion" && <ChampionTab />}
        {screen === "forge" && <ForgeTab />}
        {screen === "achievements" && <AchievementsView />}
        {screen === "mastery" && <MasteryTab />}
      </div>
      {/* not over a fight: the arena's result panel offers the ceremony itself ("Meet ...") */}
      {ceremony && screen !== "arena" && <ChampionCeremony />}
      <PurchaseFlow />
    </div>
  );
}
