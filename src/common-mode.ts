/**
 * Contamination-robust common-mode removal (ADR-0036) — CONSUMED from the engine, not rebuilt.
 *
 * A fleet-wide fault (e.g. an extreme optic leaking into every cross-optic leaf, ADR-0034) shifts
 * nearly all leaves together. That shared shift inflates the surface's firing-fraction base rate q₀,
 * which then masks the fault during localization (the ADR-0034 high-δ saturation). The engine's
 * `robustLocation` (Tukey-biweight, redescending — engine ADR-0008/0017 contamination-robust
 * common-mode) estimates the per-tick shared shift WITHOUT being dragged by the concentrated fault
 * leaves; subtracting it returns the diluted leak leaves to ≈ their noise floor while the true
 * fault's own high-weight leaf keeps its differential signal.
 *
 * We consume ONLY the `robustLocation` primitive and compose it on top of Tessera's per-cell
 * standardized residuals (ADR-0036 "compose" decision) — the engine's full `contaminationRobustResiduals`
 * also does per-shard levelling, which would double-count Tessera's per-cell calibration. The engine
 * is never forked (ADR-0001); this is consumption at a declared extension point.
 */
import { robustLocation } from '@johnpatrickwarren-oss/deploysignal-engine/fleet/common-mode';
import type { PathClassId } from './domain';

/**
 * Remove the per-(tick, signal) robust common-mode across leaves from a standardized residual map.
 * Pure: returns a fresh map; the input is untouched. With one leaf the common-mode IS that leaf, so
 * residuals go to 0 — a degenerate single-leaf fabric has no cross-leaf common-mode to speak of.
 */
export function stripCommonMode(residuals: ReadonlyMap<PathClassId, number[][]>): Map<PathClassId, number[][]> {
  const pcs = [...residuals.keys()];
  const out = new Map<PathClassId, number[][]>(pcs.map((pc) => [pc, residuals.get(pc)!.map((row) => [...row])]));
  if (pcs.length === 0) return out;
  const ticks = residuals.get(pcs[0])!.length;
  const nSignals = ticks > 0 ? residuals.get(pcs[0])![0].length : 0;
  for (let t = 0; t < ticks; t++) {
    for (let s = 0; s < nSignals; s++) {
      const column = pcs.map((pc) => residuals.get(pc)![t][s]);
      const commonMode = robustLocation(column);
      for (const pc of pcs) out.get(pc)![t][s] -= commonMode;
    }
  }
  return out;
}
