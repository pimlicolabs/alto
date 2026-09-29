---
"@pimlico/alto": patch
---

Back off the stuck-resubmit interval during chain stalls and cap stuck bundle replacements. New flags: `--resubmit-stuck-backoff-factor` (default 2) multiplies `--resubmit-stuck-timeout` for each prior replacement attempt, and `--max-resubmit-stuck-timeout` (default 120000 ms) caps the backed-off interval. Stuck replacements of a pending bundle now honor `--max-resubmits`: once reached, the bundle is no longer replaced and its userOps are dropped. Gas-price replacements are exempt from the cap.
