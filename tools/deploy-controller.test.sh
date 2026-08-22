#!/usr/bin/env bash
# Safe unit/integration tests for deploy.sh path validation, allowlist safety,
# dry-run non-mutation, SPA fingerprints, snapshot-before-mutation, automatic
# rollback with proven restore, dirty version stamping, and no root overlay.
# Does not touch production /home/kain/onyx/out.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY="${ROOT}/deploy.sh"
PASS=0
FAIL=0
PROD_OUT="/home/kain/onyx/out"

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [[ "${expected}" == "${actual}" ]]; then
    echo "  PASS ${label}"
    PASS=$((PASS + 1))
  else
    echo "  FAIL ${label}"
    echo "       expected: ${expected}"
    echo "       actual:   ${actual}"
    FAIL=$((FAIL + 1))
  fi
}

assert_ok() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "  PASS ${label}"
    PASS=$((PASS + 1))
  else
    echo "  FAIL ${label} (expected success)"
    FAIL=$((FAIL + 1))
  fi
}

assert_fail() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "  FAIL ${label} (expected failure)"
    FAIL=$((FAIL + 1))
  else
    echo "  PASS ${label}"
    PASS=$((PASS + 1))
  fi
}

assert_contains() {
  local label="$1" needle="$2" haystack="$3"
  if [[ "${haystack}" == *"${needle}"* ]]; then
    echo "  PASS ${label}"
    PASS=$((PASS + 1))
  else
    echo "  FAIL ${label}"
    echo "       missing: ${needle}"
    echo "       in:      ${haystack}"
    FAIL=$((FAIL + 1))
  fi
}

# Capture whether PROD_OUT mtime/inode changed during the suite.
prod_marker_before=""
if [[ -d "${PROD_OUT}" ]]; then
  prod_marker_before="$(find "${PROD_OUT}" -printf '%T@ %i %p\n' 2>/dev/null | sha256sum | awk '{print $1}')"
else
  prod_marker_before="ABSENT"
fi

echo "== deploy-controller tests =="

# Source helpers without running main
# shellcheck disable=SC1090
source "${DEPLOY}"

echo "-- path validation"
assert_ok "accepts checkout-local out" \
  validate_live_out "${ROOT}/out" "${ROOT}"
assert_ok "accepts absolute production-like out" \
  validate_live_out "/home/kain/onyx/out" "${ROOT}"
assert_fail "rejects relative path after normalize of empty" \
  validate_live_out "" "${ROOT}"
assert_fail "rejects filesystem root" \
  validate_live_out "/" "${ROOT}"
assert_fail "rejects basename not out" \
  validate_live_out "/tmp/onyx-live" "${ROOT}"
assert_fail "rejects checkout root" \
  validate_live_out "${ROOT}" "${ROOT}"
assert_fail "rejects checkout dist" \
  validate_live_out "${ROOT}/dist" "${ROOT}"
assert_fail "rejects path basename dist" \
  validate_live_out "/tmp/dist" "${ROOT}"

# CLI validate entry
assert_ok "CLI accepts abs out" \
  bash "${DEPLOY}" --validate-live-out "/tmp/onyx-controller-test/out"
assert_fail "CLI rejects non-out basename" \
  bash "${DEPLOY}" --validate-live-out "/tmp/onyx-controller-test/www"

echo "-- explicit ONYX_LIVE_OUT: relative reject before normalize"
assert_fail "CLI rejects raw relative out" \
  bash "${DEPLOY}" --validate-live-out "out"
assert_fail "CLI rejects raw relative ./out" \
  bash "${DEPLOY}" --validate-live-out "./out"
assert_fail "CLI rejects raw relative nested out" \
  bash "${DEPLOY}" --validate-live-out "tmp/foo/out"

# resolve_live_out with explicit relative via env
(
  export ONYX_LIVE_OUT="relative/out"
  if resolve_live_out "${ROOT}" >/dev/null 2>&1; then
    exit 0
  else
    exit 1
  fi
) && { echo "  FAIL resolve rejects relative when ONYX_LIVE_OUT set"; FAIL=$((FAIL + 1)); } \
  || { echo "  PASS resolve rejects relative when ONYX_LIVE_OUT set"; PASS=$((PASS + 1)); }

