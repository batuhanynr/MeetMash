# Local network measurements

The full Node benchmark was stopped after 90 completed samples of the 126 planned. Each raw row in `interrupted/runs.jsonl` belongs to commit `5efdee26bd81e76517592b192a0a467f4ef41554`. The operator stopped the run because four concurrent topologies put too much load on the host. Failures are included in the totals.

| Profile | Passed / recorded | Planned | Result |
| --- | ---: | ---: | --- |
| N0 | 20/20 | 20 | Pass |
| N1 | 17/20 | 20 | Fail |
| N2 | 12/20 | 20 | Fail |
| N3 | 20/20 | 20 | Pass |
| N4 request loss | 10/10 | 10 | Pass |
| N4 ACK loss | 0/0 | 10 | Incomplete |
| N5 | 0/0 | 10 | Incomplete |
| N6 | 0/0 | 3 | Incomplete |
| N7 hub restart | 0/0 | 5 | Incomplete |
| N7 coordinator restart | 0/0 | 5 | Incomplete |
| N8 | 0/0 | 3 | Incomplete |

The saved N1 and N2 failures include command and agent startup timeouts. Each worker shared CPU with the other workloads. The effects of host contention and injected network impairments cannot be separated from these samples.

`node-smoke/` contains nine earlier single-sample checks. `dart-smoke/` contains four single-sample checks with a Dart process for C. These directories retain their own configuration, source revision, working-tree state, image ID and raw rows. The mixed suite still requires its full 60-sample run. `data-link.json` records a local Linux data-path interruption, the observation over the management path, and restoration. NVIDIA Air verification remains open.

To derive a CSV and profile summary without starting Docker, run `node scripts/m4/report.mjs docs/evidence/m4/interrupted` (or pass either smoke directory).
