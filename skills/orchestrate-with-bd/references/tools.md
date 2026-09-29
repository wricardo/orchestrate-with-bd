# Ledger tools

| Need | Tool |
|---|---|
| Bind and claim the run epic | `orc_bind` |
| Read the run and obtain the sole dispatchable bead | `orc_status` |
| Claim the assigned bead | `orc_claim` |
| Close or block a bead with evidence | `orc_finish` |
| Release a terminated or explicitly reclaimed holder | `orc_release` |
| Decide a held task | `orc_decide` |

`orc_claim` accepts only `bead` and optional `agent`. It does not accept or return a workspace path or branch. `orc_status` has no pull-worker mode; wait for the active worker to finish before asking for the next bead.
