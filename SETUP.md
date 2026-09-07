# SETUP — step by step, case by case

A complete onboarding guide for running the **LiteLLM + Presidio PII-gateway audit harness** locally, and for adding teammates to this repo. No Anthropic API key is needed anywhere — the whole stack runs locally against an Ollama model.

> Architecture under test: `Claude Code (or any Anthropic-API client) → LiteLLM proxy (+ Presidio guardrail) → local Ollama model`.

---

## 0. Get access & clone

This repo is **private** under the `svseas` GitHub account.

**Owner — add a teammate:**
```bash
# via gh (as the repo owner)
gh repo add-collaborator svseas/llm-pii-gateway-poc <their-github-username> --permission push
# or: GitHub → repo → Settings → Collaborators → Add people
```

**Teammate — clone:**
```bash
git clone https://github.com/svseas/llm-pii-gateway-poc.git
cd llm-pii-gateway-poc
```

**If you juggle multiple GitHub accounts on one machine**, pin the account for THIS folder so pushes use the right identity (does not change your global `gh` account):
```bash
git config credential.https://github.com.username <your-github-username>
git config user.name  "<your-name>"
git config user.email "<id>+<user>@users.noreply.github.com"
```

---

## 1. Prerequisites (install once)

| Tool | Why | Check |
|---|---|---|
| **Docker** + `docker compose` | runs LiteLLM + Presidio | `docker version` |
| **Node.js ≥ 20** + npm | Playwright test runner | `node -v` |
| **Ollama** | the local model backend | `ollama --version` |
| **jq** (recommended) | hook + scripts parse JSON | `jq --version` |
| **Claude Code** (only for the T1 interactive test) | the client under test | `claude --version` |

Install Node deps + Playwright browser (for the optional UI test):
```bash
npm install
npx playwright install chromium
```

Pull a **tool-calling** model into Ollama (the T1 viability test needs function-calling):
```bash
ollama pull qwen2.5-coder:7b     # or :32b on a big GPU; llama3.1 / glm-4-* also work
ollama serve &                    # if not already running as a service
```

---

## 2. Configure `.env`

```bash
cp .env.example .env
```
Then edit `.env`. The three things you will actually change:

- `OLLAMA_MODEL` — the model you pulled.
- `CORPUS_DIR` / `TARGET_REPO` — the repo you want to audit (default `.` = run from inside it).
- The `*_HOST` / `OLLAMA_API_BASE` values — only if Ollama runs on another machine (see Case B).

Everything else (image pins, ports, Presidio hostnames) works as-is.

---

## 3. Pick your topology (the cases)

### Case A — All on one machine (simplest)
Ollama, Docker, and you are all on the same box. Nothing to change in `.env`:
- `OLLAMA_API_BASE=http://host.docker.internal:11434`
- `OLLAMA_API_BASE_HOST=http://localhost:11434`

Go to §4.

### Case B — Ollama on a remote GPU box (LAN / Tailscale)
Your laptop runs Docker + the tests; a separate GPU machine runs Ollama. Point both Ollama vars at that box's IP/hostname:
```bash
# in .env  (example: GPU box at 100.96.125.112, or a Tailscale name)
OLLAMA_API_BASE=http://100.96.125.112:11434        # containers reach it directly (not host.docker.internal)
OLLAMA_API_BASE_HOST=http://100.96.125.112:11434   # scripts/tests reach it too
```
Make sure the GPU box exposes Ollama on the network: `OLLAMA_HOST=0.0.0.0 ollama serve` and the port is reachable (`curl http://<box>:11434/api/tags`).

> Alternatively run the WHOLE stack on the GPU box: clone there, `.env` with `OLLAMA_API_BASE=http://host.docker.internal:11434`, `./scripts/up.sh 2`, and hit `http://<box>:4000` / `:5002` from your laptop.

### Case C — Shared gateway server + Claude Code per developer (team)
One server runs the stack (Case A or B on that server); each developer points their Claude Code at it (see §6). The server's ports (`4000`, `5001`, `5002`) must be reachable by the devs. Note: the gateway is a **single point of failure** for everyone — see the fail-mode test (§5, T5) and plan HA accordingly.

---

## 4. Bring up the stack

```bash
./scripts/up.sh 2          # profile 2 = pragmatic default (recommended)
# ./scripts/up.sh 1        # profile 1 = strict/aggressive (masks PERSON, blocks CREDIT_CARD)
# ./scripts/up.sh capture  # capture profile (upstream = mock recorder) — only for T4
```
`up.sh` runs preflight (checks `.env`, verifies images are pullable, confirms your `OLLAMA_MODEL` is present) then waits for health. First run pulls ~2 GB (Presidio spaCy) and can take 30–60 s to become healthy.

Stop the stack when done:
```bash
docker compose down                       # add --profile capture if you used capture
```

**Profiles at a glance**

| Profile | mode | Masks | Purpose |
|---|---|---|---|
| `2` (default) | pre_call | PHONE, EMAIL | the realistic config |
| `1` (strict) | pre_call + post_call | PHONE, EMAIL, **PERSON**; **BLOCK** CREDIT_CARD | shows where aggressive masking breaks code |
| `capture` | pre_call | (profile 2) | routes upstream to a recorder to capture the masked prompt (T4) |

