import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { validateEvidenceLedger } from './validate-roadmap-evidence.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const baseLedger = JSON.parse(readFileSync(join(repositoryRoot, 'docs/elm-roadmap/acceptance-ledger.json'), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const tempRoot = mkdtempSync(join(os.tmpdir(), 'onyx-evidence-ledger-'));
const put = (path, body) => {
  const absolute = join(tempRoot, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, body);
  return { path, sha256: digest(Buffer.from(body)) };
};
const clone = () => structuredClone(baseLedger);
const pendingFixture = () => {
  const ledger = clone();
  for (const row of ledger.rows) { row.acceptanceStatus = 'pending'; delete row.acceptanceReview; }
  for (const group of ledger.requirements) for (const row of group.requirements ?? []) {
    row.acceptanceStatus = 'pending';
    delete row.acceptanceReview;
    if (row.id?.startsWith('M')) { row.status = 'pending'; delete row.acceptanceReview; }
  }
  return ledger;
};

try {
  const actual = validateEvidenceLedger(baseLedger, repositoryRoot);
  assert.equal(actual.packages, 53);
  assert.equal(actual.scenarios, 74);
  assert.equal(actual.milestones, 11);
  assert.equal(actual.acceptedPackages, baseLedger.rows.filter(row => row.acceptanceStatus === 'accepted').length);
  const actualScenarios = baseLedger.requirements.find(group => group.id === 'T01-T74').requirements;
  assert.equal(actual.acceptedScenarios, actualScenarios.filter(row => row.acceptanceStatus === 'accepted').length);
  const actualMilestones = baseLedger.requirements.find(group => group.id === 'M0-M10').requirements;
  assert.equal(actual.acceptedMilestones, actualMilestones.filter(row => row.status === 'accepted').length);

  const pending = validateEvidenceLedger(pendingFixture(), repositoryRoot);
  assert.deepEqual(pending, { packages: 53, scenarios: 74, milestones: 11, acceptedPackages: 0, acceptedScenarios: 0, acceptedMilestones: 0 });

  const duplicateTestGroup = pendingFixture();
  duplicateTestGroup.requirements.push(structuredClone(duplicateTestGroup.requirements.find(group => group.id === 'T01-T74')));
  assert.throws(() => validateEvidenceLedger(duplicateTestGroup, repositoryRoot), /duplicate requirement group id: T01-T74/u);

  const accepted = pendingFixture();
  const packageRow = accepted.rows[0];
  packageRow.acceptanceStatus = 'accepted';
  packageRow.acceptanceReview = 'reviews/E00.json';
  const source = put('inputs/source.txt', 'reviewed source bytes\n');
  const evidence = put('evidence/receipt.json', '{"result":"passed"}\n');
  const review = {
    schemaVersion: 1,
    itemId: 'E00',
    scope: { kind: 'package', id: 'E00' },
    reviewer: { name: 'Independent reviewer', role: 'source review' },
    verdict: 'accepted',
    summary: 'The scoped package claims match the cited source and evidence.',
    sourceArtifacts: [source],
    evidenceArtifacts: [evidence],
    applicability: {
      configuration: { status: 'applicable', evidenceArtifacts: [evidence.path] },
      deployment: { status: 'not-applicable', reason: 'This package is planning-only.' },
    },
  };
  put('reviews/E00.json', `${JSON.stringify(review)}\n`);
  assert.equal(validateEvidenceLedger(accepted, tempRoot).acceptedPackages, 1);

  const acceptedByKind = pendingFixture();
  const scenarioRow = acceptedByKind.requirements.find(group => group.id === 'T01-T74').requirements[0];
  scenarioRow.acceptanceStatus = 'accepted';
  scenarioRow.acceptanceReview = 'reviews/T01.json';
  put('reviews/T01.json', `${JSON.stringify({ ...review, itemId: 'T01', scope: { kind: 'scenario', id: 'T01' } })}\n`);
  const milestoneRow = acceptedByKind.requirements.find(group => group.id === 'M0-M10').requirements[0];
  milestoneRow.status = 'accepted';
  milestoneRow.acceptanceReview = 'reviews/M0.json';
  put('reviews/M0.json', `${JSON.stringify({ ...review, itemId: 'M0', scope: { kind: 'milestone', id: 'M0' } })}\n`);
  const paragraphGroup = acceptedByKind.requirements.find(group => group.id === 'R-S3-S11');
  const paragraphRow = paragraphGroup.requirements[0];
  paragraphRow.acceptanceStatus = 'accepted';
  paragraphRow.acceptanceReview = 'reviews/R03-0001.json';
  put('reviews/R03-0001.json', `${JSON.stringify({ ...review, itemId: 'R03-0001', scope: { kind: paragraphGroup.kind, id: 'R03-0001' } })}\n`);
  const typedAcceptance = validateEvidenceLedger(acceptedByKind, tempRoot);
  assert.equal(typedAcceptance.acceptedScenarios, 1);
  assert.equal(typedAcceptance.acceptedMilestones, 1);

  const cohortWithoutReview = pendingFixture();
  const cohortRow = cohortWithoutReview.requirements.find(group => group.id === 'BROWSER-COHORTS').requirements[0];
  cohortRow.status = 'accepted';
  assert.throws(() => validateEvidenceLedger(cohortWithoutReview, tempRoot), /without acceptanceReview/u);

  const missingReview = pendingFixture();
  missingReview.rows[0].acceptanceStatus = 'accepted';
  assert.throws(() => validateEvidenceLedger(missingReview, repositoryRoot), /without acceptanceReview/u);

  const mismatchedReview = pendingFixture();
  mismatchedReview.rows[0].acceptanceStatus = 'accepted';
  mismatchedReview.rows[0].acceptanceReview = 'reviews/mismatch.json';
  put('reviews/mismatch.json', `${JSON.stringify({ ...review, itemId: 'E01', scope: { kind: 'package', id: 'E01' } })}\n`);
  assert.throws(() => validateEvidenceLedger(mismatchedReview, tempRoot), /does not explicitly accept/u);

  const unknownStatus = pendingFixture();
  unknownStatus.rows[0].acceptanceStatus = 'approved';
  assert.throws(() => validateEvidenceLedger(unknownStatus, repositoryRoot), /unknown acceptance status/u);

  const escaped = pendingFixture();
  escaped.rows[0].acceptanceStatus = 'accepted';
  escaped.rows[0].acceptanceReview = '../outside.json';
  assert.throws(() => validateEvidenceLedger(escaped, repositoryRoot), /repository-relative|escapes/u);

  const badDigest = pendingFixture();
  badDigest.rows[0].acceptanceStatus = 'accepted';
  badDigest.rows[0].acceptanceReview = 'reviews/E00.json';
  const changedReview = { ...review, sourceArtifacts: [{ ...source, sha256: '0'.repeat(64) }] };
  writeFileSync(join(tempRoot, 'reviews/E00.json'), JSON.stringify(changedReview));
  assert.throws(() => validateEvidenceLedger(badDigest, tempRoot), /SHA-256 does not match/u);

  const missingApplicabilityEvidence = pendingFixture();
  missingApplicabilityEvidence.rows[0].acceptanceStatus = 'accepted';
  missingApplicabilityEvidence.rows[0].acceptanceReview = 'reviews/E00.json';
  writeFileSync(join(tempRoot, 'reviews/E00.json'), JSON.stringify({ ...review,
    applicability: { ...review.applicability, configuration: { status: 'applicable', evidenceArtifacts: [] } } }));
  assert.throws(() => validateEvidenceLedger(missingApplicabilityEvidence, tempRoot), /reference verified evidence artifacts/u);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

process.stdout.write('Roadmap evidence ledger smoke passed: pending rows, scoped acceptance, status, path, digest and applicability checks.\n');