(
  unset ONYX_LIVE_OUT
  resolved="$(resolve_live_out "${ROOT}")"
  expected="$(normalize_abs_path "${ROOT}/out")"
  [[ "${resolved}" == "${expected}" ]]
) && { echo "  PASS resolve default is checkout-local out"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL resolve default is checkout-local out"; FAIL=$((FAIL + 1)); }

(
  export ONYX_LIVE_OUT="/tmp/onyx-explicit-live/out"
  resolved="$(resolve_live_out "${ROOT}")"
  [[ "${resolved}" == "/tmp/onyx-explicit-live/out" ]]
) && { echo "  PASS resolve accepts explicit absolute out"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL resolve accepts explicit absolute out"; FAIL=$((FAIL + 1)); }

(
  export ONYX_LIVE_OUT=""
  if resolve_live_out "${ROOT}" >/dev/null 2>&1; then
    exit 0
  else
    exit 1
  fi
) && { echo "  FAIL resolve rejects empty ONYX_LIVE_OUT"; FAIL=$((FAIL + 1)); } \
  || { echo "  PASS resolve rejects empty ONYX_LIVE_OUT"; PASS=$((PASS + 1)); }

echo "-- symlink live target reject"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/onyx-deploy-test.XXXXXX")"
cleanup() { rm -rf "${TMP}"; }
trap cleanup EXIT

mkdir -p "${TMP}/real-out-target"
ln -s "${TMP}/real-out-target" "${TMP}/out"
assert_fail "validate rejects live out that is a symlink" \
  validate_live_out "${TMP}/out" "${ROOT}"
# Broken symlink
ln -s "${TMP}/does-not-exist" "${TMP}/broken/out" 2>/dev/null || {
  mkdir -p "${TMP}/broken"
  ln -s "${TMP}/does-not-exist" "${TMP}/broken/out"
}
assert_fail "validate rejects broken symlink live out" \
  validate_live_out "${TMP}/broken/out" "${ROOT}"

echo "-- DEPLOY_DRY_RUN exactly 0 or 1"
assert_ok "dry-run 0 ok" validate_dry_run 0
assert_ok "dry-run 1 ok" validate_dry_run 1
assert_fail "dry-run empty fails" validate_dry_run ""
assert_fail "dry-run true fails" validate_dry_run true
assert_fail "dry-run 2 fails" validate_dry_run 2
assert_fail "dry-run yes fails" validate_dry_run yes

echo "-- version / dirty"
clean_ver="$(compose_version "20260101-000000" "abc1234" 0)"
dirty_ver="$(compose_version "20260101-000000" "abc1234" 1)"
assert_eq "clean version shape" "20260101-000000-abc1234" "${clean_ver}"
assert_eq "dirty version suffix" "20260101-000000-abc1234-dirty" "${dirty_ver}"

printed="$(bash "${DEPLOY}" --print-version)"
if [[ -n "$(git -C "${ROOT}" status --porcelain 2>/dev/null)" ]]; then
  case "${printed}" in
    *-dirty) echo "  PASS print-version dirty on dirty tree (${printed})"; PASS=$((PASS + 1)) ;;
    *) echo "  FAIL print-version expected -dirty on dirty tree (got ${printed})"; FAIL=$((FAIL + 1)) ;;
  esac
else
  case "${printed}" in
    *-dirty) echo "  FAIL print-version unexpected -dirty on clean tree (${printed})"; FAIL=$((FAIL + 1)) ;;
    *) echo "  PASS print-version clean tree (${printed})"; PASS=$((PASS + 1)) ;;
  esac
fi

echo "-- allowlist vs SPA blocklist"
assert_ok "allowlist does not collide with SPA-owned names" \
  assert_no_spa_owned_in_landing_dist "/nonexistent"

# Synthetic legacy staging: no root overlay
echo "-- stage_legacy_entry no root overlay"
mkdir -p "${TMP}/landing/dist/why" "${TMP}/staged/app"
echo "legacy-root" >"${TMP}/landing/dist/index.html"
echo "guide" >"${TMP}/landing/dist/why/x.html"
echo 'html data-theme="ocean"' >"${TMP}/staged/index.html"
echo "spa-robots" >"${TMP}/staged/robots.txt"
echo "landing-robots" >"${TMP}/landing/dist/robots.txt"
echo "spa-app" >"${TMP}/staged/app/index.html"
echo '<meta name="robots" content="noindex, nofollow" />' >"${TMP}/staged/404.html"
echo "const CACHE_NAME = 'onyx-shell-vtest';" >"${TMP}/staged/sw.js"

stage_legacy_entry "${TMP}/landing/dist" "${TMP}/staged" "why"
assert_eq "why staged" "guide" "$(cat "${TMP}/staged/why/x.html")"
assert_eq "index not replaced by missing allowlist copy" "html data-theme=\"ocean\"" "$(cat "${TMP}/staged/index.html")"

