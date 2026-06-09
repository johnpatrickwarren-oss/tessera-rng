# DISCIPLINES — Tessera-RNG

The Anchor disciplines this project runs under. Distilled from
`~/concord/anchor/METHODOLOGY.md` and `~/concord/anchor/skills/*.md`. This file is the
in-context prompt half of **archgate**; the deterministic half is the **sprag** gate
(see `arch-gate-usage.md`). One long-context agent, no role pipeline — but every
discipline below still applies to that single agent.

> If a discipline and convenience disagree, the discipline wins. Loosening is allowed
> only **on the record** (an ADR, or `ARCH_ALLOW_RELAX=1` for the gate) — never silently.

---

## 0. Halt-on-contradiction (foundational)

When the spec meets reality and they disagree, **STOP and ask a bounded question** — do
not code around it. Errors propagate: a spec gap forwarded into implementation becomes
wasted work. Inherited testimony is not verification: *"for every factual claim about
prior behavior, has the relevant command/fixture been run, and is the OBSERVED output
recorded inline?"* (skill 01). Before trusting that a dependency, field, or behavior
exists, **run it and record what you saw**.

Applied here: the engine import was proven by a running smoke test, not by reading docs;
the closed-union topology contradiction was confirmed by grepping the engine source, not
assumed. Both are recorded in ADR-0001 / ADR-0002.

## 1. Spec-first, impl-blind contract

Draft the acceptance criteria + anti-scope **before** product code, written without
reference to implementation. The spec is a contract; the build conforms to it, not the
reverse. Every conjunct of every requirement, and every prescription, gets a check.

## 2. Anti-scope ledger — lead with must-never (skill 06)

Each spec carries an explicit, named section listing what is deliberately **NOT** in
scope — the tempting adjacent work excluded on purpose. Scope creep is the largest hidden
cost in agent-driven work; the ledger interrupts adjacent-problem visibility,
ambiguity-resolution-by-expansion, and compound-cycle drift. **When you encounter an
anti-scope item mid-build, halt and route back — never absorb the drift silently.**

## 3. Walking skeleton

The first build is the thinnest end-to-end slice that proves the spine, not a thick
vertical of one component. Prove the whole path cheaply, then thicken where the risk is.

## 4. Prescription-to-AC coverage (skill 15)

For each prescription in the spec's mechanism/inventory sections — every emission, field,
behavioral rule, and every "Created" artifact — identify the AC "Then" clause that binds
it. **If no AC binds the prescription, or the AC fails to fail when the prescription is
mutated, the prescription is uncovered**: either add a binding AC or move it to
anti-scope. Use an explicit per-prescription table, not prose.

## 5. PRD-conjunction cross-check (skill 14)

Each AC must preserve **every** conjunct, qualifier, enumerated item, and compound literal
the requirement stated — or explicitly document the narrowing in anti-scope with a
rationale. Silent narrowing of a requirement is a defect. Use a per-AC table.

## 6. Anti-self-confirming tests (skill 13)

For each assertion: *"identify the production line(s) it means to verify. If those lines
were deleted or replaced with a no-op, would this test still pass?"* If yes, the test is
self-confirming and proves nothing — fix it before relying on it. Cross-validate against
an independent reference (e.g. a naive two-pass computation), and inline/seed any RNG so a
test cannot shadow the implementation it checks.

## 7. Instrumented-caveat discipline (skill 16)

When a measurement's value materially diverges from what its name implies, resolve it
structurally: **emit a parallel measurement of the omitted portion in the same artifact,
OR rename the column to make the partiality explicit, OR widen to the full cost — never
publish the fraction with only a footnote.** Honest measurement (detection floor,
attribution floor, coverage/saturation) reports the real number, caveats in the open.

## 8. Pre-emit grilling (skill 01)

Before an artifact is "done," adversarially review it yourself in three buckets:
**CRITICAL** (fix before forwarding), **LIKELY-SURFACES** (pre-flag in the artifact),
**PRE-EMPTABLE** (fold the fix in now). The author is simultaneously the worst objective
reviewer (confirmation bias) and the best fast catcher of surface errors — structure
exploits both. Pair with a **cold-eye review**: a fresh-context pass that never saw the
build reasoning, prompted to find what is wrong, before declaring v1 done.

## 9. Round numbering & durable trail (skill 07)

Decisions get an ADR (`design/adr/NNNN-*.md`), appended one per real decision, never
rewritten. `STATE.md` is overwritten as the cold-readable "now." The trail must let a
fresh reader resume without the build conversation.

---

## Gate discipline (sprag) — summary; full usage in `arch-gate-usage.md`

- `sprag init` early; **baseline from the clean skeleton**; ratchet from there.
- **Never `--no-verify`.** The only two ways to green: fix the code, or loosen on the
  record (`ARCH_ALLOW_RELAX=1`, which prints what it loosened).
- A dead gate fails closed (exit 2), never scores zero-and-passes.
