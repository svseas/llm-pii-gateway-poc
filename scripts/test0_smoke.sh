#!/usr/bin/env bash
# T0 smoke [no-key]: prove mask -> upstream, unmask -> back. Human-runnable variant of smoke.spec.ts.
# Sends an Anthropic-format /v1/messages request (what Claude Code sends) with a PII payload.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && { set -a; . ./.env; set +a; }

KEY="${LITELLM_MASTER_KEY:-sk-local-dev}"
URL="http://localhost:4000/v1/messages"
BODY='{"model":"claude-sonnet-5","max_tokens":200,"messages":[{"role":"user","content":"Repeat back exactly: contact Nguyen Van An at an.nguyen@example.com or 0912345678"}]}'

echo "== T0a non-streaming =="
resp="$(curl -s "$URL" -H "x-api-key: $KEY" -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" -d "$BODY")"
echo "$resp"

echo
echo "-- checks --"
if printf '%s' "$resp" | grep -qE '<(EMAIL_ADDRESS|PHONE_NUMBER)(_[0-9]+)?>'; then
  echo "FAIL: response still contains a placeholder -> UNMASK BROKEN (Conclusion #1)"
else
  echo "OK: no placeholder leaked into the response text"
fi
printf '%s' "$resp" | grep -q "an.nguyen@example.com" \
  && echo "OK: original email round-tripped (unmask works)" \
  || echo "NOTE: original email not echoed verbatim (small local model may paraphrase; check placeholder result above)"

echo
echo "== T0b masked-upstream evidence (litellm logs) =="
echo "Look for <EMAIL_ADDRESS>/<PHONE_NUMBER> in what was sent upstream:"
docker compose logs --tail 40 litellm 2>/dev/null | grep -iE 'EMAIL_ADDRESS|PHONE_NUMBER|presidio' || \
  echo "(no masked markers in tail; run with LiteLLM --detailed_debug for full upstream body)"

echo
echo "== T0c streaming =="
curl -sN "$URL" -H "x-api-key: $KEY" -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d "$(printf '%s' "$BODY" | sed 's/"max_tokens":200/"max_tokens":200,"stream":true/')" \
  | tee /tmp/poc_t0_stream.txt | tail -20
echo
if grep -qE '<(EMAIL_ADDRESS|PHONE_NUMBER)(_[0-9]+)?>' /tmp/poc_t0_stream.txt; then
  echo "FAIL(stream): placeholder in streamed text_delta -> SSE unmask broken"
else
  echo "OK(stream): no placeholder in streamed deltas"
fi