# Symlink refuse
ln -s /etc/passwd "${TMP}/landing/dist/evil-link" 2>/dev/null || ln -s why "${TMP}/landing/dist/evil-link"
if stage_legacy_entry "${TMP}/landing/dist" "${TMP}/staged" "evil-link" 2>/dev/null; then
  echo "  FAIL symlink entry should fail"
  FAIL=$((FAIL + 1))
else
  echo "  PASS refuses symlink legacy entry"
  PASS=$((PASS + 1))
fi

# Nested symlink inside allowlisted dir
mkdir -p "${TMP}/landing/dist/memory"
ln -s /tmp "${TMP}/landing/dist/memory/escape"
if stage_legacy_entry "${TMP}/landing/dist" "${TMP}/staged" "memory" 2>/dev/null; then
  echo "  FAIL nested symlink dir should fail"
  FAIL=$((FAIL + 1))
else
  echo "  PASS refuses nested symlink in legacy dir"
  PASS=$((PASS + 1))
fi

# Missing entry is skip (ok)
assert_ok "missing allowlist entry is skip" \
  stage_legacy_entry "${TMP}/landing/dist" "${TMP}/staged" "self-host"

echo "-- SPA fingerprints before/after legacy staging"
fp_before="${TMP}/fp-before.txt"
fp_after="${TMP}/fp-after.txt"
fingerprint_spa_owned "${TMP}/staged" >"${fp_before}"
# Stage a non-SPA allowlisted path — fingerprints must stay identical
mkdir -p "${TMP}/landing/dist/self-host"
echo "comm" >"${TMP}/landing/dist/self-host/c.html"
stage_legacy_entry "${TMP}/landing/dist" "${TMP}/staged" "self-host"
fingerprint_spa_owned "${TMP}/staged" >"${fp_after}"
assert_ok "fingerprints unchanged after allowlisted staging" \
  assert_spa_fingerprints_unchanged "${fp_before}" "${fp_after}"
assert_eq "self-host support present without SPA mutation" "comm" \
  "$(cat "${TMP}/staged/self-host/c.html")"

# Mutate SPA root and expect fingerprint mismatch
echo "MUTATED" >"${TMP}/staged/index.html"
fingerprint_spa_owned "${TMP}/staged" >"${TMP}/fp-mutated.txt"
assert_fail "fingerprints detect SPA root mutation" \
  assert_spa_fingerprints_unchanged "${fp_before}" "${TMP}/fp-mutated.txt"
# restore SPA root for later tests
echo 'html data-theme="ocean"' >"${TMP}/staged/index.html"

echo "-- backup + verify helpers"
mkdir -p "${TMP}/live/out"
echo "old-content" >"${TMP}/live/out/index.html"
echo "old-sw" >"${TMP}/live/out/sw.js"
backup_live_out "${TMP}/live/out" "testver-1"
test -d "${TMP}/live/.onyx-deploy-backups/onyx-out-testver-1"
assert_eq "backup hardlink snapshot exists" "old-content" \
  "$(cat "${TMP}/live/.onyx-deploy-backups/onyx-out-testver-1/index.html")"

mkdir -p "${TMP}/verify/app"
cat >"${TMP}/verify/index.html" <<'HTML'
<title>Onyx — a room for your people</title>
HTML
echo "app" >"${TMP}/verify/app/index.html"
cat >"${TMP}/verify/404.html" <<'HTML'
<title>Onyx — page not found</title>
<meta name="robots" content="noindex, nofollow" />
HTML
echo "const CACHE_NAME = 'onyx-shell-vtest';" >"${TMP}/verify/sw.js"
assert_ok "verify_live_out accepts good tree" \
  verify_live_out "${TMP}/verify" "vtest"
assert_fail "verify_live_out rejects bad title" \
  verify_live_out "${TMP}/live/out" "vtest"

echo "-- snapshot path helper"
snap_p="$(snapshot_path_for "${TMP}/live/out" "testver-1")"
assert_eq "snapshot_path_for shape" \
  "${TMP}/live/.onyx-deploy-backups/onyx-out-testver-1" "${snap_p}"

echo "-- automatic rollback on simulated post-sync verify failure"
# Prepare a good staged tree that will pass rsync but fail verify (bad title)
mkdir -p "${TMP}/staged-bad/app"
echo "NEW-BAD-TITLE" >"${TMP}/staged-bad/index.html"
echo "new-app" >"${TMP}/staged-bad/app/index.html"
echo '<meta name="robots" content="noindex, nofollow" />' >"${TMP}/staged-bad/404.html"
echo "const CACHE_NAME = 'onyx-shell-rollback-v';" >"${TMP}/staged-bad/sw.js"

