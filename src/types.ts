/**
 * The run ownership record this plugin writes on beads.
 *
 * Run identity lives on the epic rather than a checkout-scoped file, so every session
 * resolves the same durable ownership record.
 *
 * Both records are written with `bd update --set-metadata <key>=<json>`, which stores the
 * value as a string rather than a nested object. That is deliberate: `--set-metadata` merges
 * one key and leaves every sibling key alone, where `--metadata` replaces the whole record
 * and would drop a concurrent `held`/`fix_round` write. `metadataRecord` accepts both a JSON
 * string and a real object, so a value written either way reads back the same.
 */

import { type BdBead, metadataRecord } from "./bd";

/** `metadata.run`, on the run epic: the bead that is the run locator. */
export const RUN_KEY = "run";

/**
 * Which run a lead owns, recorded on the run epic by `orc_bind`. `root` is the run's root
 * epic: the epic's own id for a root lead, the inherited root for a sub-lead that bound a
 * child epic, so a sub-lead's epic is never mistaken for a run root.
 */
export interface RunOwnership {
	owner: string;
	bound_at: string;
	/** Opaque generation that makes a DAG review valid only for this acquisition. */
	review_epoch: string;
	root: string;
	/** Whether this repository's CI excludes pull requests into `omp/**` from its PR-only jobs. */
	ci_scoped: boolean;
	/**
	 * The lead this run was taken from, when `orc_bind` transferred it because that lead's claim
	 * had lapsed. A record, not a permission: the transfer was authorized by the expired native
	 * claim, and this is what tells the next reader the run changed hands rather than started.
	 */
	transferred_from?: string;
}

function field(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** `metadata.run`, or `null` when the epic carries no valid ownership record. */
export function readRunOwnership(bead: BdBead): RunOwnership | null {
	const record = metadataRecord(metadataRecord(bead.metadata)?.[RUN_KEY]);
	if (record === undefined) return null;
	const owner = field(record, "owner");
	if (owner === undefined) return null;
	const boundAt = field(record, "bound_at") ?? "";
	const transferred = field(record, "transferred_from");
	return {
		owner,
		bound_at: boundAt,
		review_epoch: field(record, "review_epoch") ?? boundAt,
		root: field(record, "root") ?? bead.id,
		ci_scoped: record.ci_scoped === true,
		...(transferred === undefined ? {} : { transferred_from: transferred }),
	};
}


/** One `--set-metadata` argument: the value is JSON, because bd stores the string verbatim. */
export function setMetadata(key: string, value: unknown): string {
	return `${key}=${JSON.stringify(value)}`;
}
