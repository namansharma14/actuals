# ACCURACY.md

Rendered by `npm run eval` from `eval/runs/accuracy.jsonl`. Never hand-edited. A red
enforced gate blocks main; a waived gate (`enforced = false`) is waiting for its first
real measurement and flips to enforced in the same change that lands it.

| Gate | Target | Latest | n | Status | Enforced | Measured at | Note |
|---|---|---|---|---|---|---|---|
| g1_commit_join_precision · Commit-join precision vs git log truth on synthetic repos | ≥ 0.95 | 1 | 1 | GREEN | yes | 2026-09-06T09:57:34.893Z | 1 of 1 attributed commits correct; recall 1.00 of 1 expected inside sessions |
| g2_cost_vs_first_party · Per-session output tokens vs an independent per-request recount (cost = usage x rates by construction); the first-party /insights session-meta is logged alongside as a finding, it sums per transcript line | ≤ 0.001 | 0 | 29 | GREEN | yes | 2026-09-06T09:57:38.426Z | max relative error on output tokens vs an independent per-request recount across 29 sessions; first-party /insights session-meta equals the per-line sum on 20 of 21 sessions (it overcounts), recorded here as a finding, not a target |
| g3_fate_classification · Fate classification accuracy on synthetic transcripts | ≥ 0.95 | 1 | 18 | GREEN | yes | 2026-09-06T09:57:38.683Z | 18 of 18 runs classified as the generator expected |
| g4_tree_reconstruction · Tree reconstruction (parent, depth, peak) exact on synthetic trees | ≥ 1 | 1 | 74 | GREEN | yes | 2026-09-06T09:57:38.934Z | 74 of 74 tree facts exact (parent, depth, peak, max depth) |
| g5_fuzz_no_crash · Malformed-line corpus: zero crashes | ≤ 0 | 0 | 3 | GREEN | yes | 2026-09-06T09:57:39.680Z | seed 1: 19 sessions, 2 malformed lines tolerated; seed 2: 19 sessions, 2 malformed lines tolerated; seed 3: 19 sessions, 2 malformed lines tolerated |
| g6_no_network · No sockets except loopback: zero non-loopback connection attempts during run and the local app on 127.0.0.1 (redefined with D13, 2026-09-03) | ≤ 0 | 0 | 1 | GREEN | yes | 2026-09-06T09:57:39.775Z | pipeline and the local app ran with net.Socket.connect limited to loopback and dns.lookup blocked; 3 requests served over 127.0.0.1 (1 loopback connections, bound to 127.0.0.1), 0 elsewhere; not patched: dgram, dns.Resolver, child processes |
| g7_schema_drift · Fixtures pinned per tool version; unseen version warns, never parses silently | ≥ 1 | 1 | 2 | GREEN | yes | 2026-09-06T09:57:39.797Z | unseen version warns: true; pinned version silent: true |
| g8_claim_verdicts · D16 claim verdicts (report_delivered, session_outcome) vs the blind generator's expectations, matched by owner+kind+subject | ≥ 0.95 | 1 | 7 | GREEN | yes | 2026-09-06T09:57:40.061Z | 7 of 7 claim verdicts as the generator expected |