# Live currently has old-content; snapshot testver-1 already taken above.
# Use a fresh version with a known snapshot of "old-content".
rm -rf "${TMP}/live2"
mkdir -p "${TMP}/live2/out/app"
echo "recover-me" >"${TMP}/live2/out/index.html"
echo "recover-sw" >"${TMP}/live2/out/sw.js"
echo "recover-app" >"${TMP}/live2/out/app/index.html"
backup_live_out "${TMP}/live2/out" "rollback-v"
# Corrupt path: force verify fail even if staged were good — use bad staged
# and natural verify failure (title needle missing).
set +e
sync_out="$(
  sync_live_with_rollback "${TMP}/staged-bad" "${TMP}/live2/out" "rollback-v" 2>&1
)"
sync_rc=$?
set -e

if [[ "${sync_rc}" -ne 0 ]]; then
  echo "  PASS sync_live_with_rollback returns nonzero on verify fail"
  PASS=$((PASS + 1))
else
  echo "  FAIL sync_live_with_rollback should return nonzero"
  FAIL=$((FAIL + 1))
fi

assert_contains "emits restore_proven recovery evidence" \
  "RECOVERY_EVIDENCE: result=restore_proven" "${sync_out}"
assert_contains "recovery evidence names reason" \
  "reason=post_sync_verify_failed" "${sync_out}"

assert_eq "live index restored to pre-sync content" "recover-me" \
  "$(cat "${TMP}/live2/out/index.html")"
assert_eq "live sw restored" "recover-sw" \
  "$(cat "${TMP}/live2/out/sw.js")"
assert_eq "live app restored" "recover-app" \
  "$(cat "${TMP}/live2/out/app/index.html")"

# Prove helper independently
assert_ok "prove_snapshot_restored matches after rollback" \
  prove_snapshot_restored "${TMP}/live2/out" \
    "${TMP}/live2/.onyx-deploy-backups/onyx-out-rollback-v"

echo "-- forced verify fail path (ONYX_DEPLOY_FORCE_VERIFY_FAIL)"
# Staged tree that WOULD pass verify if not forced
mkdir -p "${TMP}/staged-good/app" "${TMP}/live3/out/app"
cat >"${TMP}/staged-good/index.html" <<'HTML'
<title>Onyx — a room for your people</title>
HTML
echo "app-new" >"${TMP}/staged-good/app/index.html"
cat >"${TMP}/staged-good/404.html" <<'HTML'
<title>Onyx — page not found</title>
<meta name="robots" content="noindex, nofollow" />
HTML
echo "const CACHE_NAME = 'onyx-shell-forcev';" >"${TMP}/staged-good/sw.js"
echo "old3" >"${TMP}/live3/out/index.html"
echo "old3-sw" >"${TMP}/live3/out/sw.js"
echo "old3-app" >"${TMP}/live3/out/app/index.html"
backup_live_out "${TMP}/live3/out" "forcev"
set +e
force_out="$(
  ONYX_DEPLOY_FORCE_VERIFY_FAIL=1 \
    sync_live_with_rollback "${TMP}/staged-good" "${TMP}/live3/out" "forcev" 2>&1
)"
force_rc=$?
set -e
if [[ "${force_rc}" -ne 0 ]]; then
  echo "  PASS forced verify fail returns nonzero"
  PASS=$((PASS + 1))
else
  echo "  FAIL forced verify fail should return nonzero"
  FAIL=$((FAIL + 1))
fi
assert_contains "forced fail restore_proven" \
  "RECOVERY_EVIDENCE: result=restore_proven" "${force_out}"
assert_contains "forced fail reason tag" \
  "reason=post_sync_verify_forced_fail" "${force_out}"
assert_eq "forced-fail live restored" "old3" "$(cat "${TMP}/live3/out/index.html")"

echo "-- active-client asset compatibility (retain hashed assets, delete stale non-assets)"
# Live has a prior immutable hashed asset + a stale non-asset root file.
# Staged ships a new asset + updated shared asset + good SPA shell.
mkdir -p "${TMP}/live-compat/out/assets" "${TMP}/live-compat/out/app" \
  "${TMP}/live-compat/out/onyxOS" \
  "${TMP}/staged-compat/assets" "${TMP}/staged-compat/app" \
  "${TMP}/staged-compat/onyxOS"
echo "LEGACY-HASH-ASSET" >"${TMP}/live-compat/out/assets/old-chunk-aaaaaaaa.js"
echo "SHARED-OLD" >"${TMP}/live-compat/out/assets/shared-bbbbbbbb.js"
echo "STALE-NON-ASSET" >"${TMP}/live-compat/out/stale-page.html"
echo "old-compat-index" >"${TMP}/live-compat/out/index.html"
echo "old-compat-app" >"${TMP}/live-compat/out/app/index.html"
echo "const CACHE_NAME = 'onyx-shell-oldcompat';" >"${TMP}/live-compat/out/sw.js"
echo 'LIVE-RUNTIME-STATUS' >"${TMP}/live-compat/out/onyxOS/status.json"

