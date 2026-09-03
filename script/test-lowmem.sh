#!/usr/bin/env bash
# Sequential test runner for low-memory devices (Termux/aarch64).
# One `bun test` process per focused test directory, waited to completion
# before the next starts, so peak RSS stays near a single-package baseline.
set -u

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

lowmem="${NEXUS_LOW_MEMORY:-}"
if [[ -z "$lowmem" && -n "${TERMUX_VERSION:-}" && "${NEXUS_FULL_TESTS:-}" != "1" ]]; then
	lowmem=1
fi

# Env allowlist: a variable is exported only if listed here after being
# verified against `bun test --help` / Bun docs. BUN_TEST_QUIET does not
# exist upstream (checked against bun 1.4), so it is intentionally absent.
allowed_bun_test_env=()

extra_flags=()
if [[ "$lowmem" == "1" ]]; then
	extra_flags+=(--max-concurrency=1 --only-failures)
	for var in "${allowed_bun_test_env[@]}"; do
		export "$var"
	done
fi

# "name|paths" — each path gets its own `bun test` invocation inside the package.
targets=(
	"assistant|test"
	"client|test"
	"codemode|test"
	"core|test"
	"effect-drizzle-sqlite|test"
	"enterprise|test"
	"http-recorder|test"
	"httpapi-codegen|test"
	"llm|test"
	"nexus|test"
	"protocol|test"
	"schema|test"
	"sdk-next|test"
	"tui|test"
	# app has no test/ dir; test-browser needs a real browser, so only the
	# pure-TS palette unit test is targeted here.
	"app|src/components/palette-api-key-providers.test.ts"
)

declare -A known
for target in "${targets[@]}"; do
	known["${target%%|*}"]=1
done

selected=()
bad_args=0
for arg in "$@"; do
	if [[ -z "${known["$arg"]:-}" ]]; then
		echo "error: unknown package '$arg'" >&2
		bad_args=1
	else
		selected+=("$arg")
	fi
done
(( bad_args == 0 )) || exit 2

if (( ${#selected[@]} == 0 )) && [[ "${NEXUS_FULL_TESTS:-}" != "1" ]]; then
	echo "nothing ran: pass package names (e.g. bash script/test-lowmem.sh core)" >&2
	echo "or set NEXUS_FULL_TESTS=1 for the whole matrix; full runs are opt-in" >&2
	exit 0
fi

results=()
failed=0
ran=0
for target in "${targets[@]}"; do
	name="${target%%|*}"
	paths="${target#*|}"
	if (( ${#selected[@]} > 0 )); then
		match=0
		for s in "${selected[@]}"; do
			[[ "$s" == "$name" ]] && match=1
		done
		(( match == 1 )) || continue
	fi
	dir="packages/$name"
	if [[ ! -d "$dir/node_modules" ]]; then
		results+=("SKIP  $name (node_modules absent)")
		continue
	fi
	status=0
	for p in $paths; do
		echo "==> $name: bun test ${extra_flags[*]} $p"
		( cd "$dir" && bun test "${extra_flags[@]}" "$p" ) || status=1
	done
	ran=$((ran + 1))
	if (( status == 0 )); then
		results+=("PASS  $name")
	else
		results+=("FAIL  $name")
		failed=1
	fi
done

echo
echo "== summary ($ran ran) =="
printf '%s\n' "${results[@]}"
exit "$failed"
