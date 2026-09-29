---
name: orchestrate-with-bd
description: Durable Beads-backed serialized orchestration on OMP task dispatch. Use when the user says orchestrate, or when resuming a run recorded in Beads.
---

# Orchestrate with bd

## Trigger

- The prompt says `orchestrate`; the plugin injects the run header.
- To resume, say `orchestrate`, call `orc_bind { epic }` on the owned epic, then call `orc_status {}`.
- Execute one bounded task with no independent slices directly.

## Operating model

Beads records what work exists and its state. All workers use the repository checkout they inherit. The plugin enforces serial dispatch: `orc_status` reports no ready bead while any descendant is in progress, then reports at most one ready bead.

Do not create Git worktrees. Do not use Worktrunk. Do not request task isolation. Never dispatch a second worker before the first has terminally finished.

## Workflow

1. **Bind.** Call `orc_bind { epic: <id> }`. It claims and records the run on the epic. A live foreign holder refuses; an expired holder may transfer only when it is not live. No epic: create one with `bd create --type epic`, or dispatch `orc-planner`.
2. **Plan.** Keep the todo list equal to `orc_status.todo`. Every planned unit has a bead.
3. **Review the DAG.** When `orc_status` reports `DAG review required`, run its exact `bd create` command, then call `orc_status` again.
4. **Dispatch one bead.** Call `orc_status`; copy its sole `ready` bead and agent into one native `task` call. The worker calls `orc_claim` first, works in its inherited checkout, runs the named checks, then calls `orc_finish` with evidence.
5. **Repeat.** Wait for that worker to finish, call `orc_status`, and dispatch the next sole ready bead. Use `orc_release` only with worker-ended, ownership, or explicit force evidence.
6. **Decide and close.** `orc_finish` routes review verdicts. Only the lead calls `orc_decide` for a held task. Close an epic with `orc_finish { state: "done" }` once every descendant is terminal.

## Rules

- MUST treat Beads as the source of truth; `todo` is a view, not a second plan.
- MUST dispatch only the one bead from `orc_status.ready` and wait for its terminal result.
- MUST claim a bead before working it, and finish it through `orc_finish`.
- MUST use the inherited repository checkout; no worktree path or branch is accepted by `orc_claim`.
- MUST keep worker briefs free of the bare lowercase word `orchestrate`.
- MUST let `orc_finish` route verdicts and `orc_decide` move held work. Do not create ad-hoc fix beads.
- MUST treat a live holder's lease as authoritative. Reclaim only with verified worker termination, verified absence, or an explicit user override.
- MUST record delivery evidence when closing work.
- MUST NOT start a nested `omp` process, migrate a store, edit `.beads/`, or pass a database path to a child while orchestrating.