cat >"${TMP}/staged-compat/index.html" <<'HTML'
<title>Onyx — a room for your people</title>
HTML
echo "app-compat-new" >"${TMP}/staged-compat/app/index.html"
cat >"${TMP}/staged-compat/404.html" <<'HTML'
<title>Onyx — page not found</title>
<meta name="robots" content="noindex, nofollow" />
HTML
echo "const CACHE_NAME = 'onyx-shell-compat-v';" >"${TMP}/staged-compat/sw.js"
echo "NEW-HASH-ASSET" >"${TMP}/staged-compat/assets/new-chunk-cccccccc.js"
echo "SHARED-NEW" >"${TMP}/staged-compat/assets/shared-bbbbbbbb.js"
echo 'STALE-STAGED-STATUS' >"${TMP}/staged-compat/onyxOS/status.json"

backup_live_out "${TMP}/live-compat/out" "compat-v"
assert_ok "compat success path sync" \
  sync_live_with_rollback "${TMP}/staged-compat" "${TMP}/live-compat/out" "compat-v"

assert_eq "prior live hashed asset survives success" "LEGACY-HASH-ASSET" \
  "$(cat "${TMP}/live-compat/out/assets/old-chunk-aaaaaaaa.js")"
if [[ -e "${TMP}/live-compat/out/stale-page.html" ]]; then
  echo "  FAIL stale non-asset should be deleted"
  FAIL=$((FAIL + 1))
else
  echo "  PASS stale non-asset deleted"
  PASS=$((PASS + 1))
fi
assert_eq "current staged asset present byte-identical" "NEW-HASH-ASSET" \
  "$(cat "${TMP}/live-compat/out/assets/new-chunk-cccccccc.js")"
assert_eq "current staged asset updated byte-identical" "SHARED-NEW" \
  "$(cat "${TMP}/live-compat/out/assets/shared-bbbbbbbb.js")"
assert_eq "compat root index is staged content" \
  "$(cat "${TMP}/staged-compat/index.html")" \
  "$(cat "${TMP}/live-compat/out/index.html")"
assert_eq "runtime-owned status feed survives cutover" "LIVE-RUNTIME-STATUS" \
  "$(cat "${TMP}/live-compat/out/onyxOS/status.json")"
assert_ok "verify_staged_in_live accepts extras under assets" \
  verify_staged_in_live "${TMP}/staged-compat" "${TMP}/live-compat/out"

# Forced failure after both rsync phases must roll back assets + root exactly.
mkdir -p "${TMP}/live-roll-assets/out/assets" "${TMP}/live-roll-assets/out/app" \
  "${TMP}/staged-roll-assets/assets" "${TMP}/staged-roll-assets/app"
echo "PRE-ROLL-LEGACY" >"${TMP}/live-roll-assets/out/assets/legacy-dddddddd.js"
echo "PRE-ROLL-SHARED" >"${TMP}/live-roll-assets/out/assets/shared-eeeeeeee.js"
echo "pre-roll-index" >"${TMP}/live-roll-assets/out/index.html"
echo "pre-roll-app" >"${TMP}/live-roll-assets/out/app/index.html"
echo "const CACHE_NAME = 'onyx-shell-preroll';" >"${TMP}/live-roll-assets/out/sw.js"
echo "pre-roll-stale" >"${TMP}/live-roll-assets/out/will-change.html"

cat >"${TMP}/staged-roll-assets/index.html" <<'HTML'
<title>Onyx — a room for your people</title>
HTML
echo "post-roll-app" >"${TMP}/staged-roll-assets/app/index.html"
echo "const CACHE_NAME = 'onyx-shell-postroll';" >"${TMP}/staged-roll-assets/sw.js"
echo "POST-ROLL-NEW" >"${TMP}/staged-roll-assets/assets/new-ffffffff.js"
echo "POST-ROLL-SHARED" >"${TMP}/staged-roll-assets/assets/shared-eeeeeeee.js"

backup_live_out "${TMP}/live-roll-assets/out" "roll-assets-v"
set +e
roll_assets_out="$(
  ONYX_DEPLOY_FORCE_VERIFY_FAIL=1 \
    sync_live_with_rollback \
      "${TMP}/staged-roll-assets" "${TMP}/live-roll-assets/out" "roll-assets-v" 2>&1
)"
roll_assets_rc=$?
set -e
if [[ "${roll_assets_rc}" -ne 0 ]]; then
  echo "  PASS asset-compat forced fail returns nonzero"
  PASS=$((PASS + 1))
