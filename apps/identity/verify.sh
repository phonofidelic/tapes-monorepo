#!/usr/bin/env bash
#
# Checks that the live origin serves exactly what is committed in `public`.
#
# Deploys are manual, and this page can ask a person to unlock their person
# key. Drift between this directory and the origin has to be visible rather
# than guessed at. Run it after a deploy, and after any change to the Worker.
#
# Usage: yarn workspace identity verify [origin]

set -u

origin="${1:-https://identity.tapes.network}"
public="$(cd "$(dirname "$0")/public" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
failures=0

fail() {
  printf '  FAIL  %s\n' "$1"
  failures=$((failures + 1))
}

digest() {
  shasum -a 256 <"$1" | cut -d' ' -f1
}

printf 'Checking %s\n\nFiles\n' "$origin"

for file in "$public"/*; do
  name="$(basename "$file")"
  # `_headers` configures the Worker. A served copy is checked for below.
  if [ "$name" = "_headers" ]; then
    continue
  fi
  # The page is served at the root. Its own name answers 307 to there.
  if [ "$name" = "index.html" ]; then
    path="/"
  else
    path="/$name"
  fi
  if ! curl -fsS "$origin$path" -o "$work/$name"; then
    fail "$path could not be fetched"
  elif [ "$(digest "$file")" = "$(digest "$work/$name")" ]; then
    printf '  ok    %s is %s\n' "$path" "$name"
  else
    fail "$path is not the committed $name"
  fi
done

printf '\nHeaders on /\n'

if ! curl -fsSI "$origin/" | tr -d '\r' >"$work/headers"; then
  fail 'the headers could not be read'
fi

# Every header the `/*` block of `_headers` asks for, compared by value. A
# weaker Cross-Origin-Opener-Policy is the one that breaks the handoff
# silently, so the whole block is checked rather than that line alone.
while IFS="	" read -r header want; do
  got="$(grep -i "^$header:" "$work/headers" | head -1)"
  got="${got#*:}"
  got="${got# }"
  if [ -z "$got" ]; then
    fail "$header is missing"
  elif [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$header"
  else
    fail "$header is '$got', not '$want'"
  fi
done < <(awk '
  /^\/\*[[:space:]]*$/ { inblock = 1; next }
  /^\// { inblock = 0 }
  inblock && /:/ {
    sub(/^[[:space:]]+/, "")
    at = index($0, ":")
    value = substr($0, at + 1)
    sub(/^[[:space:]]+/, "", value)
    print substr($0, 1, at - 1) "\t" value
  }
' "$public/_headers")

printf '\nPaths that must not answer with the page\n'

for path in /_headers /wrangler.jsonc /no-such-path; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' "$origin$path")"
  if [ "$code" = "404" ]; then
    printf '  ok    %s is 404\n' "$path"
  else
    fail "$path is $code, not 404"
  fi
done

printf '\n'
if [ "$failures" -eq 0 ]; then
  printf 'The origin matches this directory.\n'
else
  printf '%s check(s) failed. The origin and this directory disagree.\n' "$failures"
fi
exit $((failures > 0))
