# T1 task battery — the make-or-break test

**What T1 answers:** with no cloud model in the picture, can the client (Claude Code) actually complete
real multi-step coding tasks when the "brain" is a **local model** behind LiteLLM + Presidio? This is the
survival test of the whole idea — model quality + tool-calling reliability is the real risk, not PII —
and it also catches the guardrail's worst failure: a masked placeholder written into a file on disk.

**How to run** (key-free): stack up on a profile, then in `$TARGET_REPO`:

```bash
cd "$TARGET_REPO"
export ANTHROPIC_BASE_URL=http://localhost:4000
export ANTHROPIC_AUTH_TOKEN=$LITELLM_MASTER_KEY
claude
```

Run the battery once under **Profile 2** (pragmatic default) and once under **Profile 1** (strict:
masks PERSON, blocks CREDIT_CARD). Score every task in `results/t1-scorecard.md`.

## Tasks (each has an unambiguous expected outcome)

1. **Read + summarize.** "List every public method/function in `<pick a source file>` with a one-line description each."
   - PASS: complete, accurate list; no hallucinated members.

2. **Precise edit.** "Rename the local variable `X` to `Y` in `<file>` only, then show me the diff."
   - PASS: correct minimal edit applied; `git diff` shows only the intended change (no collateral edits).

3. **Bash round-trip.** "Run `ls -1 | wc -l` in the repo root (or a small build command) and tell me the result."
   - PASS: the command actually ran via the Bash tool and the output was interpreted correctly.

4. **Multi-step.** "Find where a status flag is compared to a magic string (e.g. `== '1'`) under `<folder>`,
   introduce a named constant for it, and replace 2 usages."
   - PASS: builds/parses; a constant was introduced; exactly 2 usages replaced.

5. **PII-adjacent edit.** On a file seeded with a fake email + phone in a comment: "Add a doc-comment
   above `<function>` explaining what it does."
   - PASS: edit done AND **no `<EMAIL_ADDRESS>` / `<PERSON>` / `<PHONE_NUMBER>` placeholder written to disk**
     (check `results/hook-violations.log` — must stay empty for this file).

## Scorecard columns (per task × per profile)

| task | profile | completed? | tool rounds ok/total | malformed/failed tool calls | stream stalls | placeholders-on-disk | wall time |

## FAIL bar (pre-committed)

Under **Profile 2**, ANY of:
- fewer than **3/5** tasks completed, or
- malformed / failed tool calls dominate the loops, or
- any Presidio placeholder lands in a file on disk

→ the local-model + masking architecture is **not viable as proposed**; the proposer must demonstrate a
working configuration **live**, not in docs.
