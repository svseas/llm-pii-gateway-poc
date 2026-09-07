import { defineConfig } from "@playwright/test";
import * as dotenv from "dotenv";

dotenv.config();

// Serial everything: docker mutation (failmode), a single local model, and analyzer hammering
// all make parallelism meaningless or harmful here.
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000, // local-LLM latency + analyzer cold start + corpus scan
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.LITELLM_BASE_URL || "http://localhost:4000",
  },
  projects: [
    {
      name: "api", // T0 smoke, T2 presidio FP, T3 vietnamese — request-fixture only, no browser
      testMatch: /(smoke|presidio-fp|vietnamese)\.spec\.ts$/,
    },
    {
      name: "failmode", // T5 — isolated because it stops/starts docker services
      testMatch: /failmode\.spec\.ts$/,
    },
    {
      name: "ui-optional", // optional browser check of /ui
      testMatch: /ui\.optional\.spec\.ts$/,
      use: { browserName: "chromium" },
    },
  ],
});
