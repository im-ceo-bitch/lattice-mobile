#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../package-engine"
rm -rf .runtime-dist
trap 'rm -rf .runtime-dist' EXIT
tsc -p tsconfig.json --noEmit false --outDir .runtime-dist
for file in .runtime-dist/*.js; do ln -sf "$(basename "$file")" "${file%.js}"; done
node --test test/*.runtime.mjs
