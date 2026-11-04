/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { backendUrl, proxySecret } from "./config";

describe("backendUrl", () => {
  it("reads BACKEND_URL (and the older names) without a trailing slash", () => {
    expect(backendUrl({ BACKEND_URL: "https://legacy.example.com/" })).toBe("https://legacy.example.com");
    expect(backendUrl({ NEXT_PUBLIC_API_URL: "http://api:8000" })).toBe("http://api:8000");
  });
  it("defaults to the local backend while developing, and to none in production", () => {
    expect(backendUrl({ NODE_ENV: "development" })).toBe("http://localhost:8000");
    expect(backendUrl({ NODE_ENV: "production" })).toBe("");
  });
  it("trims the proxy secret", () => {
    expect(proxySecret({ PROXY_SECRET: " abc " })).toBe("abc");
    expect(proxySecret({})).toBe("");
  });
});
