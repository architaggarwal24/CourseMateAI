import ThemeScope from "@/components/ThemeScope";

// The whole Hero area (/hero, one page with tabs) is the Play theme.
export default function HeroLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeScope theme="play">
      <div className="flex-1 min-h-0 flex flex-col text-fg">{children}</div>
    </ThemeScope>
  );
}
