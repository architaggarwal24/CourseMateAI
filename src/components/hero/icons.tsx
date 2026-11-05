import { Award, Crown, FlaskConical, PawPrint, Shield, Sparkles, Swords, type LucideIcon } from "lucide-react";

/** The shop's categories as icons (the shop data carries emoji; the screens draw these instead). */
export const CATEGORY_ICON: Record<string, LucideIcon> = {
  headgear: Crown, armor: Shield, weapon: Swords, pet: PawPrint, potion: FlaskConical, title: Award, special: Sparkles,
};
export const INVENTORY_TAB_ICON: Record<string, LucideIcon> = { equipment: Swords, pets: PawPrint, consumables: FlaskConical, titles: Award };

export function CategoryIcon({ id, size = 18 }: { id: string; size?: number }) {
  const Icon = CATEGORY_ICON[id] ?? Sparkles;
  return <Icon size={size} aria-hidden="true" />;
}
