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
