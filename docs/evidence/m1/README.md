# M1 evidence

Tested code: `a982afe3b930d64b1ccfb436b81f5dd67a32646a` (local tag `m1-demo`).
The implementation worktree was clean during the positive gate and demo runs.
This evidence-only commit does not change the tested runtime source.

- `summary.json`: 10/10 real-network scenarios, versions, run ID, test data, and retry settings.
- `checks.json`: TypeScript check, JavaScript build, and the complete Node test command all exited 0. The final Node runner reported 37/37 tests.
- `events.jsonl`: one sample per scenario/agent/event/type/outcome combination; synthetic identifiers, no payloads or credentials. The common run ID joins the samples to the gate report.
- `demo-summary.json`: the exact `npm run demo:m1` command also passed all ten scenarios from the same clean code commit.
- `negative-control.json`: the expected 100 effects were temporarily changed to 101; `npm run test:gate:m1` exited 1. The source was restored before the positive run.
- `setup-and-mobile.json`: init/cache restore commands, successful Flutter analysis and widget test, and the observed mobile build prerequisites.

Reproduce from the repository root:

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund
npm run test:gate:m1
npm run demo:m1
npm run check:mobile
```

Fresh-machine dependency restores can omit `--offline` if the caches are empty.
New runs write `.state/evidence/` and preserve this archived snapshot.
The second-team-member demo, branch review/merge, hosted CI execution, and Android/iOS binary builds are not claimed here.
