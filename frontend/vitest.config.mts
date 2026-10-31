import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "next/font/local": fileURLToPath(new URL("./src/test/next-font-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/node-uploads.ts", "./src/test/setup-timeouts.ts"],
    // slower machines (and Windows CI) get more room before a test is called stuck
    testTimeout: 15_000,
  },
});
