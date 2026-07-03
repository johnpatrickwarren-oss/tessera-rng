/**
 * ADR-0048 — sparse-recovery cross-check of the linear localizer (anti-self-confirming tests,
 * DISCIPLINES §6: "cross-validate against an independent reference").
 *
 * The ADR-0046 scorer is a greedy mixture-LLR cover on the linear model y ≈ √T·W·θ (W = weighted
 * incidence, θ ≥ 0 per-resource severities). The INDEPENDENT reference here solves the same
 * observation model by a completely different algorithm: non-negative LASSO via projected
 * cyclic coordinate descent, min ½‖y − √T·Wθ‖² + λ‖θ‖₁, θ ≥ 0 — the compressed-sensing
 * formulation (Firooz & Roy: expander incidence matrices satisfy the recovery conditions; this
 * fabric IS an expander design). If the greedy cover and the sparse solver disagree on the
 * support, one of them is wrong — the test fails and says which fixture.
 *
 * λ is NOT a tuned knob: it is set to the universal-threshold form σ√(2 ln R) (σ = 1 by
 * standardization, R = number of candidate resources) — the same look-elsewhere logic as the
 * ADR-0046 admission charge, in its L1 guise.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline, calibrateForSession, leafTStats } from '../src/pipeline';
import { generateTelemetry } from '../src/telemetry';
import { standardizeAll } from '../src/calibration';
import { detectAll, DEFAULT_DETECT } from '../src/detect';
import { buildSurface } from '../src/surface';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import type { FaultDomainSnapshot, PathClassId, ResourceId } from '../src/domain';

const CROSS = generateSpraypointFabric(DEFAULT_SPRAYPOINT);
const T = 60;

/** Non-negative LASSO by projected cyclic coordinate descent (deterministic; fixed sweeps). */
function nnLasso(snapshot: FaultDomainSnapshot, y: Map<PathClassId, number>, sqrtT: number): Map<ResourceId, number> {
  const leaves = [...snapshot.path_classes].sort();
  const li = new Map(leaves.map((pc, i) => [pc, i]));
  const cols = new Map<ResourceId, Array<{ i: number; w: number }>>();
  for (const e of snapshot.edges) {
    if (!cols.has(e.resource)) cols.set(e.resource, []);
    cols.get(e.resource)!.push({ i: li.get(e.path_class)!, w: (e.weight ?? 1) * sqrtT });
  }
  const resources = [...cols.keys()].sort();
  const yv = leaves.map((pc) => y.get(pc) ?? 0);
  const resid = [...yv]; // residual r = y − Wθ, maintained incrementally
  const theta = new Map(resources.map((r) => [r, 0]));
  const lambda = Math.sqrt(2 * Math.log(resources.length));
  for (let sweep = 0; sweep < 200; sweep++) {
    let moved = 0;
    for (const r of resources) {
      const col = cols.get(r)!;
      let g = 0;
      let nrm = 0;
      const t0 = theta.get(r)!;
      for (const { i, w } of col) {
        g += w * (resid[i] + w * t0); // gradient wrt θ_r with θ_r removed from the residual
        nrm += w * w;
      }
      const t1 = Math.max((g - lambda) / nrm, 0); // soft-threshold + non-negativity projection
      if (t1 !== t0) {
        for (const { i, w } of col) resid[i] += w * (t0 - t1);
        theta.set(r, t1);
        moved += Math.abs(t1 - t0);
      }
    }
    if (moved < 1e-10) break;
  }
  return theta;
}

/** The sparse solver's support, largest severities first. */
function supportOf(theta: Map<ResourceId, number>, min = 1e-6): ResourceId[] {
  return [...theta].filter(([, v]) => v > min).sort((a, b) => b[1] - a[1]).map(([r]) => r);
}

async function bothSolvers(degradations: Array<{ resource_id: string; delta: number; start_tick: number }>, seed: number) {
  const { calibration, ctx } = calibrateForSession(CROSS, { seed, ticks: T }, DEFAULT_DETECT, false, true);
  const residuals = standardizeAll(generateTelemetry(CROSS, { seed, ticks: T, degradations }).series, calibration);
  const verdicts = detectAll(residuals, DEFAULT_DETECT, ctx);
  const surface = buildSurface(verdicts, 0.05);
  const t = leafTStats(residuals);
  const y = new Map([...surface.selected_path_class_ids].map((pc) => [pc, t.get(pc) ?? 0]));
  const audit = await runPipeline({ snapshot: CROSS, q: 0.05, telemetry: { seed, ticks: T, degradations } });
  return {
    greedy: audit.culprits.map((c) => c.resource_id),
    sparse: supportOf(nnLasso(CROSS, y, Math.sqrt(T))),
  };
}

test('CROSS-CHECK: greedy cover and NN-LASSO agree on the cross-kind support (δ=16, 2 seeds)', async () => {
  for (const seed of [1, 2]) {
    const { greedy, sparse } = await bothSolvers([
      { resource_id: 'optic-3', delta: 16, start_tick: 0 },
      { resource_id: 'panel-7', delta: 16, start_tick: 0 },
    ], seed);
    assert.deepEqual(new Set(greedy), new Set(['optic-3', 'panel-7']), `greedy seed=${seed}`);
    assert.deepEqual(new Set(sparse.slice(0, 2)), new Set(['optic-3', 'panel-7']),
      `sparse solver top-2 seed=${seed}: [${sparse.slice(0, 4)}]`);
  }
});

test('CROSS-CHECK: both solvers put the room rank-1 on a broad fault (Δ=3)', async () => {
  const { greedy, sparse } = await bothSolvers([{ resource_id: 'room-0', delta: 3, start_tick: 0 }], 1);
  assert.equal(greedy[0], 'room-0');
  assert.equal(sparse[0], 'room-0', `sparse: [${sparse.slice(0, 4)}]`);
});

test('CROSS-CHECK: clean surface ⇒ both solvers empty', async () => {
  const { greedy, sparse } = await bothSolvers([], 7);
  assert.deepEqual(greedy, []);
  assert.deepEqual(sparse, []);
});
