# Roles

All roles operate serially in the inherited repository checkout. The lead owns Beads run binding and dispatch. A worker claims only the bead named in its brief.

| Role | Responsibility |
|---|---|
| `orc-lead` | Bind the run, call status, dispatch one bead, decide held work. |
| `orc-planner` | Create the Beads DAG; do not edit product code. |
| `orc-implementer*` | Claim one task, make the change, run its checks, finish with evidence. |
| `orc-reviewer` | Claim a review bead and evaluate the checkout and stated evidence. |
| `orc-researcher` | Claim one research bead and report findings. |
| `orc-shepherd` | Claim one review-provider coordination bead. |
| `orc-merger` | Perform an explicitly approved landing command when a bead requires it. |

No role creates, switches, or cleans up a Git worktree.
