---
name: pii-gateway-poc
description: Orchestrate the local LiteLLM+Presidio+Ollama PII-gateway PoC end to end — bring up docker (profile 1 or 2), wait for health, run the automated tests (T0/T2/T3/T4/T5/T6), collect outputs, and fill the results table. Use when the user says "run the pii-gateway poc", "pii-gateway-poc", or asks to (re)generate the PoC results. Everything is key-free (local Ollama upstream).
---

# Run the local LiteLLM + Presidio + Ollama PII-gateway PoC

All steps are **key-free** (local Ollama upstream). Optional arg = profile number (`1` or `2`, default `2`).
Run from this repo's root.

## Steps

1. **Preflight.**
   - `.env` exists? If not: stop and tell the user to `cp .env.example .env` and edit `OLLAMA_MODEL` / `CORPUS_DIR` / `TARGET_REPO`.
   - Docker running (`docker info`).
   - Ollama up and model present: `curl -sf http://localhost:11434/api/tags` and check `$OLLAMA_MODEL`. If missing, print `ollama pull <model>` and stop.
   - Node deps: if `node_modules` missing, `npm i` (and `npx playwright install chromium` only if the optional UI test will run).

2. **Bring up the stack:** `./scripts/up.sh ${1:-2}` (does its own preflight + health wait).

3. **API tests (T0/T2/T3):** `npm run test:api` → writes `results/fp-report.json`, `results/vn-report.json`, and the smoke result into the Playwright HTML report.

4. **Fail-mode (T5):** `npm run test:failmode` → `results/failmode.json`. (This stops/starts containers; it restores them in afterAll.)

5. **Perf + prompt-mutation (T4):** `./scripts/test4_perf_prefix.sh` (Part A), then run the capture step it prints (`./scripts/up.sh capture` → send the prompt twice → diff `results/captured-requests/` → `./scripts/up.sh 2`). → `results/perf-prefix.md`.

6. **Secrets noise (T6, optional):** `./scripts/test6_secrets_grep.sh` → `results/secrets-noise.txt`. Optionally `npm run test:ui`.

7. **Assemble results:** read every `results/*` file + `results/hook-violations.log` + the Playwright summary. Copy `results/RESULTS.template.md` → `results/RESULTS.md` and fill the blanks. Keep the two standing findings (Presidio-purpose-in-full-local, 2-hop billing). Mark cloud-specific items **N/A (no cloud upstream)**. Flag any unresolved VERIFY item.

8. **Remind the human about T1 — the make-or-break test the skill cannot run itself:** the interactive Claude Code session over the task battery in `t1-tasks.md`. Still key-free; a human must drive and watch. Print the exact commands:
   ```bash
   cd "$TARGET_REPO"
   export ANTHROPIC_BASE_URL=http://localhost:4000
   export ANTHROPIC_AUTH_TOKEN=$LITELLM_MASTER_KEY
   claude
   ```
   Then score each task in `results/t1-scorecard.md` (completed?, tool rounds ok/total, malformed tool calls, stalls, placeholders-on-disk from the hook log, wall time), once under Profile 2 and once under Profile 1.

## Rules
- Never leave containers stopped after fail-mode (`docker compose up -d` if unsure).
- Never edit `~/.claude/settings.json` yourself — use `./scripts/install-hook.sh` (it backs up first).
- Everything is key-free by design; there is no cloud upstream to configure.
- To compare profiles, re-run steps 3–4 with `./scripts/up.sh 1`.
