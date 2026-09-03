/**
 * Smoke test — halt-on-contradiction #1: the deploysignal-engine surfaces we
 * intend to reuse import cleanly as a git-dependency and produce live values.
 *
 * This is NOT a product acceptance test. It exists only to prove, before any
 * design is committed, that the engine's per-shard runtime (Family A betting
 * e-process), hierarchical e-value combination, and e-BH FDR are reachable and
 * behave as documented from a fresh consumer. If this fails to compile or run,
 * the whole "reuse the engine as a git-dep" premise is contradicted and we halt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  freshBettingState,
  updateBettingState,
} from '@johnpatrickwarren-oss/deploysignal-engine/detectors/betting-e-process';
import {
  initialWelfordState,
  updateWelford,
  welfordMean,
} from '@johnpatrickwarren-oss/deploysignal-engine/per-shard/welford';
import {
  combineAverage,
  combineProduct,
} from '@johnpatrickwarren-oss/deploysignal-engine/fleet/combine';
import { eBenjaminiHochberg } from '@johnpatrickwarren-oss/deploysignal-engine/fleet/e-bh';
import { computeSnapshotHash } from '@johnpatrickwarren-oss/deploysignal-engine/topology-overlay';

test('Family A betting e-process: wealth grows under a real mean shift', () => {
  // Baseline N(0,1); feed a shifted stream and confirm the e-value (wealth M)
  // climbs well above 1 — i.e. the detector is live and signal-agnostic.
  const alpha = 0.01;
  let state = freshBettingState();
  let M = 1;
  for (let i = 0; i < 200; i++) {
    M = updateBettingState(state, /*x*/ 2.5, /*baselineMean*/ 0, /*sigma^2*/ 1, alpha);
  }
  assert.ok(M > 1 / alpha, `wealth ${M} should cross the 1/alpha fire threshold`);
});

test('Welford runtime is signal-agnostic: recovers the mean of an arbitrary stream', () => {
  let w = initialWelfordState(2);
  const samples = [
    [10, -3],
    [12, -1],
    [11, -2],
    [13, -4],
  ];
  for (const s of samples) w = updateWelford(w, s);
  const mean = welfordMean(w);
  assert.ok(Math.abs(mean[0] - 11.5) < 1e-9);
  assert.ok(Math.abs(mean[1] - -2.5) < 1e-9);
});

test('Hierarchical combination: product and average are Ville-bounded merges', () => {
  const logEs = [Math.log(50), Math.log(0.5), Math.log(8)];
  // engine v0.6.10-pre (ADR 0028): the product needs an explicit sequential/independence assertion
  assert.throws(() => combineProduct(logEs), /sequential/);
  const prod = combineProduct(logEs, { sequential: true });
  const avg = combineAverage(logEs);
  // Product = sum of logs; average = logSumExp - log(N). Both finite, prod >= avg here.
  assert.ok(Number.isFinite(prod.log_fleet_e));
  assert.ok(Number.isFinite(avg.log_fleet_e));
  assert.ok(prod.log_fleet_e > avg.log_fleet_e);
});

test('e-BH FDR: selects the large-evidence entities under arbitrary dependence', () => {
  // N=5, q=0.05 -> N/q = 100. e-BH rejects top-k where k = max{k : e_(k) >= N/(q*k)}.
  // [300,150,60,1.0,0.2]: k=1:300>=100, k=2:150>=50, k=3:60>=33.3, k=4:1.0>=25 X -> K=3.
  const eValues = [300, 150, 60, 1.0, 0.2];
  const out = eBenjaminiHochberg(eValues, 0.05);
  assert.equal(out.K, 3, 'exactly the three strong entities are selected');
  assert.deepEqual([...out.selected].sort((a, b) => a - b), [0, 1, 2]);
  assert.ok(!out.selected.includes(3) && !out.selected.includes(4));
});

test('computeSnapshotHash is deterministic over a topology snapshot', () => {
  const snap = {
    nodes: [{ id: 'a', service_name: 'a', kind: 'service' as const }],
    edges: [],
    fetched_at_ts: 1000,
    source_id: 's',
    source_version: 'v',
  };
  const h1 = computeSnapshotHash(snap);
  const h2 = computeSnapshotHash(snap);
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
});
