# llm-pii-gateway-poc

A drop-in **local harness** to evaluate a **LiteLLM + Microsoft Presidio** PII-masking gateway placed
in front of Claude Code (or any Anthropic-API client) — with **measured numbers**, on your own machine,
**without any API key**.

It answers, for *your* codebase: does the PII guardrail actually protect what you care about, what does
it break, how much does it cost, and how does it behave when it fails?

> Not a production deployment and not a model-quality benchmark. It's an evidence-gathering rig you point
> at a real repo to decide whether a proposed Presidio gateway is worth it.

## Architecture under test

```
Claude Code / client ──▶ LiteLLM proxy (Presidio guardrail) ──▶ LOCAL Ollama model
                          :4000                                   host:11434
                          Presidio analyzer :5002 / anonymizer :5001 (Docker)
```

No cloud upstream, no Anthropic key. Everything runs on the LAN, so the whole audit is free and
repeatable. (If you later put a *cloud* model upstream, the guardrail's detection behaviour measured
here is unchanged; only the "is a DLP layer even needed" question changes.)

## Prerequisites

- **Docker** (Desktop or engine).
- **Ollama** with a tool-calling model:
  ```bash
  # install Ollama (https://ollama.com), then:
  ollama serve &
  ollama pull qwen2.5-coder:7b     # or :32b / llama3.1 / a glm-4 tool-calling build
  ```
- **Node 20+** (for the Playwright test runner).
- Pinned images (auto-pulled, overridable in `.env`): LiteLLM `v1.98.0`, Presidio analyzer/anonymizer
  `ghcr.io/data-privacy-stack/*:2.2.362`.

## Quickstart

```bash
cp .env.example .env          # then edit OLLAMA_MODEL / CORPUS_DIR / TARGET_REPO if needed
npm install
./scripts/up.sh 2             # bring up profile 2 (pragmatic default); does preflight + health wait
npm run test:api              # T0 smoke, T2 false-positive scan, T3 locale/Vietnamese PII
npm run test:failmode         # T5 fail-mode (stops/starts containers, restores after)
./scripts/test4_perf_prefix.sh   # T4 latency + prompt-mutation
./scripts/test6_secrets_grep.sh  # T6 secret-regex noise on the corpus
npm run report                # open the Playwright HTML report
```

Point the corpus at any repo: `CORPUS_DIR=/path/to/repo npm run test:api` (or set it in `.env`).

## The two guardrail profiles

- **Profile 2 (default)** — pragmatic: `pre_call` only, mask `PHONE_NUMBER` + `EMAIL_ADDRESS`, threshold 0.75.
- **Profile 1 (strict)** — aggressive: also masks `PERSON`, `BLOCK`s `CREDIT_CARD`, `pre_call`+`post_call`,
  threshold 0.5. Use it to demonstrate where an aggressive PII policy breaks a coding workflow.

Switch with `./scripts/up.sh 1` and re-run the tests to compare.

## The tests

| Test | What it measures | Needs |
|------|------------------|-------|
| **T0 smoke** (`smoke.spec.ts`) | mask→upstream, unmask→back; placeholder leak into responses | stack + model |
| **T1 viability** (`t1-tasks.md`) | can the client complete real multi-step tool tasks via the gateway; any placeholder written to a file on disk | human-driven Claude Code |
| **T2 false-positive** (`presidio-fp.spec.ts`) | Presidio FP rate on YOUR code corpus @0.5 vs @0.75 (direct analyzer, no LLM) | analyzer + corpus |
| **T3 locale PII** (`vietnamese.spec.ts`) | does it catch Vietnamese names/phone/CCCD; custom-recognizer coverage + CCCD-regex FP | analyzer + corpus |
| **T4 latency/mutation** (`test4_perf_prefix.sh`) | per-round latency tax; does masking mutate the prompt prefix (local KV-cache impact) | stack + capture profile |
| **T5 fail-mode** (`failmode.spec.ts`) | analyzer down / proxy down → fail-open (leak) vs fail-closed (outage) + timeout | stack |
| **T6 secret noise** (`test6_secrets_grep.sh`) | how many files a naive secret-BLOCK rule would hard-block | corpus |

Anthropic-specific effects (the LiteLLM #22821 native-400 tool-format bug, Anthropic prompt-cache
economics) are **N/A** here — there is no Anthropic upstream.

## Point Claude Code through the gateway (T1)

```bash
cd "$TARGET_REPO"
export ANTHROPIC_BASE_URL=http://localhost:4000
export ANTHROPIC_AUTH_TOKEN=$LITELLM_MASTER_KEY   # NOTE: AUTH_TOKEN, not ANTHROPIC_API_KEY
claude
```

Then run the battery in `t1-tasks.md` and score it in `results/t1-scorecard.md`.

## Placeholder-leak hook (optional, for T1)

A `PostToolUse` hook flags any Presidio placeholder (`<EMAIL_ADDRESS>`, `<PERSON>`, …) that lands in a
file on disk — the automated fail-signal for T1. Install it (backs up `~/.claude/settings.json`):

```bash
./scripts/install-hook.sh        # merge the hook, absolute path resolved at install time
./scripts/install-hook.sh --remove   # restore the backup
```

Default = **warn mode** (logs to `results/hook-violations.log`, never steers the model — so it doesn't
contaminate the measurement). `PII_HOOK_BLOCK=1` turns it into a blocking hook.

## Reading the results

Machine outputs land in `results/` (`fp-report.json`, `vn-report.json`, `failmode.json`,
`perf-prefix.md`, `hook-violations.log`) plus the Playwright HTML report. Copy
`results/RESULTS.template.md` → `results/RESULTS.md` and fill it in (the `pii-gateway-audit` skill does
this for you).

## Agent workflow

Two Claude Code skills ship in `.claude/skills/`:
- **`pii-gateway-audit`** — runs the whole Playwright automation audit on the current repo and fills the
  results table.
- **`pii-gateway-poc`** — the fuller orchestration (both profiles, T4 capture step, T1 reminder).

## License

MIT — see `LICENSE`.