---

## 5. Run the automated audit (no API key, no interaction)

Run these from **inside the repo you want to audit** (or set `CORPUS_DIR` to it).

```bash
npm run test:api        # T0 smoke (mask/unmask), T2 Presidio false-positive scan, T3 locale PII
npm run test:failmode   # T5 fail-mode (stop analyzer / stop litellm, observe)
./scripts/test4_perf_prefix.sh   # T4 latency + prompt-mutation (bring up 'capture' first if diffing)
./scripts/test6_secrets_grep.sh  # T6 secret-regex noise on the corpus
npm run report          # open the Playwright HTML report
```

Outputs land in `results/` (`fp-report.json`, `vn-report.json`, `failmode.json`, `perf-prefix.md`, …).

**Or let an agent drive it:** in Claude Code, invoke the skill
```
/pii-gateway-audit
```
which brings the stack up, runs the specs against the current repo, collects outputs, and fills `results/RESULTS.md` from the template.

**The 5 questions the audit answers**

| # | Question | Test |
|---|---|---|
| 1 | Does the local model complete real multi-step tool tasks through the gateway? | T1 (§6) + T0 |
| 2 | Presidio false-positive rate on *your* code (@0.5 vs @0.75)? | T2 (+ T6) |
| 3 | Locale (e.g. Vietnamese) PII coverage, before/after custom recognizers? | T3 |
| 4 | Latency tax + does masking mutate the prompt prefix? | T4 |
| 5 | Failure behavior when analyzer / proxy dies? | T5 |

---

## 6. T1 — the interactive viability test (drive Claude Code through the gateway)

This is the make-or-break test: can Claude Code actually complete a coding task when the brain is the local model behind the gateway?

```bash
cd <the repo you want to work in>          # e.g. TARGET_REPO
export ANTHROPIC_BASE_URL=http://localhost:4000     # or http://<gateway-host>:4000 (Case C)
export ANTHROPIC_AUTH_TOKEN=$LITELLM_MASTER_KEY     # the value from your .env
claude                                      # interactive
```
Run the task battery in [`t1-tasks.md`](./t1-tasks.md) once under profile 2 and once under profile 1. Score each task in `results/t1-scorecard.md` (completed? tool rounds, malformed calls, stalls, placeholders-on-disk, wall time).

> Note: the correct variable for Claude Code is **`ANTHROPIC_AUTH_TOKEN`**, not `ANTHROPIC_API_KEY`.

When finished:
```bash
unset ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN
```

---

## 7. The placeholder-leak hook (optional but recommended for T1)

Detects any Presidio placeholder (`<PERSON>`, `<EMAIL_ADDRESS>`, …) that leaks into a file on disk — the T1 failure signal. It installs a `PostToolUse` hook into your `~/.claude/settings.json` with an absolute path, so it fires even when Claude Code runs in another repo.

```bash
./scripts/install-hook.sh          # merges the hook (backs up settings.json first)
# ... run your T1 session; violations are logged to results/hook-violations.log ...
./scripts/install-hook.sh --remove # restore the backup
```
Default is **warn mode** (logs, does not steer the model — so it doesn't contaminate the measurement). Set `PII_HOOK_BLOCK=1` to make it block instead.

---

## 8. Read / hand off the results

- Copy `results/RESULTS.template.md` → `results/RESULTS.md` and fill the 5-row table (the `/pii-gateway-audit` skill does this for you).
- `results/RESULTS.md` and generated JSON are **gitignored** (they're per-run / per-repo output). Keep them out of the shared repo; share them separately if needed.

---

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `up.sh` says `.env not found` | `cp .env.example .env` |
| Preflight: model not found | `ollama pull $OLLAMA_MODEL` (name must match `.env` exactly, tag included) |
| Analyzer stuck "unhealthy" 30–60 s | normal first-start (spaCy ~2 GB); wait, or `docker compose logs presidio-analyzer` |
| Image pull fails | the pinned tag/registry may have moved — override `LITELLM_IMAGE` / `PRESIDIO_*_IMAGE` in `.env` |
| Port already in use (4000/5001/5002) | stop the conflicting process, or edit the host ports in `docker-compose.yml` |
| Tests scan the wrong files | set `CORPUS_DIR` to the target repo, or run from inside it |
| Case B: containers can't reach Ollama | don't use `host.docker.internal` for a remote box — use its real IP; open port 11434; `OLLAMA_HOST=0.0.0.0 ollama serve` |
| Claude Code ignores the gateway | you set `ANTHROPIC_API_KEY` instead of `ANTHROPIC_AUTH_TOKEN`; unset the former |

---

## 10. Contributing (for teammates)

- Branch off `main`: `git checkout -b <name>/<change>`; open a PR into `main`.
- CI (`.github/workflows/playwright.yml`) runs on push/PR: it validates configs, typechecks the specs, and `bash -n`s the scripts on a hosted runner. The **full e2e** job is gated on a self-hosted `[self-hosted, gpu]` runner because hosted CI has no Docker-GPU/Ollama — enable it only if you register such a runner.
- Never commit `.env`, `results/*` (except the template), or any client-specific findings — they are gitignored by design.
