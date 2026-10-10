#!/usr/bin/env bash
# Vendor pinned Elm 0.19.1 packages from GitHub into ELM_HOME.
# The Elm package registry (package.elm-lang.org) is unreachable from some
# networks; all elm/* sources also live on GitHub, so we clone the exact
# pinned tags into the compiler's package cache layout.
#
# Usage: ELM_HOME=/tmp/elmhome ./tools/vendor-elm-packages.sh
# (Defaults ELM_HOME to ~/.elm when unset.)
set -euo pipefail

ELM_HOME_DIR="${ELM_HOME:-$HOME/.elm}"
# Elm 0.19.1 reads its package cache from $ELM_HOME/0.19.1/packages.
CACHE="$ELM_HOME_DIR/0.19.1/packages"
mkdir -p "$CACHE"
WORK="$(mktemp -d)"

fetch() {
  author="$1"; name="$2"; version="$3"
  dest="$CACHE/$author/$name/$version"
  if [ -d "$dest" ]; then
    echo "cached: $author/$name@$version"
    return
  fi
  echo "fetch: $author/$name@$version"
  rm -rf "$WORK/$name"
  git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$version" \
    "https://github.com/$author/$name.git" "$WORK/$name"
  mkdir -p "$dest"
  cp -r "$WORK/$name/src" "$WORK/$name/elm.json" "$WORK/$name/README.md" "$dest/" 2>/dev/null || \
    cp -r "$WORK/$name/src" "$WORK/$name/elm.json" "$dest/"
}

# Pinned by elm/elm.json (direct + indirect).
fetch elm browser 1.0.2
fetch elm core 1.0.5
fetch elm html 1.0.0
fetch elm json 1.1.3
fetch elm regex 1.0.0
fetch elm url 1.0.0
fetch elm time 1.0.0
fetch elm virtual-dom 1.0.3
# Test-only closure (elm-explorations/test 2.2.0 needs elm/random).
fetch elm random 1.0.0
fetch elm-explorations test 2.2.0
# Flow-test closure: avh4/elm-program-test 4.0.1 and its transitive deps
# (pinned by elm/elm.json test-dependencies).
fetch elm bytes 1.0.8
fetch elm file 1.0.5
fetch elm http 2.0.0
fetch elm parser 1.1.0
fetch avh4 elm-fifo 1.0.4
fetch elm-community list-extra 8.7.0
fetch hecrj html-parser 2.4.0
fetch mgold elm-nonempty-list 4.2.0
fetch rtfeldman elm-hex 1.0.0
fetch avh4 elm-program-test 4.0.1

rm -rf "$WORK"
echo "ELM_HOME package cache ready at $CACHE"
