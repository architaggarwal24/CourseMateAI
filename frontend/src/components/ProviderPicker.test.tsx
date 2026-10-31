import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ProviderPicker from "@/components/ProviderPicker";
import { formForProvider, type ProviderSpec } from "@/lib/llmProviders";

// Shaped like the body of GET /providers (backend/providers.py → ProviderSpec.to_public()).
const FIXTURE: { providers: ProviderSpec[] } = {
  providers: [
    {
      id: "gemini",
      label: "Google Gemini",
      kind: "gemini",
      cost: "free",
      hint: "Free tier, no credit card.",
      key_url: "https://aistudio.google.com/apikey",
      key_placeholder: "AIza...",
      needs_key: true,
      base_url_mode: "none",
      default_base_url: "",
      models: [
        { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", free: true, note: "Newest Flash model" },
        { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash", free: true, note: "Fast all-rounder" },
      ],
      default_model: "gemini-3.8-flash",
      presets: [],
      dev_only: false,
      allow_custom_model: true,
    },
    {
      id: "openai-compatible",
      label: "OpenAI-compatible",
      kind: "openai_compat",
      cost: "paid",
      hint: "Any provider that speaks the OpenAI API.",
      key_url: "",
      key_placeholder: "API key",
      needs_key: true,
      base_url_mode: "required",
      default_base_url: "",
      models: [],
      default_model: "",
      presets: [{ label: "Groq", url: "https://api.groq.com/openai/v1", hint: "Free tier" }],
      dev_only: false,
      allow_custom_model: true,
    },
  ],
};

afterEach(cleanup);

describe("ProviderPicker", () => {
  it("renders providers, the model list and the key field from /providers data", () => {
    const [gemini] = FIXTURE.providers;
    render(
      <ProviderPicker
        providers={FIXTURE.providers}
        value={formForProvider(gemini)}
        onChange={() => {}}
      />,
    );

    expect(screen.getByText("Google Gemini")).toBeTruthy();
    expect(screen.getByText("OpenAI-compatible")).toBeTruthy();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("gemini-3.8-flash");
    expect(screen.getByText("Google Gemini API key")).toBeTruthy();
  });

  it("switching provider hands back a fresh form for that provider", () => {
    const [gemini, compat] = FIXTURE.providers;
    const onChange = vi.fn();
    render(
      <ProviderPicker
        providers={FIXTURE.providers}
        value={formForProvider(gemini)}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByText("OpenAI-compatible"));

    expect(onChange).toHaveBeenCalledWith(formForProvider(compat));
  });
});
