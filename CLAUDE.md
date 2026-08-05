# CLAUDE.md — Tessera-RNG

Operational observability for flat random-graph (RNG-family) datacenter networks.
A **sibling product** of Tessera (GPU-cluster shard observability) — not a code fork;
what's shared is the statistical engine, repointed from cluster shards to network
**path-classes** and physical **fault domains**. The engine is consumed as a
git-dependency and **never forked** — extend only at its declared extension points.

## How this project is run: archgate

This project runs the **archgate** discipline: the Anchor disciplines as the in-context
prompt, and the **sprag** gate as the deterministic floor. One long-context agent, no role
pipeline.

- @DISCIPLINES.md — the disciplines this agent operates under (halt-on-contradiction,
  spec-first/impl-blind, anti-scope-first, prescription→AC coverage, anti-self-confirming
  tests, instrumented-caveat, cold-eye review, durable trail).
- @arch-gate-usage.md — how to run the sprag gate; never `--no-verify`; loosen only on
  the record.

## Where to start reading

- `STATE.md` — the cold-readable "now": what is built, what is next.
- `design/adr/` — one ADR per real decision (append-only). Start at ADR-0001.
- `design/spec/v1-spec.md` — the impl-blind v1 contract (anti-scope first).

## Toolchain

- `pnpm install` — resolves the engine git-dep (`@johnpatrickwarren-oss/deploysignal-engine`;
  the current tag is pinned in `package.json` — read it there, don't trust hand-copied docs).
- `pnpm test` — `tsc -p tsconfig.test.json` then `node --test test/*.test.js`.
- `pnpm typecheck` — type-check only.
- `pnpm gate` — run the sprag architectural gate over the whole repo (the script is
  `check .`, see `package.json`).

Product code lives in `src/`; tests in `test/` (`*.test.ts` → compiled `*.test.js`);
the demo dashboard in `demos/`; honest-measurement matrices in `coverage-matrices/`.

## Non-negotiables (see DISCIPLINES + the v1 spec anti-scope)

- No forking / re-vendoring the engine internals — git-dep + declared extension points only.
- No live-fabric validation, no customer telemetry, no real data-plane drain wiring in v1.
- The statistical layer localizes to a shared-resource **fault domain**, not to a specific
  marginal optic (hardware root-cause is out of scope). Tomography claims identifiability
  of the shared-resource set, nothing stronger.
## Knowledge base — read before working here

`~/concord/knowledge` is an LLM-maintained wiki: the statistics, engineering methodology, and design
standards behind the repos in `~/concord`. It is a separate git repository and it is the **single
entry point**. Do not point at any other standards document.

- `knowledge/SCHEMA.md` — how the wiki is written and read. Read first.
- `knowledge/index.md` — root router, topics only. Two hops to any page.
- `knowledge/WORKLIST.md` — outstanding work and unresolved contradictions.

**Check the wiki before claiming anything** about detector maths, validity, or study results. It
records retractions and superseded claims that this repo may still carry, so a doc in this repo
agreeing with you is not confirmation.

**Write findings back as wiki pages** under its schema. Do not correct the wiki by editing repo
docs, and do not leave a finding only in a commit message.

Design and writing standards route through `knowledge/design/` to `~/concord/junction`, which is
canonical for both. `WRITING-STYLE.md` exists only there.

**Communication with John** follows `~/concord/knowledge/design/pages/session-communication.md`:
verify first; cite code, not prose; lead with corrections; decisions get 3+ numbered options with a
recommendation; state what you did not do; a reply is as long as the finding.
