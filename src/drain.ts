/**
 * Route-drain actuation hook (v1 spec AC-6; MUST-NEVER N4: simulated only).
 *
 * Maps Tessera's topology-aware freeze-hook to a drain: on a localized culprit, drain the
 * path-classes that traverse that resource. v1 SIMULATES the drain — it returns the action
 * it WOULD take and mutates only the returned record. There is no routing-controller
 * dependency and no real data-plane call.
 */
import type { FaultDomainSnapshot, PathClassId, ResourceId } from './domain';
import type { Culprit, DrainAction } from './verdict';

function pathClassesTraversing(snapshot: FaultDomainSnapshot, resourceId: ResourceId): PathClassId[] {
  const out: PathClassId[] = [];
  for (const e of snapshot.edges) if (e.resource === resourceId) out.push(e.path_class);
  return [...new Set(out)].sort();
}

/** Simulate draining traffic off all path-classes traversing the culprit resource. */
export function simulateDrain(snapshot: FaultDomainSnapshot, culprit: Culprit): DrainAction {
  return {
    resource_id: culprit.resource_id,
    drained_path_class_ids: pathClassesTraversing(snapshot, culprit.resource_id),
    simulated: true,
  };
}
