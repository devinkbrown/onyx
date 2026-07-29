#!/usr/bin/env bash
# Onyx deploy controller — build to dist/, stage allowlisted legacy support
# resources, then rsync the staged tree into an explicit live out target.
# Live assets/ use compatibility retention: root rsync excludes /assets/ with
# --delete; assets rsync has no --delete so prior hashed chunks survive.
#
# ARCHITECTURE
# ------------
# nginx serves /home/kain/onyx/out at eshmaki.me. This checkout may be a
# worktree (e.g. /home/kain/onyx-public-launch); relative ./out is NOT the
# production tree. Set ONYX_LIVE_OUT=/home/kain/onyx/out for a live release.
#
# Vite builds to dist/ — never out/ — so plain `pnpm build` / tests / e2e can
# never wipe or half-replace production. ONLY this script writes the live out.
#
# AUTHORITY
# ---------
# The Vite/Solid Landing (and materialised SPA route documents) is authoritative
# for the public root and all SPA routes. /home/kain/landing is no longer the
# public website: it may only contribute explicitly allowlisted, non-conflicting
# legacy support resources (guides, community, install, …). Root documents
# (index.html, robots.txt, sitemap.xml, favicons) and SPA-owned paths are never
# overlaid from landing.
#
# Usage:
#   ./deploy.sh
#   ONYX_LIVE_OUT=/home/kain/onyx/out ./deploy.sh
#   DEPLOY_DRY_RUN=1 ONYX_LIVE_OUT=/tmp/onyx-dry/out ./deploy.sh
#
# Env:
#   ONYX_LIVE_OUT   Absolute path whose basename is `out` (default: $checkout/out).
#                   When set, must already be absolute (raw relatives rejected).
#                   Target must not itself be a symlink.
#   DEPLOY_DRY_RUN  Exactly 0 or 1 (default 0). If 1, build/stage/assert only —
#                   no live backup/rsync/ACL.
#   ONYX_WEB_USER   Account granted execute on the live parent (default: http)
#   ONYX_LANDING    Override path to the legacy landing tree (default: /home/kain/landing)
#   ONYX_STAGE_BSD_DOWNLOADS  If 1, copy FreeBSD/OpenBSD release tarballs into
#                   dist/downloads/v0.1.3/ via tools/stage-bsd-downloads.mjs.
#                   Normal deploy leaves this unset (no binary staging).
#   ONYX_PUBLISH_BSD_DOWNLOADS  If 1 (with stage), fail closed when either BSD
#                   lane artifact is missing under zig-out/release/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT}"

LANDING="${ONYX_LANDING:-/home/kain/landing}"
DRY_RUN="${DEPLOY_DRY_RUN:-0}"

# Explicit allowlist of legacy support paths that may be staged from landing/dist.
# Missing entries are skipped; present entries must be regular files or directories
# (never symlinks or other types).
LEGACY_SUPPORT_ALLOWLIST=(
  guides
  community
  install
  self-host
  why
  memory
  onyxOS
  fonts
)

# SPA / app-owned names that must never be copied from landing (defense in depth).
SPA_OWNED_BLOCKLIST=(
  index.html
  robots.txt
  sitemap.xml
  favicon.ico
  favicon.svg
  about
  app
  appearance
  invite
  download
  stats
  status
  roadmap
  accessibility
  glossary
  integrations
  agents
  downloads
  assets
  manifest.json
  sw.js
  icon-192.png
  icon-512.png
  screenshots
  opcodec_wasm.js
  opcodec_wasm.wasm
  codecs
)

# ---------------------------------------------------------------------------
# Pure helpers (also exercised by tools/deploy-controller.test.sh)
# ---------------------------------------------------------------------------

