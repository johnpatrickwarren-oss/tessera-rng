/**
 * Telemetry signal contract (v1 spec §3.2, Q2-ratified five-signal vector).
 *
 * Separated from the topology/incidence data model (domain.ts): a path-class's *signals*
 * (what the fabric exports per tick) and the *fault-domain incidence* (what it physically
 * traverses) are distinct concerns with distinct consumers — detectors read signals,
 * the tomography reads incidence.
 */

export const SIGNALS = [
  'p99_latency',
  'retransmit_rate',
  'loss_rate',
  'ecmp_imbalance',
  'path_completion',
] as const;
export type SignalName = (typeof SIGNALS)[number];
export type SignalVector = readonly number[]; // length === SIGNALS.length

export function signalIndex(name: SignalName): number {
  return SIGNALS.indexOf(name);
}
