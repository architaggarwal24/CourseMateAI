"use client";

import { useEffect, useState } from "react";
import { Button, Input, Select, Skeleton, toast } from "@/components/ui";
import { adminApi, type AiModels } from "@/lib/admin/adminApi";

const NORMAL = "";

/**
 * Settings -> AI, for admins: a model of your own, tried first on your requests only (students never get it; the
 * normal models stay behind it if it fails). Ollama shows up while the app runs on your computer (npm run dev).
 */
export default function MyModel() {
  const [data, setData] = useState<AiModels | null>(null);
  const [provider, setProvider] = useState(NORMAL);
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    adminApi.aiModels().then((d) => {
      setData(d);
      const [p, ...rest] = (d.mine ?? "").split(":");
      setProvider(d.mine ? p : NORMAL);
      setModel(d.mine ? rest.join(":") : "");
    }).catch((e) => toast.apiError(e));
  }, []);

  if (!data) return <Skeleton className="h-24" />;
  const choices = data.providers.filter((p) => p.configured);
  const ollama = provider === "ollama";

  async function save(spec: string | null) {
    setBusy(true);
    try {
      const r = await adminApi.setMyModel(spec);
      setData((d) => (d ? { ...d, mine: r.spec } : d));
      toast.success(r.spec ? `Your requests now try ${r.spec} first` : "Back to the normal models");
    } catch (e) { toast.apiError(e); } finally { setBusy(false); }
  }

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(provider === NORMAL ? null : `${provider}:${model.trim()}`); }}>
      <p className="text-sm text-fg-muted">
        Admins only. Your own chats, quizzes and notes try this model first; everyone else keeps the models set in Admin.
        {data.ollama.enabled ? " Ollama runs on this computer while you use npm run dev." : ""}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Provider" value={provider} onChange={(e) => { setProvider(e.currentTarget.value); setModel(""); }}>
          <option value={NORMAL}>Normal models (no override)</option>
          {choices.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
        </Select>
        {provider !== NORMAL && (ollama && data.ollama.models.length ? (
          <Select label="Model" value={model} onChange={(e) => setModel(e.currentTarget.value)}>
            <option value="">Choose a model</option>
            {data.ollama.models.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        ) : (
          <Input label="Model" mono value={model} onChange={(e) => setModel(e.currentTarget.value)}
            placeholder={ollama ? "llama3.2" : provider === "workers-ai" ? "@cf/meta/llama-3.1-8b-instruct-fp8" : "model name"}
            hint={ollama ? `Ollama at ${data.ollama.base} isn't answering: start it, or type a model name.` : undefined} />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy} disabled={provider !== NORMAL && !model.trim()}>Save</Button>
        {data.mine && <span className="self-center text-sm text-fg-muted">Now: <span className="font-mono text-fg">{data.mine}</span></span>}
      </div>
    </form>
  );
}
