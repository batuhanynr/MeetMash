# MeetMesh

Flutter and Node.js monorepo for the CSE476 personal-agent project.
The implementation scope is defined in [the milestone plan](MeetMesh_Implementation_Plan_and_Issues.md).

```text
apps/hub          Local relay (Node.js + TypeScript)
apps/agent-node   Independent reference agent (Node.js + SQLite)
apps/mobile       Flutter application (Android + iOS)
packages/protocol Portable message schemas, fixtures, and validator
scripts           Local orchestration and environment checks
tests             Protocol and real-network integration tests
docs/decisions    Architecture decisions
docs/evidence     Small reproducible validation records
```

Requirements: Node.js 26, npm 11, Flutter 3.38.7 / Dart 3.10.7.
Use the installed SDKs; do not upgrade them to run M1.

```sh
npm ci --offline --ignore-scripts
cd apps/mobile
flutter pub get --offline
cd ../..
npm run check
npm run build
npm run doctor
```

If a fresh machine has no package cache, omit `--offline` for the dependency restore.
See [runtime and routing](docs/decisions/001-runtime-and-routing.md) for SOLID boundaries and the relay adaptation.
