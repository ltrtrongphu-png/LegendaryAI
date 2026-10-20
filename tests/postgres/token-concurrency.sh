#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGDATABASE:=legendaryai_test}"
: "${PGUSER:=postgres}"
: "${PGPASSWORD:=postgres}"
export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD

user_id="00000000-0000-4000-8000-000000000001"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

reserve() {
  psql -X -qAt -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.consume_tokens(700, '$user_id', false);" > "$1"
}

reserve "$tmp/a" &
pid_a=$!
reserve "$tmp/b" &
pid_b=$!
wait "$pid_a"
wait "$pid_b"

cat "$tmp/a" "$tmp/b" | tr -d '\r' | sort > "$tmp/sorted"
printf 'f\nt\n' > "$tmp/expected"
if ! diff -u "$tmp/expected" "$tmp/sorted"; then
  echo "token concurrency check failed: expected exactly one reservation to succeed" >&2
  echo "results: $(cat "$tmp/a"), $(cat "$tmp/b")" >&2
  exit 1
fi

psql -X -qAt -v ON_ERROR_STOP=1 -c "RESET ROLE; DO \$\$ BEGIN IF (SELECT tokens_used FROM public.profiles WHERE id='$user_id') <> 700 THEN RAISE EXCEPTION 'CONCURRENCY: tokens_used should be exactly 700'; END IF; END \$\$;"
echo "postgres-concurrency: exactly one 700-token reservation succeeded"
