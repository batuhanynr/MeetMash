# M5 verification

Set `DATABASE_URL` and `M3_TEST_DATABASE_URL` to a dedicated PostgreSQL test database whose name ends with `_test`. The demo and regressions reset its test tables. Prepare a development CA and demo credentials with `npm run certs` and `npm run secrets`. Run `flutter pub get` under `apps/mobile` before the headless Dart demo.

- `npm run test:gate:m5` checks Node and Dart, runs the M1–M3 regressions on PostgreSQL, and starts one local mixed Node–Dart WSS meeting. No Docker or local inference server is required when PostgreSQL is already available.
- `npm run demo:m5 -- --preview` starts the mixed meeting using a Turkish request validated by the hub's local model and a scripted fixture approval. See [model setup](../../m5-intelligence.md). Run the [device flow](../../../apps/mobile/README.md) to exercise the actual Flutter screens.
- The [local model evaluations](intelligence/README.md) contain calls to the real models on synthetic inputs. A separate [network smoke run](../m4/README.md) exercised a Dart agent under four profiles once each.

The unsigned iOS device build succeeded during development. iOS installation and launch still need a simulator or signed test device. The Android debug build stopped during NDK setup, before APK installation. Two consenting Google test accounts and platform OAuth client configuration are needed for a live calendar run. The mixed network acceptance series and the final live device demo remain open.

## Run the remaining acceptance checks serially

Use a clean checkout and keep the revision checked out until the session finishes. Set up the disposable PostgreSQL databases, Flutter dependencies, development certificates and demo credentials as described above. Make sure Docker is available for the Linux phases and your local Ollama server has the [models installed](../../m5-intelligence.md).

```sh
npm run verify:acceptance -- --session=release-check
```

The runner executes one phase at a time. It runs the software gate, M4 link and round smoke checks, the full Node network matrix, a Linux Dart build for the Docker architecture, the mixed N0/N3/N4 matrix, the two model evaluations and the model preview meeting. Both matrices use one Docker topology, with their existing profile rules and repetition counts. The software and preview phases use the Dart source from the checkout.

Each attempt has its own directory under `.state/evidence/verification/<session>/`. A failed or interrupted attempt stays there with its status and any data already collected. The runner stops at the first failure. Fix the environment and resume on the same clean commit with `npm run verify:acceptance -- --session=release-check --resume`. It reuses a success only if the saved artifacts still match their hashes. A new code revision requires a new session.

Use `--list` for phase names. Repeat `--phase` to run only the named phases in the normal order. Select `dart-linux` before `m5-network` unless the session already has a verified binary. Use `--session=release-check --status` to read saved progress without starting anything. Pending phases and earlier failed attempts stay visible. After a hard kill, remove the `.active` lock only once its recorded process and any test children have stopped.

The automated results cover synthetic calendars and local Linux. Separately, follow the [Air guide](../../../infra/air/README.md) on the assigned four Linux targets. Finish the [platform builds and device setup](../../../apps/mobile/README.md), then record the app opening on both platforms. Run the Google Calendar case on two consenting test accounts and compare the same meeting ID in both calendars. Revoke either grant and check that its client reports the pending write. Attach those manual results with the checked commit. The serial runner leaves all four external checks pending even if every automated phase passes.
