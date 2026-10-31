"use client";

import { useState } from "react";
import { CheckCircle2, ExternalLink, Eye, EyeOff, Info, Loader2 } from "lucide-react";
import {
  CUSTOM_MODEL, formForProvider,
  type LLMForm, type ProviderSpec,
} from "@/lib/llmProviders";
import { Badge, Button, Card, Input, Select, type BadgeTone } from "@/components/ui";

interface Props {
  providers: ProviderSpec[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  value: LLMForm;
  onChange: (next: LLMForm) => void;
  /** Settings re-uses the picker on a card background: its fields sit one step lighter. */
  onInset?: boolean;
  /** Server-side problems, shown beside the field they are about (keys are the API's field names). */
  errors?: ProviderFieldErrors;
}

export type ProviderFieldErrors = Partial<Record<"llm_provider" | "llm_model" | "llm_base_url" | "api_key", string>>;

const COST_BADGE: Record<ProviderSpec["cost"], { text: string; tone: BadgeTone }> = {
  free:  { text: "FREE",  tone: "success" },
  paid:  { text: "PAID",  tone: "neutral" },
  local: { text: "LOCAL", tone: "warning" },
};

export default function ProviderPicker({
  providers, loading, error, onRetry, value, onChange, onInset, errors,
}: Props) {
  const [showKey, setShowKey] = useState(false);
  const spec = providers.find(p => p.id === value.provider);

  if (loading && providers.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-fg-muted py-3">
        <Loader2 size={14} className="ui-spinner" /> Loading providers…
      </div>
    );
  }
  if (error || providers.length === 0) {
    return (
      <Card tone="danger" pad="sm" role="alert" className="text-sm text-ink-red">
        {error || "No AI providers available."}{" "}
        {onRetry && <Button variant="link" onClick={onRetry}>Retry</Button>}
      </Card>
    );
  }

  const set = (patch: Partial<LLMForm>) => onChange({ ...value, ...patch });
  const pickProvider = (p: ProviderSpec) => {
    if (p.id !== value.provider) onChange(formForProvider(p));   // keeps nothing from the old provider
  };

  const hasList = !!spec && spec.models.length > 0;
  const selectValue = value.custom ? CUSTOM_MODEL : value.model;
  const curated = spec?.models.find(m => m.id === value.model);

  return (
    <div className="space-y-3">
      {/* Provider buttons */}
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="AI provider">
        {providers.map(p => {
          const badge = COST_BADGE[p.cost];
          const active = value.provider === p.id;
          return (
            <Button key={p.id} pressed={active} size="sm" onClick={() => pickProvider(p)}
              className="justify-start text-left">
              {active && <CheckCircle2 size={12} className="shrink-0" aria-hidden="true" />}
              <span className="truncate">{p.label}</span>
              <Badge tone={badge.tone} className="ml-auto shrink-0">{badge.text}</Badge>
            </Button>
          );
        })}
      </div>
      {errors?.llm_provider && <p role="alert" className="ui-field__error">{errors.llm_provider}</p>}

      {spec && (
        <>
          <p className="text-xs text-fg-muted flex gap-1.5">
            <Info size={12} className="shrink-0 mt-0.5 text-ink-blue" />
            <span>{spec.hint}</span>
          </p>

          {/* Base URL (OpenAI-compatible / Ollama) */}
          {(spec.base_url_mode === "required" || spec.base_url_mode === "optional") && (
            <div>
              <Input label={spec.kind === "ollama" ? "Ollama address" : "Base URL"}
                type="text" value={value.baseUrl} spellCheck={false} mono onInset={onInset}
                onChange={e => set({ baseUrl: e.target.value })}
                error={errors?.llm_base_url}
                placeholder={spec.default_base_url || "https://your-provider.com/v1"}
                hint={spec.base_url_mode === "required"
                  ? <>Usually ends in <code>/v1</code>. Must be a public https:// address.</>
                  : undefined} />
              {spec.presets.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {spec.presets.map(pr => (
                    <Button key={pr.url} size="sm" title={pr.hint}
                      pressed={value.baseUrl.replace(/\/+$/, "") === pr.url}
                      onClick={() => set({ baseUrl: pr.url })}>
                      {pr.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Model */}
          <div>
            {hasList && (
              <Select label="Model" value={selectValue} onInset={onInset}
                onChange={e => {
                  if (e.target.value === CUSTOM_MODEL) set({ custom: true, model: "" });
                  else set({ custom: false, model: e.target.value });
                }}
                error={!value.custom ? errors?.llm_model : undefined}
                hint={!value.custom ? curated?.note : undefined}>
                {spec.models.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.label}{m.free ? " — free" : ""}
                  </option>
                ))}
                <option value={CUSTOM_MODEL}>Custom model…</option>
              </Select>
            )}
            {value.custom && (
              <div className={hasList ? "mt-2" : ""}>
                <Input label={hasList ? undefined : "Model"} aria-label={hasList ? "Custom model id" : undefined}
                  type="text" value={value.model} spellCheck={false} autoComplete="off" mono onInset={onInset}
                  onChange={e => set({ model: e.target.value })}
                  error={errors?.llm_model}
                  placeholder={spec.default_model || "model-id, exactly as your provider spells it"}
                  hint="Any model id your provider supports — including paid ones. Usage is billed to your own key." />
              </div>
            )}
          </div>

          {/* API key */}
          {spec.needs_key ? (
            <div>
              {spec.key_url && (
                <div className="flex justify-end mb-1">
                  <a href={spec.key_url} target="_blank" rel="noopener noreferrer"
                    className="ui-link text-xs flex items-center gap-1 min-h-11 md:min-h-0">
                    Get key <ExternalLink size={11} aria-hidden="true" />
                  </a>
                </div>
              )}
              <Input label={`${spec.label} API key`} type={showKey ? "text" : "password"} value={value.apiKey}
                autoComplete="off" spellCheck={false} mono onInset={onInset}
                onChange={e => set({ apiKey: e.target.value })}
                error={errors?.api_key}
                placeholder={spec.key_placeholder}
                hint="🔒 Encrypted at rest. Your key, your usage."
                trailing={
                  <Button variant="ghost" size="sm" icon onClick={() => setShowKey(v => !v)}
                    aria-label={showKey ? "Hide API key" : "Show API key"}>
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </Button>
                } />
            </div>
          ) : (
            <Card tone="warning" pad="sm" className="text-xs text-fg-muted space-y-1">
              <p className="text-ink-gold font-semibold">No API key needed</p>
              <p>
                Start Ollama (<code>ollama serve</code>) and download the model first:{" "}
                <code>ollama pull {value.model || spec.default_model}</code>
              </p>
              <p>Local testing only — this option disappears in production.</p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
