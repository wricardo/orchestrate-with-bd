# Beads store

The `beads` companion plugin resolves the current repository's Beads store. `orchestrate-with-bd` does not set `BEADS_DIR`, `BEADS_DB`, or `BD_DB`.

All workers operate in one checkout, so they resolve the same store without a linked-worktree redirect. If an inherited `BEADS_DIR` points at another repository, ledger calls stop rather than falling back to a second store.

The run is recorded on the bound epic's `metadata.run`; no checkout-local run file is used.
