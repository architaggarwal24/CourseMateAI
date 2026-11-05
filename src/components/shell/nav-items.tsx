import { BookOpen, Swords, UserCircle, type LucideIcon } from "lucide-react";
import { AREAS, type Area } from "@/lib/routes";

const ICONS: Record<Area, LucideIcon> = { study: BookOpen, hero: Swords, account: UserCircle };
const BLURBS: Record<Area, string> = { study: "Chat, quiz, notes, cards", hero: "Arena, quests, shop", account: "Profile & settings" };

/** The three areas, as shown in the desktop sidebar and the mobile bottom bar. */
export const NAV_ITEMS = AREAS.map(a => ({ ...a, Icon: ICONS[a.id], blurb: BLURBS[a.id] }));
