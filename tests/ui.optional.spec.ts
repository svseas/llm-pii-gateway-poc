// Optional [no-key] browser check: does LiteLLM's /ui load without a DATABASE_URL?
// The ONLY spec that uses a browser. Skips cleanly on 404 (no DB by design).
import { test, expect } from "@playwright/test";

const BASE = process.env.LITELLM_BASE_URL || "http://localhost:4000";

test("/ui loads (or skip if absent)", async ({ page }) => {
  const resp = await page.goto(`${BASE}/ui`, { waitUntil: "domcontentloaded" }).catch(() => null);
  if (!resp || resp.status() === 404) {
    test.skip(true, "/ui not available (no DATABASE_URL / not built in this version)");
    return;
  }
  expect(resp.status(), `/ui returned ${resp.status()}`).toBeLessThan(400);
  const html = await page.content();
  expect(html.length, "empty /ui body").toBeGreaterThan(100);
});
