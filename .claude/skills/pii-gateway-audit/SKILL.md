---
name: pii-gateway-audit
description: Run the PII-gateway Playwright automation audit on THIS repo — bring up the local LiteLLM+Presidio+Ollama stack, run the Playwright specs (smoke, Presidio false-positive, locale PII, fail-mode) plus the perf/secrets scripts against the current repo as the corpus, then fill results/RESULTS.md from the template. Use when the user says "audit the pii gateway", "run the pii-gateway audit", or "run the playwright audit". Key-free (local Ollama upstream).
---

# PII-gateway Playwright automation audit

Point the harness at the **current repo** and produce a filled results table. Everything is key-free.
Run from this harness repo's root; set `CORPUS_DIR` / `TARGET_REPO` to the repo you want to audit.

## Steps

1. **Preflight (stop with a clear message if any fails):**
   - `.env` exists (else `cp .env.example .env`; set `CORPUS_DIR`/`TARGET_REPO` to the repo under audit).
   - `docker info` OK.
   - Ollama reachable and `$OLLAMA_MODEL` pulled: `curl -sf http://localhost:11434/api/tags`.
   - `node_modules` present (else `npm ci` or `npm i`), and `npx playwright install chromium` if the UI spec will run.

2. **Bring up the stack:** `./scripts/up.sh 2`.

3. **Run the Playwright automation:**
   - `npm run test:api` → smoke (T0), Presidio false-positive scan over `$CORPUS_DIR` (T2), locale PII (T3).
     Writes `results/fp-report.json`, `results/vn-report.json`, and the HTML report.
   - `npm run test:failmode` → `results/failmode.json` (T5; restores containers after).

4. **Run the script tests:**
   - `./scripts/test4_perf_prefix.sh` → `results/perf-prefix.md` (T4 Part A).
   - `./scripts/test6_secrets_grep.sh` → `results/secrets-noise.txt` (T6).

5. **Assemble:** read `results/*.json`, `results/*.md`, `results/hook-violations.log`, and the Playwright
   report summary. Copy `results/RESULTS.template.md` → `results/RESULTS.md` and fill every blank with the
   measured numbers (FP% @0.5/@0.75, % files hit, VN coverage, CCCD-regex FP, latency overhead, fail-mode
   classification, secrets-noise file count). Keep the standing findings; mark cloud-only items N/A.

6. **Report** the filled table back to the user and note any VERIFY item that didn't resolve. Remind them
   that **T1 (interactive Claude Code battery in `t1-tasks.md`) is human-driven** and not covered by this
   automation.

## Rules
- Read-only against the corpus (the analyzer scan never writes to `$CORPUS_DIR`).
- Never leave containers down after fail-mode.
- Playwright API specs use `APIRequestContext` (no browser) except the optional UI spec.