else
  echo "  FAIL asset-compat forced fail should return nonzero"
  FAIL=$((FAIL + 1))
fi
assert_contains "asset-compat forced fail restore_proven" \
  "RECOVERY_EVIDENCE: result=restore_proven" "${roll_assets_out}"
assert_eq "forced-fail rolls back index exactly" "pre-roll-index" \
  "$(cat "${TMP}/live-roll-assets/out/index.html")"
assert_eq "forced-fail rolls back legacy asset exactly" "PRE-ROLL-LEGACY" \
  "$(cat "${TMP}/live-roll-assets/out/assets/legacy-dddddddd.js")"
assert_eq "forced-fail rolls back shared asset exactly" "PRE-ROLL-SHARED" \
  "$(cat "${TMP}/live-roll-assets/out/assets/shared-eeeeeeee.js")"
assert_eq "forced-fail restores pre-sync non-asset" "pre-roll-stale" \
  "$(cat "${TMP}/live-roll-assets/out/will-change.html")"
if [[ -e "${TMP}/live-roll-assets/out/assets/new-ffffffff.js" ]]; then
  echo "  FAIL forced-fail should not leave staged-only new asset after rollback"
  FAIL=$((FAIL + 1))
else
  echo "  PASS forced-fail removed staged-only new asset via rollback"
  PASS=$((PASS + 1))
fi
assert_ok "forced-fail live matches snapshot byte-for-byte" \
  prove_snapshot_restored "${TMP}/live-roll-assets/out" \
    "${TMP}/live-roll-assets/.onyx-deploy-backups/onyx-out-roll-assets-v"

echo "-- restore --checksum: same-size + forced identical mtime still restores old bytes"
# Hard-link snapshot + size/mtime-equal live mutation is the exact class that
# rsync's quick-check (size+mtime, no --checksum) can skip. Prove restore still
# returns snapshot bytes when those metadata collide.
mkdir -p "${TMP}/live-cksum/out/app" "${TMP}/live-cksum/out/assets"
# Same length (16 bytes) so size collides; content differs.
printf 'OLD-CKSUM-BYTES!' >"${TMP}/live-cksum/out/index.html"
printf 'OLD-ASSET-BYTES!' >"${TMP}/live-cksum/out/assets/shared-gggggggg.js"
echo "old-cksum-app" >"${TMP}/live-cksum/out/app/index.html"
echo "const CACHE_NAME = 'onyx-shell-cksum';" >"${TMP}/live-cksum/out/sw.js"
backup_live_out "${TMP}/live-cksum/out" "cksum-v"
snap_cksum="$(snapshot_path_for "${TMP}/live-cksum/out" "cksum-v")"
# Break hard-links (cp -al shares inodes; in-place rewrite would mutate snap).
rm -f "${TMP}/live-cksum/out/index.html" \
  "${TMP}/live-cksum/out/assets/shared-gggggggg.js"
printf 'NEW-CKSUM-BYTES!' >"${TMP}/live-cksum/out/index.html"
printf 'NEW-ASSET-BYTES!' >"${TMP}/live-cksum/out/assets/shared-gggggggg.js"
# Force identical mtime on snap vs live for both collision files.
touch -r "${snap_cksum}/index.html" "${TMP}/live-cksum/out/index.html"
touch -r "${snap_cksum}/assets/shared-gggggggg.js" \
  "${TMP}/live-cksum/out/assets/shared-gggggggg.js"
# Precondition: size equal and mtime equal (else the collision is not real).
assert_eq "collision size index" \
  "$(wc -c <"${snap_cksum}/index.html")" \
  "$(wc -c <"${TMP}/live-cksum/out/index.html")"
assert_eq "collision size asset" \
  "$(wc -c <"${snap_cksum}/assets/shared-gggggggg.js")" \
  "$(wc -c <"${TMP}/live-cksum/out/assets/shared-gggggggg.js")"
assert_eq "collision mtime index" \
  "$(stat -c '%Y' "${snap_cksum}/index.html")" \
  "$(stat -c '%Y' "${TMP}/live-cksum/out/index.html")"
assert_eq "collision mtime asset" \
  "$(stat -c '%Y' "${snap_cksum}/assets/shared-gggggggg.js")" \
  "$(stat -c '%Y' "${TMP}/live-cksum/out/assets/shared-gggggggg.js")"
assert_eq "pre-restore live index is NEW" "NEW-CKSUM-BYTES!" \
  "$(cat "${TMP}/live-cksum/out/index.html")"
