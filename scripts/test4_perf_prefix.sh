#!/usr/bin/env bash
# T4 [no-key]: local latency/throughput tax + masked-prompt prefix mutation.
# Anthropic prompt-cache economics = N/A (no Anthropic upstream). Two LOCAL measurements instead.
#   Part A: latency/throughput direct-to-Ollama vs through LiteLLM+Presidio (the per-tool-round tax).
#   Part B: capture the masked upstream body (via capture profile) and diff it against the original.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && { set -a; . ./.env; set +a; }

KEY="${LITELLM_MASTER_KEY:-sk-local-dev}"
OLLAMA_BASE_HOST="${OLLAMA_API_BASE_HOST:-http://localhost:11434}"
MODEL="${OLLAMA_MODEL:-qwen2.5-coder:7b}"
OUT="results/perf-prefix.md"
mkdir -p results results/captured-requests

# A mid-size prompt with a couple of PII items near the front (so masking mutates the prefix).
FILLER="$(head -c 3000 README.md 2>/dev/null | tr '\n' ' ')"
PROMPT="Contact Nguyen Van An at an.nguyen@example.com or 0912345678. ${FILLER}"
esc() { python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'; }
PJSON="$(printf '%s' "$PROMPT" | esc)"

{
  echo "# T4 — latency/throughput + prompt-mutation (local, no-key)"
  echo
  echo "_Anthropic prompt-cache economics: N/A (no Anthropic upstream)._"
  echo
  echo "## Part A — per-request wall time (ms)"
  echo
  echo "| # | direct-to-Ollama | via LiteLLM+Presidio |"
  echo "|---|---|---|"
} > "$OUT"

ms() { python3 -c 'import time;print(int(time.time()*1000))'; }

for i in 1 2 3 4 5; do
  t0=$(ms)
  curl -s "${OLLAMA_BASE_HOST}/api/chat" -H 'content-type: application/json' \
    -d "{\"model\":\"${MODEL}\",\"stream\":false,\"messages\":[{\"role\":\"user\",\"content\":${PJSON}}]}" >/dev/null || true
  t1=$(ms)
  d=$(( t1 - t0 ))

  p0=$(ms)
  curl -s "http://localhost:4000/v1/messages" -H "x-api-key: $KEY" \
    -H "anthropic-version: 2023-06-01" -H 'content-type: application/json' \
    -d "{\"model\":\"claude-sonnet-5\",\"max_tokens\":200,\"messages\":[{\"role\":\"user\",\"content\":${PJSON}}]}" >/dev/null || true
  p1=$(ms)
  pd=$(( p1 - p0 ))

  echo "| $i | ${d} | ${pd} |" >> "$OUT"
done

{
  echo
  echo "Overhead per round = (proxied - direct). Every client tool loop pays this tax."
  echo
  echo "## Part B — masked-prompt prefix diff"
  echo
  echo "Run separately with the capture profile so the exact masked upstream body is recorded:"
  echo
  echo '```bash'
  echo "./scripts/up.sh capture"
  echo "# send the same prompt twice through the proxy:"
  echo "for k in 1 2; do curl -s http://localhost:4000/v1/messages -H \"x-api-key: \$LITELLM_MASTER_KEY\" \\"
  echo "  -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' \\"
  echo "  -d '{\"model\":\"claude-sonnet-5\",\"max_tokens\":50,\"messages\":[{\"role\":\"user\",\"content\":\"Contact Nguyen Van An at an.nguyen@example.com or 0912345678 then continue.\"}]}'; done"
  echo "ls results/captured-requests/    # two JSON records with the MASKED body"
  echo "./scripts/up.sh 2                 # back to normal"
  echo '```'
  echo
  echo "Then compute:"
  echo "- **Diff A (original vs masked):** first differing byte offset -> 'prefix survives N/M bytes (P%)'."
  echo "  PII early in the prompt => near-total prefix invalidation of any prompt-prefix KV cache (Ollama/llama.cpp)."
  echo "- **Diff B (run 1 vs run 2, both masked):** are the two masked bodies byte-identical? If placeholder"
  echo "  numbering (<PERSON_1> ordering) is nondeterministic, identical prompts diverge run-to-run => the"
  echo "  guardrail busts the model server's own prefix cache between identical requests."
  echo
  echo "_Fill the two diff results here after running the capture step._"
} >> "$OUT"

echo "wrote $OUT (Part A measured; Part B instructions embedded — run the capture step to complete)."
