# Planning a serial run

Create an epic and bounded child beads. A bead names affected paths or symbols, numbered acceptance criteria, and a role/tier when needed.

`orc_status` is the scheduler: it reports at most one ready bead and withholds all work while a descendant is in progress. Dependencies still determine order, but independent beads are intentionally serialized because they share one checkout.

Use a review bead with dependencies on the work it reviews. `orc_finish` routes its verdict. `fix` and `change` reopen the reviewed task; `escalate` holds it for the lead; only `orc_decide` changes held work.

Pull workers and fan-out dispatch are unavailable in single-checkout mode. The lead dispatches one bead, waits, then reads `orc_status` again.