assert_eq "pre-restore live asset is NEW" "NEW-ASSET-BYTES!" \
  "$(cat "${TMP}/live-cksum/out/assets/shared-gggggggg.js")"
# Control: without --checksum, size+mtime quick-check leaves NEW in place
# (documents why restore requires --checksum). Disposable copy only.
rm -rf "${TMP}/live-cksum-control"
mkdir -p "${TMP}/live-cksum-control"
cp -a "${TMP}/live-cksum/out/." "${TMP}/live-cksum-control/"
rsync --archive --delete "${snap_cksum}/" "${TMP}/live-cksum-control/"
assert_eq "control no-checksum leaves NEW index" "NEW-CKSUM-BYTES!" \
  "$(cat "${TMP}/live-cksum-control/index.html")"
assert_eq "control no-checksum leaves NEW asset" "NEW-ASSET-BYTES!" \
  "$(cat "${TMP}/live-cksum-control/assets/shared-gggggggg.js")"
# Subject under test: restore_live_out_from_snapshot must use --checksum.
assert_ok "restore_live_out_from_snapshot under size/mtime collision" \
  restore_live_out_from_snapshot "${TMP}/live-cksum/out" "cksum-v"
assert_eq "restore returns OLD index bytes under collision" "OLD-CKSUM-BYTES!" \
  "$(cat "${TMP}/live-cksum/out/index.html")"
assert_eq "restore returns OLD asset bytes under collision" "OLD-ASSET-BYTES!" \
  "$(cat "${TMP}/live-cksum/out/assets/shared-gggggggg.js")"
assert_ok "prove_snapshot_restored after collision restore" \
  prove_snapshot_restored "${TMP}/live-cksum/out" "${snap_cksum}"
# Source guard: restore helper must pass --checksum (not only forward sync).
if grep -E 'rsync --archive --checksum --delete "\$\{snap\}/' "${DEPLOY}" >/dev/null \
  || grep -E 'rsync --archive --checksum --delete "\$\{snap\}/"' "${DEPLOY}" >/dev/null; then
  echo "  PASS restore_live_out_from_snapshot rsync uses --checksum"
  PASS=$((PASS + 1))
else
  echo "  FAIL restore_live_out_from_snapshot missing --checksum on rsync"
  FAIL=$((FAIL + 1))
fi

# Guard: controller must never pass delete-excluded to rsync (comments may mention it).
if grep -E '^[^#]*rsync[^#]*--delete-excluded' "${DEPLOY}" >/dev/null; then
  echo "  FAIL deploy.sh must not pass --delete-excluded to rsync"
  FAIL=$((FAIL + 1))
else
  echo "  PASS deploy.sh never passes --delete-excluded to rsync"
  PASS=$((PASS + 1))
fi
if grep -E "rsync .*--exclude='/assets/'" "${DEPLOY}" >/dev/null \
  || grep -E 'rsync .*--exclude="/assets/"' "${DEPLOY}" >/dev/null \
  || grep -E 'rsync .*--exclude=/assets/' "${DEPLOY}" >/dev/null; then
  echo "  PASS deploy.sh excludes top-level /assets/ on root rsync"
  PASS=$((PASS + 1))
else
  echo "  FAIL deploy.sh missing /assets/ exclude on root rsync"
  FAIL=$((FAIL + 1))
fi

echo "-- fail closed when snapshot missing"
mkdir -p "${TMP}/live4/out" "${TMP}/staged-orphan/app"
echo "will-be-overwritten" >"${TMP}/live4/out/index.html"
# No backup_live_out call — no snapshot
echo "orphan" >"${TMP}/staged-orphan/index.html"
echo "app" >"${TMP}/staged-orphan/app/index.html"
echo "const CACHE_NAME = 'onyx-shell-nosnap';" >"${TMP}/staged-orphan/sw.js"
set +e
nosnap_out="$(
  sync_live_with_rollback "${TMP}/staged-orphan" "${TMP}/live4/out" "nosnap-v" 2>&1
)"
nosnap_rc=$?
set -e
if [[ "${nosnap_rc}" -ne 0 ]]; then
  echo "  PASS missing snapshot fails closed"
  PASS=$((PASS + 1))
else
  echo "  FAIL missing snapshot should fail"
  FAIL=$((FAIL + 1))
fi
assert_contains "snapshot_missing evidence" \
  "RECOVERY_EVIDENCE: result=snapshot_missing" "${nosnap_out}"

