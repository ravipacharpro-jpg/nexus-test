#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT

mkdir -p "$test_root/bin" "$test_root/prefix/bin" "$test_root/first-install" "$test_root/safe-install" "$test_root/home"
ln -s "$(command -v bash)" "$test_root/prefix/bin/bash"
printf '#!/usr/bin/env bash\nexit 0\n' > "$test_root/bin/grun"
chmod 755 "$test_root/bin/grun"
printf '#!/usr/bin/env bash\nexit 0\n' > "$test_root/bin/pkg"
chmod 755 "$test_root/bin/pkg"
printf '#!/usr/bin/env bash\ntouch "${NEXUS_TEST_BUN_MARKER:?}"\nexit 73\n' > "$test_root/bin/bun"
chmod 755 "$test_root/bin/bun"

first_binary="$test_root/nexus-first"
printf 'test binary\n' > "$first_binary"

PREFIX="$test_root/prefix" \
TERMUX_VERSION=1 \
NEXUS_INSTALL_DIR="$test_root/first-install" \
HOME="$test_root/home" \
PATH="$test_root/bin:$PATH" \
NEXUS_TEST_BUN_MARKER="$test_root/bun-was-executed" \
bash "$repo_root/install.sh" --binary "$first_binary" --no-modify-path >/dev/null

wrapper="$test_root/first-install/nexus"
test -s "$wrapper"
test -s "$test_root/first-install/nexus.bin"
test "$(head -n 1 "$wrapper")" = "#!$test_root/prefix/bin/bash"
grep -F 'SOURCE="$0"' "$wrapper" >/dev/null
grep -F 'GLIBC_PREFIX="${PREFIX:-}/glibc"' "$wrapper" >/dev/null
grep -F 'exec "$LOADER" --library-path "$LIBRARY_PATH" "$SCRIPT_DIR/nexus.bin" "$@"' "$wrapper" >/dev/null
bash -n "$wrapper"
test -d "$test_root/home/.nexus/tools"
test ! -e "$test_root/bun-was-executed"

printf 'working launcher\n' > "$test_root/safe-install/nexus"
printf 'working binary\n' > "$test_root/safe-install/nexus.bin"
failure_binary="$test_root/nexus-failure"
printf 'replacement binary\n' > "$failure_binary"

set +e
TERMUX_VERSION=1 \
PREFIX="" \
NEXUS_INSTALL_DIR="$test_root/safe-install" \
HOME="$test_root/home" \
PATH="$test_root/bin:$PATH" \
bash "$repo_root/install.sh" --binary "$failure_binary" --no-modify-path >/dev/null 2>&1
install_status=$?
set -e

test "$install_status" -ne 0
test "$(cat "$test_root/safe-install/nexus")" = "working launcher"
test "$(cat "$test_root/safe-install/nexus.bin")" = "working binary"

printf 'Termux installer wrapper regression test passed\n'
