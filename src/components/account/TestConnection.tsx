"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "@/components/ui/icons";
import { Button } from "@/components/ui";
import { adminApi, type AiTestResult, type SlotName } from "@/lib/admin/admin-api";
import "./test-conn.css";

/**
 * "Test connection": asks the model for one word and shows how it went - the time and its reply, or the error with a
 * plain hint (a model Ollama hasn't pulled, a tunnel that moved, a wrong key). `what` is read when clicked.
 */
export default function TestConnection({ what, label = "Test connection", disabled }: {
  what: () => { spec: string } | { slot: SlotName } | null; label?: string; disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiTestResult | null>(null);

  async function run() {
    const w = what();
    if (!w) return;
    setBusy(true);
    setResult(null);
    try { setResult(await adminApi.testModel(w)); }
    catch (e) { setResult({ ok: false, spec: null, source: "", error: e instanceof Error ? e.message : "The test couldn't run." }); }
    finally { setBusy(false); }
  }

  return (
    <div className="test-conn">
      <Button type="button" size="sm" variant="secondary" onClick={() => { void run(); }} loading={busy} disabled={disabled}>{label}</Button>
      <div role="status" aria-live="polite" className="test-conn__result">
        {busy && <span className="inline-flex items-center gap-1 text-fg-muted text-sm"><Loader2 size={14} className="animate-spin" aria-hidden="true" />Asking the model…</span>}
        {result && (result.ok ? (
          <p className="test-conn__line" data-ok="true">
            <CheckCircle2 size={14} aria-hidden="true" />
            <span><span className="font-mono">{result.spec}</span> answered in {result.latency_ms} ms: “{result.reply}”</span>
          </p>
        ) : (
          <div className="test-conn__line" data-ok="false">
            <XCircle size={14} aria-hidden="true" />
            <span>
              {result.spec && <><span className="font-mono">{result.spec}</span>{result.source ? ` (${result.source})` : ""}: </>}
              {result.error}
              {result.hint && <span className="test-conn__hint">{result.hint}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
