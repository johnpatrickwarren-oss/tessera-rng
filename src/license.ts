/**
 * The FDR license rule (ADR-0060) — the ADR-0059 parked decision, ratified and made code.
 *
 * An audit's selection set may be READ AS FDR-CONTROLLED only when (1) the calibration
 * construction is `per_leaf_scale` (the measured N-robust construction — ADR-0059: the fixed
 * ς* gate launders at ≥ paper scale under shared calibration; ADR-0057: real fleets sit far
 * past any fixed threshold under shared calibration) AND (2) the runtime drift monitor read
 * `ok` on the live window (the ADR-0052 cliff's detector; an unmonitored or unresolvable
 * window cannot license). Everything else is Mode A: evidence/ranking, no FDR claim.
 *
 * Pure function over the audit — the license is DATA; nothing is suppressed or acted on here
 * (the ADR-0051 claim-not-alarm rule, inherited).
 */
import type { AuditRecord } from './verdict';

export interface FdrLicense {
  licensed: boolean;
  /** every failing conjunct, named; empty iff licensed. */
  reasons: string[];
}

export function fdrLicense(audit: AuditRecord): FdrLicense {
  const reasons: string[] = [];
  if (audit.calibration_construction !== 'per_leaf_scale') {
    reasons.push(
      'construction: shared calibration cannot license an FDR reading (ADR-0059: the fixed gate is anti-conservative at scale; ADR-0057: real fleets exceed any fixed threshold) — run with perLeafScale',
    );
  }
  if (!audit.drift_monitor) {
    reasons.push('monitoring: no drift monitor on this audit — an unmonitored live window cannot license (ADR-0053)');
  } else if (audit.drift_monitor.status !== 'ok') {
    reasons.push(`monitoring: drift monitor read '${audit.drift_monitor.status}' — the live window does not support the claim`);
  }
  return { licensed: reasons.length === 0, reasons };
}
