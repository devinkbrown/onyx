import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const exactKeys = (value, expected, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) throw new Error(`${label} has unknown or missing keys: ${actual.join(', ')}`);
};
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const EXPECTED_PACKAGE_IDS = 'E00 E01 E02 E03 E04 E10 E11 E12 E13 E14 E20 E21 E22 E23 E24 E30 E31 E32 E33 E34 E35 E40 E41 E42 E43 E44 E50 E51 E52 E53 E60 E61 E62 E63 E64 E70 E71 E72 E73 E74 E80 E81 E82 E83 E84 E90 E91 E92 E100 E101 E102 E103 E104'.split(' ');

function repositoryFile(root, relativePath, label) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || relativePath.includes('\\')
    || relativePath.includes('\0') || isAbsolute(relativePath)) throw new Error(`${label} must be a repository-relative path`);
  const absolute = resolve(root, relativePath);
  const lexical = relative(root, absolute);
  if (lexical === '..' || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) throw new Error(`${label} escapes the repository`);
  let real;
  try { real = realpathSync(absolute); } catch { throw new Error(`${label} does not exist: ${relativePath}`); }
  const realRelative = relative(root, real);
  if (realRelative === '..' || realRelative.startsWith(`..${sep}`) || isAbsolute(realRelative)) throw new Error(`${label} resolves outside the repository`);
  if (lstatSync(absolute).isSymbolicLink() || !statSync(absolute).isFile()) throw new Error(`${label} must be a regular, non-symlink file`);
  return readFileSync(absolute);
}

function validateArtifactList(value, root, label) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must contain at least one artifact`);
  const paths = new Set();
  for (const [index, artifact] of value.entries()) {
    exactKeys(artifact, ['path', 'sha256'], `${label}[${index}]`);
    if (typeof artifact.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(artifact.sha256)) throw new Error(`${label}[${index}] has an invalid SHA-256`);
    const bytes = repositoryFile(root, artifact.path, `${label}[${index}].path`);
    if (sha256(bytes) !== artifact.sha256) throw new Error(`${label}[${index}] SHA-256 does not match current bytes`);
    paths.add(artifact.path);
  }
  return paths;
}

function validateApplicability(value, evidencePaths, label) {
  exactKeys(value, ['configuration', 'deployment'], label);
  for (const key of ['configuration', 'deployment']) {
    const item = value[key];
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${label}.${key} must declare applicability`);
    if (item.status === 'not-applicable') {
      exactKeys(item, ['status', 'reason'], `${label}.${key}`);
      if (!nonempty(item.reason)) throw new Error(`${label}.${key} needs a reason when not applicable`);
    } else if (item.status === 'applicable') {
      exactKeys(item, ['status', 'evidenceArtifacts'], `${label}.${key}`);
      if (!Array.isArray(item.evidenceArtifacts) || item.evidenceArtifacts.length === 0
        || item.evidenceArtifacts.some(path => typeof path !== 'string' || !evidencePaths.has(path))) {
        throw new Error(`${label}.${key} must reference verified evidence artifacts for that observation`);
      }
    } else {
      throw new Error(`${label}.${key} has unknown applicability status`);
    }
  }
}

function validateAcceptanceReview(row, kind, root) {
  if (typeof row.acceptanceReview !== 'string') throw new Error(`${kind} ${row.id} is accepted without acceptanceReview`);
  const bytes = repositoryFile(root, row.acceptanceReview, `${kind} ${row.id} acceptanceReview`);
  let review;
  try { review = JSON.parse(bytes.toString('utf8')); } catch { throw new Error(`${kind} ${row.id} acceptanceReview is not valid JSON`); }
  exactKeys(review, ['schemaVersion', 'itemId', 'scope', 'reviewer', 'verdict', 'summary', 'sourceArtifacts', 'evidenceArtifacts', 'applicability'], `review ${row.id}`);
  if (review.schemaVersion !== 1 || review.itemId !== row.id || review.verdict !== 'accepted' || !nonempty(review.summary)) {
    throw new Error(`${kind} ${row.id} review does not explicitly accept this item`);
  }
  exactKeys(review.scope, ['kind', 'id'], `review ${row.id}.scope`);
  if (review.scope.kind !== kind || review.scope.id !== row.id) throw new Error(`${kind} ${row.id} review scope does not match`);
  exactKeys(review.reviewer, ['name', 'role'], `review ${row.id}.reviewer`);
  if (!nonempty(review.reviewer.name) || !nonempty(review.reviewer.role)) throw new Error(`${kind} ${row.id} review needs an explicit reviewer and role`);
  const sourcePaths = validateArtifactList(review.sourceArtifacts, root, `review ${row.id}.sourceArtifacts`);
  const evidencePaths = validateArtifactList(review.evidenceArtifacts, root, `review ${row.id}.evidenceArtifacts`);
  const ledgerPath = 'docs/elm-roadmap/acceptance-ledger.json';
  if ([...sourcePaths, ...evidencePaths].some(path => path === row.acceptanceReview || path === ledgerPath)) {
    throw new Error(`${kind} ${row.id} review artifacts cannot hash the ledger or the review that refers to them`);
  }
  validateApplicability(review.applicability, evidencePaths, `review ${row.id}.applicability`);
}

function validateReviewableStatus(row, kind, root, statusField) {
  const status = row[statusField];
  if (status !== 'pending' && status !== 'accepted') throw new Error(`${kind} ${row.id} has unknown acceptance status: ${String(status)}`);
  if (status === 'accepted') validateAcceptanceReview(row, kind, root);
}

