/**
 * Operator-supplied topology loader (ADR-0005). Reads + parses an incidence JSON file and hands
 * the parsed object to the pure `validateFaultDomainSnapshot` validator in src/. Filesystem access
 * lives here in tools/ — never in src/ (anti-scope N2: product source ingests no live data).
 *
 * CLI: `node tools/load-topology.js <incidence.json>` validates the file and prints a summary +
 * the deterministic snapshot hash.
 */
import { readFileSync } from 'node:fs';
import { validateFaultDomainSnapshot, computeFaultDomainHash } from '../src/fault-domain-source';
import type { FaultDomainSnapshot } from '../src/domain';

export function loadIncidenceFile(path: string): FaultDomainSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`could not read/parse incidence file '${path}': ${(e as Error).message}`);
  }
  return validateFaultDomainSnapshot(parsed);
}

function main(): void {
  const path = process.argv[2];
  if (!path) {
    // eslint-disable-next-line no-console
    console.error('usage: node tools/load-topology.js <incidence.json>');
    process.exit(64);
  }
  const snap = loadIncidenceFile(path);
  // eslint-disable-next-line no-console
  console.log(
    `loaded ${snap.path_classes.length} path-classes, ${snap.resources.length} resources, ` +
      `${snap.edges.length} incidence edges; hash=${computeFaultDomainHash(snap).slice(0, 16)}…`,
  );
}

if (require.main === module) main();
