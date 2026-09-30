WARNING: THIS has been deprecated due to performance issues. 


# orchestrate-with-bd

An OMP plugin that records native `orchestrate` runs in a Beads ledger. OMP schedules agents; the plugin records bead ownership, dependencies, and outcomes.

| | |
| --- | --- |
| Status | Prerelease fork. |
| Requires | OMP 18.1.19 or later, `bd` 1.3.0 or later, and `gh` 2.100 or later for review tools. |
| Contributing | [CONTRIBUTING.md](CONTRIBUTING.md) |

## Required companion plugins

The `beads` and `build` plugins are required. Each publishes a presence marker:

- `Symbol.for("com.srobroek.beads.present.v1")`
- `Symbol.for("com.srobroek.build.present.v1")`

If either marker is missing, the session stops before it dispatches or mutates Beads.

## Single-checkout mode

A run is one Beads epic per feature, with tasks and review beads beneath it. Typing `orchestrate` injects a run header naming the store, bound epic, actor, and lead contract.

Workers share the repository checkout. `orc_status` exposes **at most one** ready bead, and exposes none while another descendant is in progress. Dispatch the returned bead, wait for it to finish, then call `orc_status` again. This serializes mutations without Git worktrees, Worktrunk, or OMP task isolation.

`orc_claim` claims a bead only; it does not require or record a worktree path or branch. Workers use their inherited checkout, run the acceptance checks named on the bead, and finish with evidence.

The beads plugin resolves the session's embedded store and `BEADS_DIR`; orchestrate never overrides it. `bd dolt pull` runs before claiming work, and `bd dolt push` runs after each delivered epic or feature. Closing an epic through `orc_finish` also pushes the store and reports push failures without rolling back the close.

## Install

```sh
omp plugin marketplace add wricardo/orchestrate-with-bd
omp plugin install orchestrate-with-bd@orchestrate-with-bd
```

## Tools

| Tool | Does |
| --- | --- |
| `orc_bind` | Binds and claims the run epic. |
| `orc_status` | Reports descendants, leases, one serially-dispatchable bead, waiting reviews, and decisions. |
| `orc_claim` | Atomically claims a bead for its worker. |
| `orc_finish` | Records evidence and closes, blocks, or reopens a bead. Epic close pushes the embedded store. |
| `orc_release` | Releases a bead with ownership CAS or an explicit forced reason. |
| `orc_decide` | Records the lead's decision on a held task. |
| `orc_bot_review_probe` | Classifies a review-bot round at its exact head. |
| `orc_bot_review_request` | Requests one allowlisted provider review at an exact head. |
| `orc_conflict_probe` | Predicts merge conflicts and reads CI without touching a tree. |
| `orc_review_round_policy` | Decides whether an actionable review round bounces to a fix bead or escalates. |

The plugin provides `orc-lead`, `orc-planner`, `orc-implementer`, `orc-implementer-deep`, `orc-implementer-max`, `orc-reviewer`, `orc-researcher`, `orc-shepherd`, and `orc-merger`. Model roles and tiers are listed in [skills/orchestrate-with-bd/references/roles.md](skills/orchestrate-with-bd/references/roles.md).

The skill [skills/orchestrate-with-bd/SKILL.md](skills/orchestrate-with-bd/SKILL.md) defines the operating procedure. Ledger details are in [skills/orchestrate-with-bd/references/beads-store.md](skills/orchestrate-with-bd/references/beads-store.md).

## License

Apache-2.0
