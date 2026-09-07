// T3 [no-key]: locale (Vietnamese) PII coverage before/after custom recognizers + CCCD-regex FP cost.
// Direct analyzer calls, no LLM.
import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const ANALYZER = process.env.PRESIDIO_ANALYZER_HOST || "http://localhost:5002";
const CORPUS = process.env.CORPUS_DIR || process.cwd();

const VN_NAMES = ["Nguyễn Văn An", "Trần Thị Bích", "anh Tùng gửi báo cáo cho chị Thanh"];
const VN_PHONES = ["0912345678", "+84 912 345 678"];
const VN_CCCD = ["079203012345"];

// Ad-hoc recognizers passed per-request (no image rebuild). VERIFY field name via GET /docs.
const AD_HOC = [
  { name: "VN_PHONE", supported_language: "en", supported_entity: "VN_PHONE",
    patterns: [{ name: "vn_phone", regex: "\\b0\\d{9}\\b", score: 0.6 }] },
  { name: "VN_CCCD", supported_language: "en", supported_entity: "VN_CCCD",
    patterns: [{ name: "cccd", regex: "\\b\\d{12}\\b", score: 0.6 }] },
];

let api: APIRequestContext;
test.beforeAll(async () => { api = await pwRequest.newContext({ baseURL: ANALYZER }); });
test.afterAll(async () => { await api.dispose(); });

async function analyze(text: string, opts: { entities?: string[]; adhoc?: boolean } = {}) {
  const data: any = { text, language: "en", score_threshold: 0.4 };
  if (opts.entities) data.entities = opts.entities;
  if (opts.adhoc) data.ad_hoc_recognizers = AD_HOC;
  const r = await api.post("/analyze", { headers: { "content-type": "application/json" }, data });
  if (!r.ok()) return { ok: false, status: r.status(), hits: [] as any[] };
  return { ok: true, status: 200, hits: (await r.json()) as any[] };
}

test("VN PII coverage before/after ad-hoc recognizers, plus CCCD-regex FP on corpus", async ({}, testInfo) => {
  const report: any = { defaultRecognizers: {}, withAdHoc: {}, cccdRegexFP: {} };

  // 1. Default recognizers (expect: PERSON misses VN names; PHONE may partially hit).
  for (const s of VN_NAMES) {
    const { hits } = await analyze(s);
    report.defaultRecognizers[s] = { PERSON: hits.some((h) => h.entity_type === "PERSON"), hits: hits.map((h) => h.entity_type) };
  }
  for (const s of [...VN_PHONES, ...VN_CCCD]) {
    const { hits } = await analyze(s);
    report.defaultRecognizers[s] = { hits: hits.map((h) => `${h.entity_type}@${h.score}`) };
  }

  // 2. With ad-hoc recognizers.
  for (const s of [...VN_PHONES, ...VN_CCCD]) {
    const { hits } = await analyze(s, { adhoc: true });
    report.withAdHoc[s] = {
      VN_PHONE: hits.some((h) => h.entity_type === "VN_PHONE"),
      VN_CCCD: hits.some((h) => h.entity_type === "VN_CCCD"),
      hits: hits.map((h) => h.entity_type),
    };
  }

  // 3. CCCD-regex FP: run only VN_CCCD ad-hoc over the corpus; count 12-digit runs in code.
  const files = listFiles();
  let filesWithCccdHit = 0, totalCccdHits = 0, scanned = 0;
  const cccdSamples: any[] = [];
  for (const f of files) {
    let text = ""; try { text = readFileSync(f, "utf8"); } catch { continue; }
    const { ok, hits } = await analyze(text, { entities: ["VN_CCCD"], adhoc: true });
    if (!ok) continue;
    scanned++;
    const cccd = hits.filter((h) => h.entity_type === "VN_CCCD");
    if (cccd.length) filesWithCccdHit++;
    totalCccdHits += cccd.length;
    for (const h of cccd) if (cccdSamples.length < 40)
      cccdSamples.push({ file: path.relative(CORPUS, f), match: text.slice(h.start, h.end) });
  }
  report.cccdRegexFP = { filesScanned: scanned, filesWithCccdHit, totalCccdHits, samples: cccdSamples,
    note: "Every hit here is a 12-digit run in code (timestamps, OIDs, sliced hashes) that the \\d{12} CCCD rule would mask." };

  mkdirSync("results", { recursive: true });
  writeFileSync("results/vn-report.json", JSON.stringify(report, null, 2));
  await testInfo.attach("vn-report.json", { path: "results/vn-report.json", contentType: "application/json" });

  // Measurement, not pass/fail: assert the analyzer answered the ad-hoc probe at all.
  const probe = await analyze("0912345678", { adhoc: true });
  expect(probe.ok, "analyzer rejected ad_hoc_recognizers — VERIFY field name via GET /docs").toBeTruthy();
});

function listFiles(): string[] {
  const EXT = [".cs", ".razor", ".ts", ".js", ".py", ".sql", ".json", ".yaml", ".md"];
  let files: string[] = [];
  try {
    files = execSync(`git -C "${CORPUS}" ls-files`, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split("\n").map((f) => path.join(CORPUS, f));
  } catch {
    files = execSync(`find "${CORPUS}" -type f -not -path '*/.git/*' -not -path '*/node_modules/*'`, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n");
  }
  return files.filter((f) => f && EXT.includes(path.extname(f)))
    .filter((f) => { try { return statSync(f).size <= 100 * 1024; } catch { return false; } })
    .sort().slice(0, 200);
}
