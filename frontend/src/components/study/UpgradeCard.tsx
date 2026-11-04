import { Lock, Sparkles } from "lucide-react";
import { Badge, ButtonLink } from "@/components/ui";
import { ROUTES } from "@/lib/routes";

/**
 * A feature the user's plan doesn't have yet (the server answered 403 feature_locked, or the entitlements say so).
 * Calm, not pushy: what it is, which plan has it, what you can do meanwhile, and a link to compare the plans.
 */
export default function UpgradeCard({ feature, plan, description, children }: {
  feature: string; plan: string; description: string; children?: React.ReactNode;
}) {
  return (
    <section className="upgrade-card" aria-labelledby="upgrade-card-title">
      <span className="upgrade-card__icon" aria-hidden="true"><Lock size={22} /></span>
      <div className="min-w-0">
        <Badge tone="accent">{plan} plan</Badge>
        <h3 id="upgrade-card-title" className="upgrade-card__title">{feature} comes with {plan}</h3>
        <p className="upgrade-card__desc">{description}</p>
        <p className="upgrade-card__note">Payments open soon; until then plans come with invite codes (Account, Plan &amp; usage).</p>
        <div className="upgrade-card__actions">
          {children}
          <ButtonLink href={ROUTES.accountUsage} size="sm" variant="ghost"><Sparkles size={15} aria-hidden="true" />See plans</ButtonLink>
        </div>
      </div>
    </section>
  );
}
