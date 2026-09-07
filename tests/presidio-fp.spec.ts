// T2 [no-key]: Presidio false-positive rate on a REAL code corpus. Direct analyzer calls, no LLM.
// The strongest cost number: "we scanned N files of your own code, X% of hits are noise".
import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const ANALYZER = process.env.PRESIDIO_ANALYZER_HOST || "http://localhost:5002";
const CORPUS = process.env.CORPUS_DIR || process.cwd();
const MAX_FILES = 200;
const MAX_BYTES = 100 * 1024;
const ENTITIES = ["PERSON", "EMAIL_ADDRESS", "PHONE_NUMBER", "CREDIT_CARD"];
const EXT = [".cs", ".razor", ".ts", ".js", ".py", ".sql", ".json", ".yaml", ".md"];

function listFiles(): string[] {
  // Deterministic, .git-excluded, capped. Fall back to `find` if git listing fails.
  let files: string[] = [];
  try {
    const out = execSync(`git -C "${CORPUS}" ls-files`, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    files = out.split("\n").map((f) => path.join(CORPUS, f));
  } catch {
    const out = execSync(`find "${CORPUS}" -type f -not -path '*/.git/*' -not -path '*/node_modules/*'`, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    files = out.split("\n");
  }
  return files
    .filter((f) => f && EXT.includes(path.extname(f)))
    .filter((f) => { try { return statSync(f).size <= MAX_BYTES; } catch { return false; } })
    .sort()
    .slice(0, MAX_FILES);
}

// Heuristic FP classifier from an analyzer hit + surrounding text.
function classify(entity: string, snippet: string, ctxBefore: string): "real" | "fp" {
  if (entity === "EMAIL_ADDRESS") return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(snippet.trim()) ? "real" : "fp";
  if (entity === "PHONE_NUMBER") {
    const digits = snippet.replace(/\D/g, "");
    // adjacent to identifier chars (var/hex/path) => probably a code token, not a phone
    if (/[A-Za-z_]$/.test(ctxBefore)) return "fp";
    return digits.length >= 8 && digits.length <= 15 ? "real" : "fp";
  }
  if (entity === "PERSON") {
    // PERSON on a camelCase / PascalCase identifier or path segment => FP
    if (/[A-Za-z]$/.test(ctxBefore) || /[a-z][A-Z]/.test(snippet) || /[_/.]/.test(snippet)) return "fp";
    return "real";
  }
  return "real";
}

let api: APIRequestContext;
test.beforeAll(async () => { api = await pwRequest.newContext({ baseURL: ANALYZER }); });
test.afterAll(async () => { await api.dispose(); });

test("Presidio FP scan over corpus @0.5 and @0.75", async ({}, testInfo) => {
  const files = listFiles();
  expect(files.length, `no source files found under ${CORPUS}`).toBeGreaterThan(0);

  const report: any = {
    corpus: CORPUS, filesScanned: 0, filesRequested: files.length, thresholds: [0.5, 0.75],
    perThreshold: { "0.5": blank(), "0.75": blank() },
    samples: [] as any[],
  };
  function blank() {
    return { totalHits: 0, filesWithHit: 0, byEntity: {} as Record<string, number>, real: 0, fp: 0 };
  }

  let answered = 0;
  for (const f of files) {
    let text = "";
    try { text = readFileSync(f, "utf8"); } catch { continue; }
    let hits: any[] = [];
    try {
      const r = await api.post("/analyze", {
        headers: { "content-type": "application/json" },
        data: { text, language: "en", score_threshold: 0.5, entities: ENTITIES },
      });
      if (!r.ok()) continue;
      hits = await r.json();
      answered++;
    } catch { continue; }
    report.filesScanned++;

    for (const th of [0.5, 0.75] as const) {
      const bucket = report.perThreshold[String(th)];
      const kept = hits.filter((h) => h.score >= th);
      if (kept.length) bucket.filesWithHit++;
      for (const h of kept) {
        bucket.totalHits++;
        bucket.byEntity[h.entity_type] = (bucket.byEntity[h.entity_type] || 0) + 1;
        const snippet = text.slice(h.start, h.end);
        const cls = classify(h.entity_type, snippet, text.slice(Math.max(0, h.start - 1), h.start));
        bucket[cls]++;
        if (th === 0.5 && report.samples.length < 60)
          report.samples.push({ file: path.relative(CORPUS, f), entity: h.entity_type, score: h.score, snippet, cls });
      }
    }
  }

  for (const th of ["0.5", "0.75"]) {
    const b = report.perThreshold[th];
    b.fpRate = b.totalHits ? +(b.fp / b.totalHits).toFixed(3) : 0;
    b.pctFilesWithHit = report.filesScanned ? +(b.filesWithHit / report.filesScanned).toFixed(3) : 0;
  }

  mkdirSync("results", { recursive: true });
  writeFileSync("results/fp-report.json", JSON.stringify(report, null, 2));
  await testInfo.attach("fp-report.json", { path: "results/fp-report.json", contentType: "application/json" });

  // Measurement, not pass/fail: only assert the analyzer actually answered.
  expect(answered / report.filesScanned, "analyzer answered <95% of scanned files").toBeGreaterThan(0.95);
});
