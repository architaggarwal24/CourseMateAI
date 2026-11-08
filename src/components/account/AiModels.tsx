"use client";

import { useCallback, useEffect, useState } from "react";
import { Cpu } from "@/components/icons";
import { Badge, Button, Card, Input, Skeleton, toast } from "@/components/ui";
import { adminApi, type AiModels, type SlotName } from "@/lib/admin/adminApi";

const SLOTS: { id: SlotName; label: string; hint: string }[] = [
  { id: "fast", label: "Fast", hint: "Cheap model: Apprentice questions, everyone's fallback." },
  { id: "strong", label: "Strong", hint: "Questions and answers on Scholar and Sage." },
  { id: "premium", label: "Premium", hint: "Archmage's first choice." },
  { id: "small", label: "Small (Workers AI)", hint: "Boss lines and rewrites: a @cf/... model, free within the daily allowance." },
];

/**
 * Admin -> AI models: the model behind each slot for everyone, saved over the LLM_* settings (an empty field goes
 * back to the setting, shown as the placeholder). Only providers with a key on the server can be chosen.
 */
export default function AiModelsCard() {
  const [data, setData] = useState<AiModels | null>(null);
  const [draft, setDraft] = useState<Partial<Record<SlotName, string>>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await adminApi.aiModels();
      setData(d);
      setDraft(d.slots);
    } catch (e) { toast.apiError(e); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;
    const change: Partial<Record<SlotName, string | null>> = {};
    for (const s of SLOTS) {
      const v = (draft[s.id] ?? "").trim();
      if (v !== (data.slots[s.id] ?? "")) change[s.id] = v || null;
    }
    if (!Object.keys(change).length) { toast.info("Nothing changed"); return; }
    setBusy(true);
    try {
      const d = await adminApi.setAiSlots(change);
      setData(d);
      setDraft(d.slots);
      toast.success("Models saved: new requests use them now");
    } catch (err) { toast.apiError(err); } finally { setBusy(false); }
  }

  return (
    <Card title={<span className="inline-flex items-center gap-2"><Cpu size={16} aria-hidden="true" />AI models</span>} className="settings-section">
      {!data ? <Skeleton className="h-40" /> : (
        <form onSubmit={save} className="space-y-4">
          <p className="text-sm text-fg-muted">
            Write <span className="font-mono">provider:model</span>. Leave a field empty to use the server&apos;s setting (shown greyed).
            The daily spend cap still applies.
          </p>
          <ul className="flex flex-wrap gap-2 list-none p-0" aria-label="Providers">
            {data.providers.filter((p) => p.id !== "ollama").map((p) => (
              <li key={p.id}>
                <Badge tone={p.configured ? "success" : "neutral"}>{p.id}{p.configured ? "" : ` · no ${p.key_env}`}</Badge>
              </li>
            ))}
          </ul>
          <div className="grid gap-3 sm:grid-cols-2">
            {SLOTS.map((s) => (
              <Input key={s.id} label={s.label} hint={s.hint} mono value={draft[s.id] ?? ""} placeholder={data.defaults[s.id] || "not set"}
                onChange={(e) => { const v = e.currentTarget.value; setDraft((d) => ({ ...d, [s.id]: v })); }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy}>Save models</Button>
            <Button type="button" variant="ghost" disabled={busy || !Object.keys(data.slots).length}
              onClick={() => setDraft({})}>Use the server&apos;s settings</Button>
          </div>
        </form>
      )}
    </Card>
  );
}
