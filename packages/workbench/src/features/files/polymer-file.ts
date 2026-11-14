/**
 * Name derivation for a polymer built inside the molecule viewer (`@molviewer/core`'s
 * `onPolymerBuild`, 0.4.4+).
 *
 * Naming the file is deliberately the HOST's job. `PolymerBuildEvent` reports the monomer's name
 * and the build settings but never a target, because only the host can see the directory and so
 * only the host knows which names are already taken.
 *
 * Kept pure and separate from `MoleculeViewer.tsx` so it is testable under the root vitest runner,
 * which discovers `.test.ts` under a node environment only — same split as its siblings
 * `molecule-source.ts` and `molecule-reload.ts`.
 *
 * Building does not change what is on screen, so pressing Build repeatedly is normal and every
 * press must produce its own file. `polymerFileName` is therefore an ATTEMPT-indexed sequence,
 * walked by the caller against the create-exclusive `file_create_request` until one lands — the
 * filesystem arbitrates the collision, not a directory listing that could be stale.
 */

/** Polymers always leave molviewer as MOL2: the builder CONSTRUCTS the junction bonds and marks
 *  them authoritative, so a format that cannot carry a bond list would lose them outright. */
const POLYMER_EXTENSION = "mol2";

/**
 * Candidate file name for attempt `attempt` (0-based) of a build off the monomer at `sourcePath`.
 *
 * Attempt 0 is `<monomer-stem>_polymer_<monomers>.mol2`; every later attempt appends its own
 * ordinal — `_2`, `_3`, … — so the trailing number reads as "the Nth file with these settings"
 * and the first one needs no suffix at all.
 *
 * `monomers` is the chain length in monomer units (`PolymerBuildEvent.monomers`), not the physical
 * length in Å that `report` carries.
 */
export function polymerFileName(args: {
  sourcePath: string;
  monomers: number;
  attempt: number;
}): string {
  const { sourcePath, monomers, attempt } = args;
  const suffix = attempt > 0 ? `_${attempt + 1}` : "";
  return `${polymerStem(sourcePath)}_polymer_${monomers}${suffix}.${POLYMER_EXTENSION}`;
}

/**
 * Base name of the monomer with its directory and extension stripped.
 *
 * Taken from the tab's own absolute path rather than `PolymerBuildEvent.sourceFileName` for the
 * same reason the save path ignores `SaveEvent.fileName`: the event carries molviewer's load-time
 * basename, while the path prop is the authoritative location the tab was opened from. It also
 * makes the event's `sourceFileName: null` case (a monomer drawn in the viewer) unreachable here —
 * that tab has no path, so it never gets a build handler in the first place.
 *
 * Falls back to `polymer` for a name that is entirely extension (`.pdb`), which would otherwise
 * produce a leading-underscore stem.
 */
function polymerStem(sourcePath: string): string {
  const base = sourcePath.split("/").pop() ?? "";
  return base.replace(/\.[^.]+$/, "").trim() || "polymer";
}
