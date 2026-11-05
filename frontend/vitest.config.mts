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
    // Room before a test is called stuck. The server tests boot a local Workers runtime and walk whole flows; on a
    // laptop that is busy with something else they can take 3x longer than usual (15 s was too tight on Windows).
    testTimeout: 30_000,
  },
});
