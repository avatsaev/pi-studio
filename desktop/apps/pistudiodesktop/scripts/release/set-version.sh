#!/usr/bin/env bash
# Writes a version into `[workspace.package] version` of desktop/Cargo.toml on a runner (the installers
# are named after the Cargo version; nothing is committed back):
#
#   set-version.sh <major.minor.patch> [Cargo.toml]
#
# `tauri build` is not `--locked`, so Cargo updates its copy of Cargo.lock to match.
set -euo pipefail

version=${1:?usage: set-version.sh <major.minor.patch> [Cargo.toml]}
manifest=${2:-"$(dirname "$0")/../../../../Cargo.toml"}
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "version '$version' is not MAJOR.MINOR.PATCH" >&2; exit 1; }

# `-i.bak`: BSD sed (macOS) needs a suffix argument, GNU sed accepts this form too.
sed -i.bak '/^\[workspace\.package\]/,/^\[/s/^version = ".*"/version = "'"$version"'"/' "$manifest"
rm "$manifest.bak"
grep -q "^version = \"$version\"" "$manifest"
