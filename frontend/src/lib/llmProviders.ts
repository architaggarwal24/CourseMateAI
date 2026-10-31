"use client";

import { useCallback, useEffect, useState } from "react";
import { rawApi } from "@/lib/api";


// ── Shapes returned by GET /providers (backend/providers.py is the source of truth) ──
export interface ModelOption {
  id: string;
  label: string;
  free: boolean;
  note: string;
}

export interface BaseUrlPreset {
  label: string;
  url: string;
  hint: string;
}

export interface ProviderSpec {
  id: string;
  label: string;
  kind: string;
  cost: "free" | "paid" | "local";
  hint: string;
  key_url: string;
  key_placeholder: string;
  needs_key: boolean;
  base_url_mode: "none" | "fixed" | "optional" | "required";
  default_base_url: string;
  models: ModelOption[];
  default_model: string;
  presets: BaseUrlPreset[];
  dev_only: boolean;
  allow_custom_model: boolean;
}

/** Everything the signup / settings form needs to describe one provider choice. */
export interface LLMForm {
  provider: string;
  model: string;          // curated id, or the typed custom id when `custom` is true
  custom: boolean;        // "Custom model…" selected
  baseUrl: string;
  apiKey: string;
}

export const CUSTOM_MODEL = "__custom__";

export const emptyLLMForm: LLMForm = { provider: "", model: "", custom: false, baseUrl: "", apiKey: "" };

export function formForProvider(spec: ProviderSpec): LLMForm {
  return {
    provider: spec.id,
    model: spec.default_model,
    // Providers with no curated list (OpenAI-compatible) go straight to a typed model id.
    custom: spec.models.length === 0,
    baseUrl: spec.base_url_mode === "optional" ? spec.default_base_url : "",
    apiKey: "",
  };
}

/** First problem with the form (as a user-facing sentence), or null when it's good to send. */
export function validateLLMForm(form: LLMForm, spec: ProviderSpec | undefined): string | null {
  if (!spec) return "Choose an AI provider";
  if (spec.needs_key && !form.apiKey.trim()) return `${spec.label} API key is required`;
  if (spec.base_url_mode === "required" && !form.baseUrl.trim()) return "Base URL is required";
  if (!form.model.trim()) return "Enter a model name";
  return null;
}

/** Body fields shared by POST /auth/register and PUT /auth/api-key. */
export function llmPayload(form: LLMForm, spec: ProviderSpec) {
  const usesUrl = spec.base_url_mode === "required" || spec.base_url_mode === "optional";
  return {
    api_key: form.apiKey.trim(),
    llm_provider: form.provider,
    llm_model: form.model.trim() || undefined,
    llm_base_url: usesUrl ? form.baseUrl.trim() || undefined : undefined,
  };
}

// ── Fetch once per page load, share between components ──
let cache: ProviderSpec[] | null = null;
let inflight: Promise<ProviderSpec[]> | null = null;

async function fetchProviders(force = false): Promise<ProviderSpec[]> {
  if (cache && !force) return cache;
  if (!inflight || force) {
    inflight = rawApi.GET("/providers")
      .then(({ data, response }) => {
        if (!response.ok || !data) throw new Error(`HTTP ${response.status}`);
        cache = data.providers as unknown as ProviderSpec[];
        return cache;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export function useProviders() {
  const [providers, setProviders] = useState<ProviderSpec[]>(cache ?? []);
  const [loading, setLoading] = useState(cache === null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((force = false) => {
    setLoading(true);
    setError(null);
    fetchProviders(force)
      .then(p => setProviders(p))
      .catch(() => setError("Couldn't load AI providers — is the backend running?"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return { providers, loading, error, reload: () => load(true) };
}