/** Validate fixed roadmap structure and any row-scoped acceptance review against current repository bytes. */
export function validateEvidenceLedger(ledger, repositoryRoot) {
  if (!ledger || ledger.schemaVersion !== 1 || !Array.isArray(ledger.rows) || !Array.isArray(ledger.requirements)) {
    throw new Error('Roadmap evidence ledger schema is incomplete');
  }
  const root = realpathSync(repositoryRoot);
  const packageIds = ledger.rows.map(row => row.id);
  if (JSON.stringify(packageIds) !== JSON.stringify(EXPECTED_PACKAGE_IDS)) {
    throw new Error('Roadmap ledger must preserve all 53 unique E00–E104 packages');
  }
  for (const row of ledger.rows) validateReviewableStatus(row, 'package', root, 'acceptanceStatus');

  const groupIds = new Set();
  for (const group of ledger.requirements) {
    if (!group || typeof group !== 'object' || Array.isArray(group)
      || typeof group.id !== 'string' || group.id.length === 0) {
      throw new Error('Roadmap requirement groups must have a stable id');
    }
    if (groupIds.has(group.id)) throw new Error(`Roadmap ledger has duplicate requirement group id: ${group.id}`);
    groupIds.add(group.id);
  }
  const groups = new Map(ledger.requirements.map(group => [group.id, group]));
  const tests = groups.get('T01-T74')?.requirements;
  const expectedTests = Array.from({ length: 74 }, (_, index) => `T${String(index + 1).padStart(2, '0')}`);
  if (!Array.isArray(tests) || JSON.stringify(tests.map(row => row.id)) !== JSON.stringify(expectedTests)) {
    throw new Error('Roadmap ledger must preserve each T01–T74 scenario individually');
  }
  for (const row of tests) validateReviewableStatus(row, 'scenario', root, 'acceptanceStatus');

  const milestones = groups.get('M0-M10')?.requirements;
  const expectedMilestones = Array.from({ length: 11 }, (_, index) => `M${index}`);
  if (!Array.isArray(milestones) || JSON.stringify(milestones.map(row => row.id)) !== JSON.stringify(expectedMilestones)
    || milestones.some(row => !row.sourceAnchor || !row.dependencies || !row.flags || !row.exitCriteria || !row.rollback || !row.serverGate)) {
    throw new Error('Every M0–M10 milestone needs its source anchor, dependencies, flags, exit, rollback, and server gate');
  }
  for (const row of milestones) validateReviewableStatus(row, 'milestone', root, 'status');

  for (const group of ledger.requirements) {
    if (group.id === 'T01-T74' || group.id === 'M0-M10' || !Array.isArray(group.requirements)) continue;
    for (const row of group.requirements) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`${group.id} contains a non-object requirement`);
      const kind = typeof group.kind === 'string' && group.kind.length > 0 ? group.kind : 'requirement';
      if (Object.hasOwn(row, 'acceptanceStatus')) validateReviewableStatus(row, kind, root, 'acceptanceStatus');
      const allowedRowStatuses = group.id === 'R-S3-S11' ? ['definition-needed', 'pending', 'accepted'] : ['pending', 'accepted'];
      if (row.status !== undefined && !allowedRowStatuses.includes(row.status)) {
        throw new Error(`${kind} ${row.id ?? '(unidentified)'} has unknown status: ${String(row.status)}`);
      }
      if (row.status === 'accepted') {
        if (typeof row.id !== 'string' || row.id.length === 0) {
          throw new Error(`${kind} row without a stable id cannot be accepted`);
        }
        validateAcceptanceReview(row, kind, root);
      }
    }
  }

  const values = [];
  const visit = value => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      if (typeof value.sourceAnchor === 'string') values.push(value.sourceAnchor);
      Object.values(value).forEach(visit);
    }
  };
  visit(ledger);
  for (let section = 3; section <= 14; section += 1) {
    const individuallyAnchored = values.some(anchor => new RegExp(`(?:§|section\\s+)${section}(?:\\b|\\s)`, 'iu').test(anchor));
    const rangeAnchored = values.some(anchor => {
      const range = anchor.match(/§§?(\d{1,2})[–-](\d{1,2})/u);
      return range !== null && Number(range[1]) <= section && section <= Number(range[2]);
    });
    if (!individuallyAnchored && !rangeAnchored) throw new Error(`Roadmap ledger lacks an explicit source anchor for §${section}`);
  }
  for (const id of ['R-S3-S11', 'RELEASE-CONTROLS', 'SERVER-PREREQUISITES', 'SECURITY-INVARIANTS']) {
    if (!groups.has(id)) throw new Error(`Roadmap ledger is missing required non-package group: ${id}`);
  }
  if (!ledger.requirements.some(group => group.kind === 'support-matrix' && Array.isArray(group.requirements) && group.requirements.length > 0)) {
    throw new Error('Roadmap ledger must retain explicit browser/support cohorts');
  }
  return { packages: packageIds.length, scenarios: tests.length, milestones: milestones.length,
    acceptedPackages: ledger.rows.filter(row => row.acceptanceStatus === 'accepted').length,
    acceptedScenarios: tests.filter(row => row.acceptanceStatus === 'accepted').length,
    acceptedMilestones: milestones.filter(row => row.status === 'accepted').length };
}
