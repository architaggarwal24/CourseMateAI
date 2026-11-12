// The illustration on each feature page: a still drawn in the landing page's style (the same cards as its hero), with
// made-up example content - not a screenshot. Decorative: the page's words carry the information.
import dynamic from "next/dynamic";
import ThemeScope from "@/components/ui/ThemeScope";
import { CheckCircle2, FileText, Layers, RotateCcw } from "@/components/ui/icons";
import type { FeaturePage } from "@/lib/landing/features";

const LandingDuel = dynamic(() => import("./LandingDuel"));

export default function FeatureArt({ art }: { art: FeaturePage["art"] }) {
  if (art === "game") return <ThemeScope theme="play"><div className="feature-art feature-art--play"><LandingDuel /></div></ThemeScope>;
  return (
    <div className="landing-shot feature-art" aria-hidden="true">
      <div className="landing-shot__bar"><span /><span /><span /><em>{art === "tutor" ? "Biology 101 · Chat" : art === "quiz" ? "Biology 101 · Quiz" : "Review · 6 due"}</em></div>
      <div className="landing-shot__body">
        {art === "tutor" && (
          <>
            <p className="landing-msg landing-msg--you">What does the Krebs cycle produce?</p>
            <div className="landing-msg landing-msg--ai">
              <p>Per turn: two CO₂, three <strong>NADH</strong>, one FADH₂ and one ATP <span className="landing-cite">p. 18</span>.</p>
              <p>The NADH carries electrons on to the electron transport chain <span className="landing-cite">p. 19</span>.</p>
              <p className="landing-msg__follow">Where does the Krebs cycle happen in the cell?</p>
            </div>
            <div className="landing-card"><span className="landing-card__label"><FileText size={12} />Sources</span>
              <span className="landing-card__meta">[1] Cell Biology.pdf · p. 18 &nbsp; [2] Cell Biology.pdf · p. 19</span></div>
          </>
        )}
        {art === "quiz" && (
          <>
            <p className="feature-art__q">Which organelle makes most of a cell&apos;s ATP?</p>
            <span className="landing-opt">Golgi apparatus</span>
            <span className="landing-opt landing-opt--ok"><CheckCircle2 size={12} />Mitochondria</span>
            <span className="landing-opt">Ribosome</span>
            <div className="landing-card"><span className="landing-card__label"><Layers size={12} />Right · from Cell Biology.pdf, p. 12</span>
              <span className="landing-card__meta">Most ATP comes from oxidative phosphorylation in the mitochondria.</span></div>
          </>
        )}
        {art === "review" && (
          <>
            <div className="landing-card"><span className="landing-card__label"><RotateCcw size={12} />Missed in a quiz · Glycolysis</span>
              <p className="feature-art__q">Where in the cell does glycolysis happen?</p>
              <span className="landing-card__meta">In the cytoplasm.</span></div>
            <div className="feature-art__grades">
              <span>Again <em>1m</em></span><span>Hard <em>6m</em></span><span className="is-good">Good <em>10m</em></span><span>Easy <em>4d</em></span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
