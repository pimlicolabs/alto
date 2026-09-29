---
"@pimlico/alto": patch
---

Pause stuck-bundle replacements during an inclusion stall, when blocks keep arriving but none of the pending bundles land. Detection uses the bundle statuses already fetched each block, so it adds no RPC calls. Gas-price replacements still go through. New flags: `--inclusion-stall-blocks` (default 5, 0 disables) and `--inclusion-stall-min-duration` (default 15000 ms) set how many blocks and how long without inclusions before the chain counts as stalled, and `--inclusion-stall-max-pause` (default 60000 ms) still replaces a stuck bundle that has gone that long without a replacement, so a dropped transaction is eventually rebroadcast. New metrics: `alto_inclusion_stalled` (0/1) and `alto_stuck_replacements_skipped_total`.
