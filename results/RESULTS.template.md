# PoC results — client → LiteLLM + Presidio → LOCAL Ollama (no-key)

**Run metadata (fill in):**
- Date:
- LiteLLM image + digest pulled:
- Presidio analyzer/anonymizer image + digest:
- Ollama model + hardware (CPU/GPU/RAM):
- Model ID the client actually sent (from LiteLLM logs):
- Config profile(s) run:

---

## Standing findings (above the table)

**Finding #1 (headline) — In a full-local architecture, Presidio's reason to exist nearly evaporates.**
Client → LiteLLM → Ollama all run on the LAN; no prompt content leaves the network. Presidio's stated
purpose (stop PII/secrets leaking to a cloud vendor) has no threat left to mitigate — at most
logging / belt-and-suspenders value.
> **Question to the proposer:** *"If the data never leaves our network, which concrete threat is Presidio
> protecting against — and is that worth its false-positive and latency cost?"*

**Finding #2 (context) — 2-hop billing / no subscription-riding.**
A self-hosted LiteLLM proxy has two auth hops; a Claude Max/Pro subscription **cannot** ride through it
(OAuth tokens aren't forwardable; ToS forbids proxying subscription auth). A *cloud* upstream would force
metered API/console billing — a cost line often omitted. This is part of why a fully-local implementation
is attractive. Also: the correct client env pair is `ANTHROPIC_BASE_URL` + **`ANTHROPIC_AUTH_TOKEN`**
(not `ANTHROPIC_API_KEY`).

**N/A (no cloud upstream):** the LiteLLM #22821 Anthropic-native 400 tool-format bug family and
Anthropic prompt-cache economics do not apply to this architecture.

---

## Results table (all rows key-free)

| # | Question | Test(s) | Result | Number |
|---|---|---|---|---|
| 1 | **Viability:** does the client complete real multi-step coding tasks with a LOCAL model behind LiteLLM+Presidio? | T1 (+T0 plumbing) | | tasks completed __/5; tool rounds ok/total; malformed-tool-call rate; stalls; placeholders-on-disk |
| 2 | Presidio false-positive cost on a real code corpus @0.5 vs @0.75 | T2 (+T6) | | FP% __; % files hit __; secrets-regex noise __ files |
| 3 | Locale (Vietnamese) PII coverage before/after custom recognizers + CCCD-regex FP | T3 | | per-entity hit/miss; CCCD FPs on corpus __ |
| 4 | Latency/throughput tax of the chain + does masking mutate the prompt prefix? | T4 | | overhead __ms/__%; tokens/s; prefix-survival __%; masked-run determinism |
| 5 | Failure behavior: analyzer down, proxy down | T5 | | fail-open? __; timeout __; outage shape |

---

## Decision thresholds (pre-committed)

- **T1 is make-or-break:** completion <3/5, or malformed tool calls dominate, or any placeholder on disk
  under Profile 2 → the local-model architecture is **not viable as proposed**; the proposer must demo a
  working config live, not in docs.
- **FP > ~5% of files interrupted** → Presidio should be `logging_only`, not MASK.
- **Chain overhead > ~20% per round**, or prefix-diff shows masking busts local KV-cache reuse → record as
  a stated performance cost.
- **Fail-open on analyzer death** → the proposer must write the policy (fail-open = silent no-guardrail;
  fail-closed = dev outage).
- **Regardless of results:** recommend egress control + pre-commit secret scanning + no prod secrets in
  dev — and press the Finding #1 question.

---

## Unresolved VERIFY items (record what you found)

- [ ] LiteLLM registry actually used (docker.litellm.ai vs ghcr.io) + digest:
- [ ] Presidio tag actually pulled (2.2.362 / 2.2.364 / mcr fallback):
- [ ] Per-entity `presidio_score_threshold` expressible? (Profile 1 as-written):
- [ ] `ad_hoc_recognizers` REST field accepted by the analyzer:
- [ ] `/ui` loads without DATABASE_URL:
- [ ] Placeholder format + run-to-run determinism (`<PERSON>` vs `<PERSON_1>`):
- [ ] local model tool-calling reliability through LiteLLM Anthropic-format translation:
