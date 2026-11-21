#!/bin/sh
# The headless core only needs Dart. Keep Flutter platform build hooks out of cross compilation.
set -eu
root=$(git rev-parse --show-toplevel)
target=${1:-linux}
arch=${2:-arm64}
out=${3:-"$root/.state/mobile-test/meetmesh-dart-agent"}
mkdir -p "$(dirname "$out")"
tmp=$(mktemp -d)
cp -R "$root/apps/mobile/bin" "$root/apps/mobile/lib" "$tmp/"
cat > "$tmp/pubspec.yaml" <<'YAML'
name: meetmesh
environment:
  sdk: ^3.10.7
dependencies:
  crypto: 3.0.8
  http: 1.6.0
  json_schema: 5.2.2
YAML
cd "$tmp"
dart pub get --offline || dart pub get
dart compile exe --target-os="$target" --target-arch="$arch" -o "$out" bin/agent.dart
