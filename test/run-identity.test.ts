import { describe, expect, test } from "bun:test";
import type { BdBead } from "../src/bd";
import { readRunOwnership, setMetadata } from "../src/types";

describe("run ownership metadata", () => {
	test("reads a valid ownership record without replacing unrelated metadata", () => {
		const bead: BdBead = {
			id: "run-1",
			issue_type: "epic",
			metadata: {
				run: JSON.stringify({ owner: "omp/lead", bound_at: "2026-09-29T00:00:00Z", review_epoch: "review-1", root: "run-1", ci_scoped: false }),
				tier: "deep",
			},
		};

		expect(readRunOwnership(bead)).toEqual({ owner: "omp/lead", bound_at: "2026-09-29T00:00:00Z", review_epoch: "review-1", root: "run-1", ci_scoped: false });
		expect(setMetadata("run", { owner: "omp/next" })).toBe('run={"owner":"omp/next"}');
		expect(bead.metadata).toMatchObject({ tier: "deep" });
	});

	test("rejects metadata without an owner", () => {
		const bead: BdBead = { id: "run-2", issue_type: "epic", metadata: { run: JSON.stringify({ root: "run-2" }) } };
		expect(readRunOwnership(bead)).toBeNull();
	});
});
