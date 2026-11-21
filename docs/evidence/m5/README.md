# M5 verification

Set `DATABASE_URL` and `M3_TEST_DATABASE_URL` to a dedicated PostgreSQL test database whose name ends with `_test`. The demo and regressions reset its test tables. Prepare a development CA and demo credentials with `npm run certs` and `npm run secrets`. Run `flutter pub get` under `apps/mobile` before the headless Dart demo.

- `npm run test:gate:m5` checks Node and Dart, runs the M1–M3 regressions on PostgreSQL, and starts one local mixed Node–Dart WSS meeting. No Docker or local inference server is required when PostgreSQL is already available.
- `npm run demo:m5 -- --preview` starts the mixed meeting using a Turkish request validated by the hub's local model and a scripted fixture approval. See [model setup](../../m5-intelligence.md). Run the [device flow](../../../apps/mobile/README.md) to exercise the actual Flutter screens.
- The [local model evaluations](intelligence/README.md) contain calls to the real models on synthetic inputs. A separate [network smoke run](../m4/README.md) exercised a Dart agent under four profiles once each.

The unsigned iOS device build succeeded during development. iOS installation and launch still need a simulator or signed test device. The Android debug build stopped during NDK setup, before APK installation. Two consenting Google test accounts and platform OAuth client configuration are needed for a live calendar run. The mixed network acceptance series and the final live device demo remain open.
