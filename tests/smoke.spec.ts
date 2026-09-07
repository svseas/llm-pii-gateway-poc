// T0 smoke [no-key]: client -> LiteLLM+Presidio -> Ollama. Mask upstream, unmask back.
// API-testing mode only (APIRequestContext via the `request` fixture) — no browser.
import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";

const BASE = process.env.LITELLM_BASE_URL || "http://localhost:4000";
const KEY = process.env.LITELLM_MASTER_KEY || "sk-local-dev";
const PROFILE = process.env.LITELLM_PROFILE || "2";
const PLACEHOLDER = /<(EMAIL_ADDRESS|PHONE_NUMBER|PERSON)(_[0-9]+)?>/;

const PII_PROMPT =
  "Repeat back exactly: contact Nguyen Van An at an.nguyen@example.com or 0912345678";

let api: APIRequestContext;
test.beforeAll(async () => {
  api = await pwRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: {
      "x-api-key": KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
  });
});
test.afterAll(async () => { await api.dispose(); });

test("health: /health/liveliness returns 200", async () => {
  const r = await api.get("/health/liveliness");
  expect(r.status()).toBe(200);
});

test("mask->unmask (non-streaming): no placeholder leaks into the response", async ({}, testInfo) => {
  const r = await api.post("/v1/messages", {
    data: { model: "claude-sonnet-5", max_tokens: 200, messages: [{ role: "user", content: PII_PROMPT }] },
  });
  const bodyText = await r.text();
  await testInfo.attach("response.json", { body: bodyText, contentType: "application/json" });
  expect(r.status(), bodyText).toBe(200);

  // HARD: a placeholder in the user-visible text means unmask is broken (Conclusion #1).
  expect(bodyText).not.toMatch(PLACEHOLDER);

  // SOFT: a small local model may paraphrase, so don't hard-fail on verbatim round-trip.
  if (!bodyText.includes("an.nguyen@example.com")) {
    console.warn("[smoke] original email not echoed verbatim (local model paraphrase?) — placeholder check is the hard gate");
  }
});

test("mask->unmask (streaming): SSE deltas carry no placeholder", async ({}, testInfo) => {
  const r = await api.post("/v1/messages", {
    data: { model: "claude-sonnet-5", max_tokens: 200, stream: true, messages: [{ role: "user", content: PII_PROMPT }] },
  });
  const stream = await r.text(); // full SSE body
  await testInfo.attach("stream.sse", { body: stream, contentType: "text/plain" });
  expect(r.status(), stream).toBe(200);
  // Exercises the SSE-bytes unmask path repaired by PR #30028.
  expect(stream).not.toMatch(PLACEHOLDER);
});

// Profile 1 only: CREDIT_CARD=BLOCK should hard-block. Skipped under the default Profile 2.
test("CREDIT_CARD BLOCK hard-blocks (Profile 1 only)", async () => {
  test.skip(PROFILE !== "1", "CREDIT_CARD BLOCK is only configured in Profile 1");
  const r = await api.post("/v1/messages", {
    data: { model: "claude-sonnet-5", max_tokens: 50, messages: [{ role: "user", content: "card 4111 1111 1111 1111" }] },
  });
  expect(r.status(), `expected a 4xx block, got ${r.status()}`).toBeGreaterThanOrEqual(400);
});