# Resolve a path to absolute form without requiring it to exist (GNU realpath -m).
normalize_abs_path() {
  local raw="$1"
  if [[ -z "${raw}" ]]; then
    echo "FAIL: empty path" >&2
    return 1
  fi
  if command -v realpath >/dev/null 2>&1; then
    realpath -m "${raw}"
    return 0
  fi
  # Fallback: absolute-only expansion (no .. collapse beyond simple prefix).
  if [[ "${raw}" != /* ]]; then
    raw="${PWD}/${raw}"
  fi
  echo "${raw}"
}

# DEPLOY_DRY_RUN must be exactly 0 or 1.
validate_dry_run() {
  local val="$1"
  case "${val}" in
    0|1) return 0 ;;
    *)
      echo "FAIL: DEPLOY_DRY_RUN must be exactly 0 or 1 (got: ${val})" >&2
      return 1
      ;;
  esac
}

# Validate live out target. Prints nothing on success; returns 0 or 1.
# Args: live_out checkout_root
validate_live_out() {
  local live="$1"
  local checkout="$2"

  if [[ -z "${live}" ]]; then
    echo "FAIL: live out path is empty" >&2
    return 1
  fi
  if [[ "${live}" != /* ]]; then
    echo "FAIL: live out must be absolute after normalization (got: ${live})" >&2
    return 1
  fi
  if [[ "${live}" == "/" ]]; then
    echo "FAIL: live out cannot be filesystem root /" >&2
    return 1
  fi
  local base
  base="$(basename "${live}")"
  if [[ "${base}" != "out" ]]; then
    echo "FAIL: live out basename must be 'out' (got: ${base})" >&2
    return 1
  fi
  if [[ "${live}" == "${checkout}" ]]; then
    echo "FAIL: live out cannot be the checkout root (${checkout})" >&2
    return 1
  fi
  if [[ "${live}" == "${checkout}/dist" || "${base}" == "dist" ]]; then
    echo "FAIL: live out cannot be dist (${live})" >&2
    return 1
  fi
  # Reject paths that resolve to the staged build tree under another name.
  local live_norm checkout_dist
  live_norm="${live%/}"
  checkout_dist="$(normalize_abs_path "${checkout}/dist")"
  if [[ "${live_norm}" == "${checkout_dist}" ]]; then
    echo "FAIL: live out cannot be the checkout dist tree" >&2
    return 1
  fi
  # Reject a target that is itself a symlink (broken or live).
  if [[ -L "${live}" ]]; then
    echo "FAIL: live out target is a symlink — refuse (${live})" >&2
    return 1
  fi
  return 0
}

# Resolve ONYX_LIVE_OUT: explicit values must be raw-absolute before normalize.
# Prints the absolute path on success.
resolve_live_out() {
  local checkout="$1"
  local raw live

  if [[ "${ONYX_LIVE_OUT+x}" == "x" ]]; then
    raw="${ONYX_LIVE_OUT}"
    if [[ -z "${raw}" ]]; then
      echo "FAIL: ONYX_LIVE_OUT is empty" >&2
      return 1
    fi
    # Reject raw relative paths before normalization (explicit supply only).
    if [[ "${raw}" != /* ]]; then
      echo "FAIL: ONYX_LIVE_OUT must be an absolute path when supplied (got: ${raw})" >&2
      return 1
    fi
    live="$(normalize_abs_path "${raw}")" || return 1
  else
    # Safe absolute checkout-local default.
    live="$(normalize_abs_path "${checkout}/out")" || return 1
  fi

  validate_live_out "${live}" "${checkout}" || return 1
  echo "${live}"
  return 0
}

# Compose release version stamp. Args: optional override date, git short, dirty flag (0/1)
compose_version() {
  local when="${1:-}"
  local git_short="${2:-local}"
  local dirty_flag="${3:-0}"
  if [[ -z "${when}" ]]; then
    when="$(date +%Y%m%d-%H%M%S)"
  fi
  local ver="${when}-${git_short}"
  if [[ "${dirty_flag}" == "1" ]]; then
    ver="${ver}-dirty"
  fi
  echo "${ver}"
}

# Working tree dirty? 1 = dirty, 0 = clean. Uncommitted tracked or untracked source.
is_source_dirty() {
  if ! git -C "${ROOT}" rev-parse --git-dir >/dev/null 2>&1; then
    echo 1
    return 0
  fi
  if [[ -n "$(git -C "${ROOT}" status --porcelain 2>/dev/null)" ]]; then
    echo 1
  else
    echo 0
  fi
}

# Copy one allowlist entry if present. Fail on symlink / unsafe type.
# Args: landing_dist_dir staged_dist_dir name
stage_legacy_entry() {
  local landing_dist="$1"
  local staged="$2"
  local name="$3"
  local src="${landing_dist}/${name}"

  if [[ ! -e "${src}" ]]; then
    echo "==> legacy support skip (missing): ${name}"
    return 0
  fi
  if [[ -L "${src}" ]]; then
    echo "FAIL: legacy support '${name}' is a symlink — refusing unsafe overlay" >&2
    return 1
  fi
  if [[ -f "${src}" ]]; then
    cp -a "${src}" "${staged}/${name}"
    echo "==> legacy support file: ${name}"
    return 0
  fi
  if [[ -d "${src}" ]]; then
    # Refuse nested symlinks that could escape or clobber SPA-owned content.
    if find "${src}" -type l -print -quit | grep -q .; then
      echo "FAIL: legacy support '${name}' contains a symlink — refusing unsafe overlay" >&2
      return 1
    fi
    rm -rf "${staged:?}/${name}"
    cp -a "${src}" "${staged}/${name}"
    echo "==> legacy support dir:  ${name}"
    return 0
  fi
  echo "FAIL: legacy support '${name}' is neither a regular file nor a directory" >&2
  return 1
}

assert_no_spa_owned_in_landing_dist() {
  local landing_dist="$1"
  local name
  local item
  for item in "${LEGACY_SUPPORT_ALLOWLIST[@]}"; do
    for name in "${SPA_OWNED_BLOCKLIST[@]}"; do
      if [[ "${item}" == "${name}" ]]; then
        echo "FAIL: allowlist entry '${item}' conflicts with SPA-owned blocklist" >&2
        return 1
      fi
    done
  done
  # Root documents must never be staged even if present in landing.
  for name in index.html robots.txt sitemap.xml favicon.ico favicon.svg; do
    if [[ " ${LEGACY_SUPPORT_ALLOWLIST[*]} " == *" ${name} "* ]]; then
      echo "FAIL: root document '${name}' must not be on the legacy allowlist" >&2
      return 1
    fi
  done
  return 0
}

# Deterministic fingerprint of SPA-owned paths under staged root.
# Emits sorted "relpath\tsha256" lines for regular files (no symlink follow).
# Args: staged_root
fingerprint_spa_owned() {
  local staged="$1"
  local name path

  if [[ -z "${staged}" || ! -d "${staged}" ]]; then
    echo "FAIL: fingerprint_spa_owned requires an existing staged directory" >&2
    return 1
  fi

  {
    for name in "${SPA_OWNED_BLOCKLIST[@]}"; do
      path="${staged}/${name}"
      if [[ -L "${path}" ]]; then
        # Symlink at SPA-owned name is never expected from Vite output.
        printf '%s\tSYMLINK\n' "${name}"
        continue
      fi
      if [[ -f "${path}" ]]; then
        # shellcheck disable=SC2012
        printf '%s\t%s\n' "${name}" "$(sha256sum "${path}" | awk '{print $1}')"
      elif [[ -d "${path}" ]]; then
        # Bound: regular files only, no -L follow; stable path order.
        find "${path}" -type f -print0 2>/dev/null \
          | sort -z \
          | while IFS= read -r -d '' f; do
              rel="${f#"${staged}/"}"
              printf '%s\t%s\n' "${rel}" "$(sha256sum "${f}" | awk '{print $1}')"
            done
      fi
    done
  } | LC_ALL=C sort
}

# Compare two fingerprint manifests; fail if they differ.
# Args: before_file after_file
assert_spa_fingerprints_unchanged() {
  local before="$1"
  local after="$2"
  if [[ ! -f "${before}" || ! -f "${after}" ]]; then
    echo "FAIL: spa fingerprint manifest missing" >&2
    return 1
  fi
  if ! cmp -s "${before}" "${after}"; then
    echo "FAIL: SPA-owned content changed during legacy support staging" >&2
    echo "      fingerprint diff (before → after):" >&2
    diff -u "${before}" "${after}" >&2 || true
    return 1
  fi
  return 0
}

# Snapshot path for a live out + version (sibling of live parent).
# Args: live_out version → prints path
snapshot_path_for() {
  local live_out="$1"
  local version="$2"
  local parent backup_root
  parent="$(dirname "${live_out}")"
  backup_root="${parent}/.onyx-deploy-backups"
  echo "${backup_root}/onyx-out-${version}"
}

# Hard-link snapshot of existing live out → sibling .onyx-deploy-backups/<stamp>
# Args: live_out version
# Prints snapshot path on success when a snapshot was created; empty skip is ok.
backup_live_out() {
  local live_out="$1"
  local version="$2"
  local parent backup_root snap

  parent="$(dirname "${live_out}")"
  backup_root="${parent}/.onyx-deploy-backups"
  snap="${backup_root}/onyx-out-${version}"

  if [[ ! -d "${live_out}" ]]; then
    echo "==> no existing live out to back up (${live_out})"
    return 0
  fi
  if [[ -z "$(find "${live_out}" -mindepth 1 -print -quit 2>/dev/null)" ]]; then
    echo "==> live out empty — skip hard-link backup"
    return 0
  fi

  mkdir -p "${backup_root}"
  if [[ -e "${snap}" ]]; then
    echo "FAIL: backup path already exists: ${snap}" >&2
    return 1
  fi

  echo "==> hard-link snapshot ${live_out} -> ${snap}"
  # cp -al: hard-link files where possible (same filesystem). Fail closed.
  if ! cp -al "${live_out}" "${snap}"; then
    echo "FAIL: hard-link backup failed — refusing live mutation" >&2
    return 1
  fi
  if [[ ! -d "${snap}" ]]; then
    echo "FAIL: backup directory missing after cp -al" >&2
    return 1
  fi
  echo "==> backup ok: ${snap}"
  return 0
}

# Content fingerprint of an entire tree (sorted relpath\tsha256). Args: dir
tree_content_fingerprint() {
  local root="$1"
  if [[ ! -d "${root}" ]]; then
    echo "FAIL: tree_content_fingerprint: not a directory: ${root}" >&2
    return 1
  fi
  # No symlink follow (-type f only). Stable order.
  find "${root}" -type f -print0 2>/dev/null \
    | sort -z \
    | while IFS= read -r -d '' f; do
        rel="${f#"${root}/"}"
        printf '%s\t%s\n' "${rel}" "$(sha256sum "${f}" | awk '{print $1}')"
      done
}

# Every regular file under staged must exist byte-identically under live
# (deterministic sha256). Extra files under live/assets (prior immutable
# hashed assets) are allowed; this check does not require live ⊆ staged.
# Args: staged live_out
verify_staged_in_live() {
  local staged="$1"
  local live_out="$2"
  local f rel live_f staged_sum live_sum

  if [[ ! -d "${staged}" || ! -d "${live_out}" ]]; then
    echo "FAIL: verify_staged_in_live: staged or live missing" >&2
    return 1
  fi

  while IFS= read -r -d '' f; do
    rel="${f#"${staged}/"}"
    live_f="${live_out}/${rel}"
    if [[ ! -f "${live_f}" ]]; then
      echo "FAIL: staged file missing from live after sync: ${rel}" >&2
      return 1
    fi
    staged_sum="$(sha256sum "${f}" | awk '{print $1}')"
    live_sum="$(sha256sum "${live_f}" | awk '{print $1}')"
    if [[ "${staged_sum}" != "${live_sum}" ]]; then
      echo "FAIL: staged/live content mismatch after sync: ${rel}" >&2
      echo "      staged sha256: ${staged_sum}" >&2
      echo "      live sha256:   ${live_sum}" >&2
      return 1
    fi
  done < <(find "${staged}" -type f -print0 2>/dev/null | sort -z)

  return 0
}

# Restore live out from snapshot via rsync --archive --checksum --delete.
# --checksum is required for the same reason as forward sync: hard-link
# snapshots plus same-size/same-mtime pairs can leave rsync size+mtime
# quick-check believing content matches when bytes differ.
# Args: live_out version
restore_live_out_from_snapshot() {
  local live_out="$1"
  local version="$2"
  local snap
  snap="$(snapshot_path_for "${live_out}" "${version}")"

  if [[ ! -d "${snap}" ]]; then
    echo "FAIL: cannot restore — snapshot missing: ${snap}" >&2
    return 1
  fi
  echo "==> RECOVERY: restoring live out from snapshot ${snap}"
  mkdir -p "${live_out}"
  if ! rsync --archive --checksum --delete "${snap}/" "${live_out}/"; then
    echo "FAIL: rsync restore from snapshot failed (${snap} -> ${live_out})" >&2
    return 1
  fi
  return 0
}

# Prove live matches snapshot byte-for-byte (regular files). Fail closed.
# Args: live_out snap_dir
prove_snapshot_restored() {
  local live_out="$1"
  local snap="$2"
  local live_fp snap_fp

  if [[ ! -d "${live_out}" || ! -d "${snap}" ]]; then
    echo "FAIL: prove_snapshot_restored: live or snap missing" >&2
    return 1
  fi

  live_fp="$(mktemp "${TMPDIR:-/tmp}/onyx-live-fp.XXXXXX")"
  snap_fp="$(mktemp "${TMPDIR:-/tmp}/onyx-snap-fp.XXXXXX")"

  if ! tree_content_fingerprint "${snap}" >"${snap_fp}"; then
    rm -f "${live_fp}" "${snap_fp}"
    return 1
  fi
  if ! tree_content_fingerprint "${live_out}" >"${live_fp}"; then
    rm -f "${live_fp}" "${snap_fp}"
    return 1
  fi

  if ! cmp -s "${snap_fp}" "${live_fp}"; then
    echo "FAIL: restored live does not match snapshot content" >&2
    echo "      snap: ${snap}" >&2
    echo "      live: ${live_out}" >&2
    diff -u "${snap_fp}" "${live_fp}" >&2 || true
    rm -f "${live_fp}" "${snap_fp}"
    return 1
  fi
  rm -f "${live_fp}" "${snap_fp}"
  return 0
}

# Post-sync live verification. Args: live_out version expected_title_substr
verify_live_out() {
  local live_out="$1"
  local version="$2"
  local title_needle="${3:-Onyx — talk, stream, and stay with your people}"

  if [[ ! -f "${live_out}/index.html" ]]; then
    echo "FAIL: live index.html missing after sync" >&2
    return 1
  fi
  if ! grep -q "${title_needle}" "${live_out}/index.html"; then
    echo "FAIL: live index.html does not contain expected public title/metadata:" >&2
    echo "      needle: ${title_needle}" >&2
    echo "      file:   ${live_out}/index.html" >&2
    return 1
  fi
  if [[ ! -f "${live_out}/app/index.html" ]]; then
    echo "FAIL: live app/index.html missing after sync" >&2
    return 1
  fi
  if [[ ! -f "${live_out}/sw.js" ]]; then
    echo "FAIL: live sw.js missing after sync" >&2
    return 1
  fi
  if ! grep -q "onyx-shell-${version}" "${live_out}/sw.js"; then
    echo "FAIL: live sw.js version stamp mismatch (expected onyx-shell-${version})" >&2
    return 1
  fi
  return 0
}

# Sync staged → live with active-client asset compatibility retention.
# Phase 1: rsync root --archive --delete, excluding top-level /assets/
#          (never --delete-excluded — preserves prior live/assets/).
# Phase 2: mkdir live/assets; rsync staged/assets/ → live/assets/ WITHOUT
#          --delete so prior immutable hashed assets survive.
# Both phases share the same rollback path on any failure.
# Args: staged live_out version
# Env override for tests: ONYX_DEPLOY_FORCE_VERIFY_FAIL=1 treats verify as failed.
sync_live_with_rollback() {
  local staged="$1"
  local live_out="$2"
  local version="$3"
  local snap had_snap=0
  local sync_rc=0
  local reason=""

  snap="$(snapshot_path_for "${live_out}" "${version}")"
  if [[ -d "${snap}" ]]; then
    had_snap=1
  fi

  mkdir -p "${live_out}"

  # Phase 1 — root tree: delete stale non-assets; leave live/assets alone.
  # --exclude='/assets/' is path-relative to the transfer root. Never pass
  # delete-excluded (that would purge retained hashed assets).
  # --checksum: after hard-link snapshot, size+mtime can match while content
  # differs; content identity is required for a correct live cutover.
  echo "==> syncing root (exclude /assets/, --delete) ${staged}/ -> ${live_out}/"
  if ! rsync --archive --checksum --delete --exclude='/assets/' "${staged}/" "${live_out}/"; then
    sync_rc=1
    reason="rsync_root_failed"
    echo "FAIL: rsync root --archive --checksum --delete (exclude /assets/) failed: ${staged}/ -> ${live_out}/" >&2
  elif [[ -d "${staged}/assets" ]]; then
    # Phase 2 — current hashed assets only; no --delete (retain legacy).
    echo "==> syncing assets (no --delete; retain legacy hashed assets) ${staged}/assets/ -> ${live_out}/assets/"
    mkdir -p "${live_out}/assets"
    if ! rsync --archive --checksum "${staged}/assets/" "${live_out}/assets/"; then
      sync_rc=1
      reason="rsync_assets_failed"
      echo "FAIL: rsync assets --archive --checksum (no --delete) failed: ${staged}/assets/ -> ${live_out}/assets/" >&2
    fi
  fi

  if [[ "${sync_rc}" -eq 0 ]]; then
    if [[ "${ONYX_DEPLOY_FORCE_VERIFY_FAIL:-0}" == "1" ]]; then
      sync_rc=1
      reason="post_sync_verify_forced_fail"
      echo "FAIL: post-sync verification forced failure (ONYX_DEPLOY_FORCE_VERIFY_FAIL=1)" >&2
    elif ! verify_live_out "${live_out}" "${version}"; then
      sync_rc=1
      reason="post_sync_verify_failed"
      echo "FAIL: post-sync verification failed" >&2
    elif ! verify_staged_in_live "${staged}" "${live_out}"; then
      sync_rc=1
      reason="post_sync_content_mismatch"
      echo "FAIL: staged-to-live content verification failed" >&2
    fi
  fi

  if [[ "${sync_rc}" -eq 0 ]]; then
    return 0
  fi

  # Failure path: automatic restore, prove, then nonzero.
  if [[ "${had_snap}" != "1" ]]; then
    echo "FAIL: no recoverable snapshot at ${snap}; refuse silent partial live state" >&2
    echo "RECOVERY_EVIDENCE: result=snapshot_missing reason=${reason} snap=${snap} live=${live_out}" >&2
    return 1
  fi

  echo "==> attempting automatic restore from ${snap}" >&2
  if ! restore_live_out_from_snapshot "${live_out}" "${version}"; then
    echo "FAIL: automatic restore failed" >&2
    echo "RECOVERY_EVIDENCE: result=restore_failed reason=${reason} snap=${snap} live=${live_out}" >&2
    return 1
  fi

  if ! prove_snapshot_restored "${live_out}" "${snap}"; then
    echo "FAIL: restore ran but rollback cannot be proven — fail closed" >&2
    echo "RECOVERY_EVIDENCE: result=restore_unproven reason=${reason} snap=${snap} live=${live_out}" >&2
    return 1
  fi

  echo "RECOVERY_EVIDENCE: result=restore_proven reason=${reason} snap=${snap} live=${live_out}" >&2
  echo "FAIL: deploy aborted after proven rollback (reason=${reason})" >&2
  return 1
}

print_would_sync() {
  local staged="$1"
  local live_out="$2"
  echo "==> DRY RUN: would rsync --archive --checksum --delete --exclude=/assets/ ${staged}/ -> ${live_out}/"
  if [[ -d "${staged}/assets" ]]; then
    echo "==> DRY RUN: would mkdir -p ${live_out}/assets"
    echo "==> DRY RUN: would rsync --archive --checksum (no --delete) ${staged}/assets/ -> ${live_out}/assets/"
  fi
  echo "==> DRY RUN: staged top-level entries:"
  # shellcheck disable=SC2012
  ls -1A "${staged}" | sed 's/^/    /'
}

# ---------------------------------------------------------------------------
# Main deploy
# ---------------------------------------------------------------------------

deploy_main() {
  local live_out live_parent version git_short dirty_flag web_user
  local spa_fp_before spa_fp_after

  validate_dry_run "${DRY_RUN}" || exit 1

  live_out="$(resolve_live_out "${ROOT}")" \
    || { echo "FAIL: invalid ONYX_LIVE_OUT"; exit 1; }

  echo "==> resolved live target: ${live_out}"
  if [[ "${DRY_RUN}" == "1" ]]; then
    echo "==> DEPLOY_DRY_RUN=1 — will not touch live target, ACL, backup, or rsync"
  fi

  git_short="$(git rev-parse --short HEAD 2>/dev/null || echo local)"
  dirty_flag="$(is_source_dirty)"
  version="$(compose_version "" "${git_short}" "${dirty_flag}")"
  if [[ "${dirty_flag}" == "1" ]]; then
    echo "==> source tree is dirty — version stamp will include -dirty suffix"
  fi
  echo "==> release version: ${version}"

  test -d "${LANDING}" \
    || { echo "FAIL: ${LANDING} missing — cannot stage legacy support resources"; exit 1; }

  assert_no_spa_owned_in_landing_dist "${LANDING}/dist" || exit 1

  echo "==> building static export -> dist/"
  NODE_OPTIONS="--disable-warning=DEP0205" pnpm build

  test -f dist/index.html || { echo "FAIL: dist/index.html missing — build broken, NOT deploying"; exit 1; }
  test -f dist/sw.js      || { echo "FAIL: dist/sw.js missing"; exit 1; }

  # Guard: Vite root must still be the Solid Landing after build.
  grep -q "Onyx — talk, stream, and stay with your people" dist/index.html \
    || { echo "FAIL: dist/index.html missing authoritative public title — refusing deploy"; exit 1; }

  # SPA route entrypoints. solid-router is client-routed but the build emits only
  # dist/index.html; hard loads need materialised documents with route metadata.
  echo "==> materialising route-correct SPA entrypoints"
  node tools/materialize-route-entrypoints.mjs dist

  test -f dist/app/index.html \
    || { echo "FAIL: dist/app/index.html missing after materialise"; exit 1; }
  test -f dist/download/index.html \
    || { echo "FAIL: dist/download/index.html missing after materialise"; exit 1; }

  # Optional: stage site-local FreeBSD/OpenBSD release artifacts (never the default).
  # Binaries are not committed; operators must produce them via desktop:release:*.
  if [[ "${ONYX_STAGE_BSD_DOWNLOADS:-0}" == "1" || "${ONYX_PUBLISH_BSD_DOWNLOADS:-0}" == "1" ]]; then
    echo "==> staging BSD download artifacts into dist/downloads/ (explicit env)"
    stage_args=()
    if [[ "${ONYX_PUBLISH_BSD_DOWNLOADS:-0}" == "1" ]]; then
      stage_args+=(--require)
    fi
    node tools/stage-bsd-downloads.mjs "${stage_args[@]}" \
      || { echo "FAIL: stage-bsd-downloads failed (publish mode fails closed when artifacts missing)"; exit 1; }
  else
    echo "==> skipping BSD download artifact staging (set ONYX_STAGE_BSD_DOWNLOADS=1 to enable)"
  fi

  echo "==> stamping service-worker cache: onyx-shell-${version}"
  sed -i "s/onyx-shell-__BUILD_VERSION__/onyx-shell-${version}/" dist/sw.js
  grep -q "onyx-shell-${version}" dist/sw.js \
    || { echo "FAIL: sw.js placeholder not found — check public/sw.js has 'onyx-shell-__BUILD_VERSION__'"; exit 1; }

  # Build legacy landing only to harvest allowlisted support resources.
  echo "==> building legacy landing (allowlisted support resources only)"
  (cd "${LANDING}" && node build.mjs >/dev/null && node build.mjs --check >/dev/null)
  test -d "${LANDING}/dist" \
    || { echo "FAIL: ${LANDING}/dist missing after landing build"; exit 1; }

  # Fingerprint SPA-owned root/route outputs BEFORE legacy support staging.
  spa_fp_before="$(mktemp "${TMPDIR:-/tmp}/onyx-spa-fp-before.XXXXXX")"
  spa_fp_after="$(mktemp "${TMPDIR:-/tmp}/onyx-spa-fp-after.XXXXXX")"
  fingerprint_spa_owned "${ROOT}/dist" >"${spa_fp_before}" \
    || { rm -f "${spa_fp_before}" "${spa_fp_after}"; exit 1; }

  echo "==> staging allowlisted legacy support into dist/ (never root/SPA-owned)"
  local entry
  for entry in "${LEGACY_SUPPORT_ALLOWLIST[@]}"; do
    stage_legacy_entry "${LANDING}/dist" "${ROOT}/dist" "${entry}" || {
      rm -f "${spa_fp_before}" "${spa_fp_after}"
      exit 1
    }
  done

  fingerprint_spa_owned "${ROOT}/dist" >"${spa_fp_after}" \
    || { rm -f "${spa_fp_before}" "${spa_fp_after}"; exit 1; }
  assert_spa_fingerprints_unchanged "${spa_fp_before}" "${spa_fp_after}" \
    || { rm -f "${spa_fp_before}" "${spa_fp_after}"; exit 1; }
  rm -f "${spa_fp_before}" "${spa_fp_after}"
  echo "==> SPA-owned fingerprints unchanged after legacy support staging"

  # Explicitly ensure we did not copy landing index (landing index lacks data-theme=ocean).
  if grep -q 'class="no-js"' dist/index.html 2>/dev/null && ! grep -q 'data-theme=' dist/index.html; then
    echo "FAIL: dist/index.html looks like legacy landing root — overlay bug" >&2
    exit 1
  fi

  echo "==> normalising static asset permissions on staged dist/"
  find dist -type d -exec chmod 0755 {} +
  find dist -type f -exec chmod 0644 {} +

  if [[ "${DRY_RUN}" == "1" ]]; then
    print_would_sync "${ROOT}/dist" "${live_out}"
    echo "==> DRY RUN complete — live target untouched: ${live_out}"
    echo "==> staged release would be onyx-shell-${version}"
    return 0
  fi

  # Recoverable hard-link snapshot BEFORE any live ACL or content mutation.
  backup_live_out "${live_out}" "${version}" || exit 1

  # ACL / traverse for nginx — scoped to the live target's parent only.
  # Runs only after a successful snapshot (or intentional skip for empty/missing).
  web_user="${ONYX_WEB_USER:-http}"
  live_parent="$(dirname "${live_out}")"
  if id -u "${web_user}" >/dev/null 2>&1; then
    command -v setfacl >/dev/null 2>&1 \
      || { echo "FAIL: setfacl is required to grant ${web_user} traverse access to ${live_parent}"; exit 1; }
    echo "==> ensuring ${web_user} can traverse live parent ${live_parent}"
    setfacl -m "u:${web_user}:--x" "${live_parent}"
  fi

  sync_live_with_rollback "${ROOT}/dist" "${live_out}" "${version}" || exit 1

  echo "==> deployed onyx-shell-${version}"
  echo "==> live root: ${live_out}"
  echo "==> public:    https://eshmaki.me (nginx must root at the live out above)"
}

# ---------------------------------------------------------------------------
# Optional self-test entry (invoked by tools/deploy-controller.test.sh)
# ---------------------------------------------------------------------------

if [[ "${1:-}" == "--print-version" ]]; then
  git_short="$(git rev-parse --short HEAD 2>/dev/null || echo local)"
  dirty_flag="$(is_source_dirty)"
  compose_version "" "${git_short}" "${dirty_flag}"
  exit 0
fi

if [[ "${1:-}" == "--validate-live-out" ]]; then
  # Args: --validate-live-out <path>
  # Explicit CLI paths are treated as "supplied": reject raw relatives first.
  raw="${2:-}"
  if [[ -z "${raw}" ]]; then
    echo "FAIL: live out path is empty" >&2
    exit 1
  fi
  if [[ "${raw}" != /* ]]; then
    echo "FAIL: ONYX_LIVE_OUT must be an absolute path when supplied (got: ${raw})" >&2
    exit 1
  fi
  candidate="$(normalize_abs_path "${raw}")" || exit 1
  validate_live_out "${candidate}" "${ROOT}"
  exit $?
fi

if [[ "${1:-}" == "--resolve-live-out" ]]; then
  # Resolve using current env ONYX_LIVE_OUT (may be unset → checkout default).
  resolve_live_out "${ROOT}"
  exit $?
fi

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  deploy_main "$@"
fi