echo "-- ordering: snapshot before ACL/content mutation in deploy.sh"
# Grep line numbers: backup_live_out must appear before setfacl and sync_live_with_rollback
# inside deploy_main (not merely in helper definitions).
main_start="$(grep -n '^deploy_main()' "${DEPLOY}" | head -1 | cut -d: -f1)"
backup_line="$(awk -v s="${main_start}" 'NR>=s && /backup_live_out / {print NR; exit}' "${DEPLOY}")"
acl_line="$(awk -v s="${main_start}" 'NR>=s && /setfacl / {print NR; exit}' "${DEPLOY}")"
sync_line="$(awk -v s="${main_start}" 'NR>=s && /sync_live_with_rollback / {print NR; exit}' "${DEPLOY}")"
if [[ -n "${backup_line}" && -n "${acl_line}" && -n "${sync_line}" \
   && "${backup_line}" -lt "${acl_line}" && "${backup_line}" -lt "${sync_line}" ]]; then
  echo "  PASS snapshot ordered before ACL and rsync (lines ${backup_line}<${acl_line}<${sync_line})"
  PASS=$((PASS + 1))
else
  echo "  FAIL snapshot/ACL/rsync order wrong (backup=${backup_line} acl=${acl_line} sync=${sync_line})"
  FAIL=$((FAIL + 1))
fi

# No-op comparison loop must be gone
if grep -q 'Identical content is only a problem' "${DEPLOY}"; then
  echo "  FAIL meaningless no-op comparison loop still present"
  FAIL=$((FAIL + 1))
else
  echo "  PASS meaningless no-op comparison loop removed"
  PASS=$((PASS + 1))
fi

echo "-- dry-run non-mutation against nonexistent temp target"
DRY_TARGET="${TMP}/nonexistent-live/out"
test ! -e "${DRY_TARGET}"
if [[ "${ONYX_DEPLOY_FULL_DRY_RUN:-0}" == "1" ]]; then
  DEPLOY_DRY_RUN=1 ONYX_LIVE_OUT="${DRY_TARGET}" bash "${DEPLOY}"
  if [[ -e "${DRY_TARGET}" ]]; then
    echo "  FAIL full dry-run created live target"
    FAIL=$((FAIL + 1))
  else
    echo "  PASS full dry-run did not create live target"
    PASS=$((PASS + 1))
  fi
else
  if grep -q 'DEPLOY_DRY_RUN' "${DEPLOY}" && grep -q 'will not touch live target' "${DEPLOY}"; then
    echo "  PASS dry-run guard present in deploy.sh (set ONYX_DEPLOY_FULL_DRY_RUN=1 for full)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL dry-run guard missing"
    FAIL=$((FAIL + 1))
  fi
  mkdir -p "${TMP}/staged-dist"
  print_would_sync "${TMP}/staged-dist" "${DRY_TARGET}" >/dev/null
  if [[ -e "${DRY_TARGET}" ]]; then
    echo "  FAIL print_would_sync created target"
    FAIL=$((FAIL + 1))
  else
    echo "  PASS print_would_sync does not create live target"
    PASS=$((PASS + 1))
  fi
fi

# Ensure allowlist does not include root documents
for forbidden in index.html 404.html robots.txt sitemap.xml favicon.ico favicon.svg about app assets sw.js; do
  if printf '%s\n' "${LEGACY_SUPPORT_ALLOWLIST[@]}" | grep -qx "${forbidden}"; then
    echo "  FAIL allowlist contains forbidden ${forbidden}"
    FAIL=$((FAIL + 1))
  else
    echo "  PASS allowlist excludes ${forbidden}"
    PASS=$((PASS + 1))
  fi
done

echo "-- production out untouched"
if [[ "${prod_marker_before}" == "ABSENT" ]]; then
  if [[ -d "${PROD_OUT}" ]]; then
    echo "  FAIL production out appeared during tests"
    FAIL=$((FAIL + 1))
  else
    echo "  PASS production out still absent"
    PASS=$((PASS + 1))
  fi
else
  prod_marker_after="$(find "${PROD_OUT}" -printf '%T@ %i %p\n' 2>/dev/null | sha256sum | awk '{print $1}')"
  assert_eq "production /home/kain/onyx/out marker unchanged" \
    "${prod_marker_before}" "${prod_marker_after}"
fi

# Guard: no test path used PROD_OUT as a live target in helpers we control
if [[ "${TMP}" == "${PROD_OUT}"* ]]; then
  echo "  FAIL test TMP collides with production out"
  FAIL=$((FAIL + 1))
else
  echo "  PASS test sandbox is not production out"
  PASS=$((PASS + 1))
fi

echo
echo "Results: ${PASS} passed, ${FAIL} failed"
if [[ "${FAIL}" -ne 0 ]]; then
  exit 1
fi
exit 0
