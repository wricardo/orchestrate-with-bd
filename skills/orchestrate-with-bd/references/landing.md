# Single-checkout delivery

Every run uses the repository checkout inherited by the OMP session. The plugin exposes one ready bead only after every prior descendant is terminal. No worker creates, adopts, records, or removes a Git worktree.

1. The lead binds the epic with `orc_bind { epic }`.
2. The lead calls `orc_status` and dispatches its one ready bead.
3. The worker calls `orc_claim`, implements or reviews in the inherited checkout, runs the bead's checks, and calls `orc_finish` with evidence.
4. The lead waits for the worker to finish before calling `orc_status` again.

Workers may commit and push only when the bead explicitly requires it. A review uses the checkout state and supplied delivery evidence; it must not create a disposable checkout.

If work conflicts with existing uncommitted changes, finish the bead `blocked` with the exact conflict. Do not create a second checkout to bypass it.
