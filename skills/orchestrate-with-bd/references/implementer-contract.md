# Implementer contract

1. Call `orc_claim { bead, agent }`. On `claimed: false`, stop and report the holder.
2. Work only on the assigned bead in the checkout inherited by the task agent. Do not create a Git worktree or request task isolation.
3. Implement the stated acceptance criteria and run its checks.
4. Call `orc_finish` with a concise reason and evidence. Use `blocked` when an external prerequisite or checkout conflict prevents completion.

A retry or review finding is another serial pass over the same inherited checkout. A tier upgrade creates a successor bead with the recorded findings; it does not create a new workspace.
