import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({ aiModels: vi.fn(), setAiSlots: vi.fn(), setMyModel: vi.fn(), setOllamaUrl: vi.fn() }));
vi.mock("@/lib/admin/adminApi", async (orig) => ({ ...(await orig<typeof import("@/lib/admin/adminApi")>()), adminApi: api }));
vi.mock("@/components/ui/Toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), apiError: vi.fn() } }));

import AiModelsCard from "./AiModels";
import MyModel from "./MyModel";

const DATA = {
  slots: {}, mine: null, ollama: { enabled: true, base: "http://localhost:11434", models: ["llama3.2:latest"] },
  defaults: { fast: "gemini:flash-lite", strong: "gemini:flash", premium: "claude:sonnet", small: "@cf/meta/llama" },
  providers: [{ id: "gemini", configured: true, key_env: "GOOGLE_API_KEY" }, { id: "openai", configured: false, key_env: "OPENAI_API_KEY" },
    { id: "workers-ai", configured: true, key_env: null }, { id: "ollama", configured: true, key_env: null }],
};
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Admin -> AI models", () => {
  it("shows the setting as a placeholder and saves only the slots that changed", async () => {
    api.aiModels.mockResolvedValue(DATA);
    api.setAiSlots.mockResolvedValue({ ...DATA, slots: { fast: "gemini:other" } });
    render(<AiModelsCard />);
    const fast = await screen.findByLabelText("Fast");
    expect(fast.getAttribute("placeholder")).toBe("gemini:flash-lite");
    fireEvent.change(fast, { target: { value: "gemini:other" } });
    fireEvent.click(screen.getByRole("button", { name: "Save models" }));
    await waitFor(() => expect(api.setAiSlots).toHaveBeenCalledWith({ fast: "gemini:other" }));
  });
});

describe("Settings -> AI: your model (admins)", () => {
  it("offers only providers with a key (and Ollama's pulled models in dev), and saves provider:model", async () => {
    api.aiModels.mockResolvedValue(DATA);
    api.setMyModel.mockResolvedValue({ spec: "ollama:llama3.2:latest" });
    render(<MyModel />);
    const provider = await screen.findByLabelText("Provider");
    expect([...provider.querySelectorAll("option")].map((o) => o.value)).toEqual(["", "gemini", "workers-ai", "ollama"]);
    fireEvent.change(provider, { target: { value: "ollama" } });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "llama3.2:latest" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.setMyModel).toHaveBeenCalledWith("ollama:llama3.2:latest"));
  });

  it("choosing the normal models clears the override", async () => {
    api.aiModels.mockResolvedValue({ ...DATA, mine: "gemini:flash" });
    api.setMyModel.mockResolvedValue({ spec: null });
    render(<MyModel />);
    fireEvent.change(await screen.findByLabelText("Provider"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.setMyModel).toHaveBeenCalledWith(null));
  });
});

describe("Ollama: any model, and a tunnel for the live site", () => {
  it("saves a tunnel address and shows what that Ollama has", async () => {
    api.aiModels.mockResolvedValue({ ...DATA, ollama: { enabled: false, base: null, models: [], tunnel: null, local: false } });
    api.setOllamaUrl.mockResolvedValue({ ...DATA, ollama: { enabled: true, base: "https://o.trycloudflare.com", models: ["phi4"], tunnel: "https://o.trycloudflare.com", local: false } });
    render(<AiModelsCard />);
    expect((await screen.findByText(/cloudflared tunnel --url/)).textContent).toContain("--http-host-header");
    fireEvent.change(screen.getByLabelText("Tunnel address"), { target: { value: "https://o.trycloudflare.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.setOllamaUrl).toHaveBeenCalledWith("https://o.trycloudflare.com"));
    expect((await screen.findByRole("status")).textContent).toContain("phi4");
  });

  it("a model Ollama hasn't listed can be typed in", async () => {
    api.aiModels.mockResolvedValue(DATA);
    api.setMyModel.mockResolvedValue({ spec: "ollama:my-model:q4" });
    render(<MyModel />);
    fireEvent.change(await screen.findByLabelText("Provider"), { target: { value: "ollama" } });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "__other" } });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "my-model:q4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.setMyModel).toHaveBeenCalledWith("ollama:my-model:q4"));
  });
});
