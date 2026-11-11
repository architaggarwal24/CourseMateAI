import ThemeScope from "@/components/ThemeScope";

// The play pages (Quests, Arena, Bestiary and Champion with its tabs) are the Play theme.
export default function PlayLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeScope theme="play">
      <div className="flex-1 min-h-0 flex flex-col text-fg">{children}</div>
    </ThemeScope>
  );
}
