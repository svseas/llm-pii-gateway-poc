// T5 [no-key]: what happens when a guardrail dependency dies mid-flight?
// Stops analyzer, then litellm; records fail-open (leak) vs fail-closed (dev frozen) + timeout.
// Isolated project (mutates docker). Always restarts services in afterAll.
import { test, expect, request as pwRequest } from "@playwright/test";
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.LITELLM_BASE_URL || "http://localhost:4000";
const KEY = process.env.LITELLM_MASTER_KEY || "sk-poc-local-1234";

const PII_BODY = {
  model: "claude-sonnet-5", max_tokens: 50,
  messages: [{ role: "user", content: "email a@b.com phone 0912345678, just say ok" }],
};

function dc(cmd: string) { execSync(`docker compose ${cmd}`, { stdio: "pipe" }); }

async function callProxy() {
  const ctx = await pwRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
  });
  const t0 = Date.now();
  try {
    const r = await ctx.post("/v1/messages", { data: PII_BODY, timeout: 60_000 });
    const body = await r.text();
    return { status: r.status(), ms: Date.now() - t0, body, error: null as string | null };
  } catch (e: any) {
    return { status: 0, ms: Date.now() - t0, body: "", error: String(e?.message || e) };
  } finally {
    await ctx.dispose();
  }
}

const report: any = {};

test.afterAll(() => {
  // Best-effort: bring everything back up regardless of outcome.
  try { dc("start presidio-analyzer presidio-anonymizer litellm"); } catch {}
  try { dc("up -d"); } catch {}
});

test("baseline: proxy answers", async () => {
  report.baseline = await callProxy();
  expect(report.baseline.status, JSON.stringify(report.baseline)).toBe(200);
});

test("analyzer down: fail-open (leak) or fail-closed (error)?", async () => {
  dc("stop presidio-analyzer");
  report.analyzerDown = await callProxy();
  // Decisive classification (recorded, not asserted): a 200 here => the request went upstream
  // WITHOUT masking = fail-open (silent leak). A 4xx/5xx/timeout => fail-closed (dev blocked).
  report.analyzerDown.classification =
    report.analyzerDown.status === 200 ? "FAIL-OPEN (request proceeded, likely unmasked — verify litellm logs)"
    : report.analyzerDown.error ? "FAIL-CLOSED (timeout/transport error)"
    : "FAIL-CLOSED (error status)";
  dc("start presidio-analyzer");
  // no hard assert — the behavior IS the finding
  expect(report.analyzerDown.status).toBeDefined();
});

test("litellm down: total outage shape", async () => {
  dc("stop litellm");
  report.litellmDown = await callProxy();
  report.litellmDown.classification =
    report.litellmDown.status === 0 ? "TOTAL OUTAGE (connection refused — the proxy is a new SPOF for all coding)"
    : `status ${report.litellmDown.status}`;
  dc("start litellm");

  mkdirSync("results", { recursive: true });
  writeFileSync("results/failmode.json", JSON.stringify(report, null, 2));
  expect(report.litellmDown).toBeDefined();
});
