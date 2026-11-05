import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const pinned = Object.freeze({ pnpm: '10.33.0', elm: '0.19.1', elmTest: '0.19.1-revision17' });

function find(name, envName) {
  if (process.env[envName]) return resolve(process.env[envName]);
  for (const directory of (process.env.PATH ?? '').split(':')) {
    const candidate = resolve(directory, name);
    try { if (statSync(candidate).isFile()) return candidate; } catch { /* try next PATH entry */ }
  }
  return null;
}

function versionRecord(root, path) {
  if (!path) return { available: false };
  const real = realpathSync(path);
  try {
    const version = execFileSync(real, ['--version'], { cwd: root, encoding: 'utf8' }).trim();
    let cursor = dirname(real);
    let packageJson = null;
    let packageLock = null;
    for (let depth = 0; depth < 6; depth += 1) {
      const packagePath = resolve(cursor, 'package.json');
      if (!packageJson && existsSync(packagePath)) packageJson = packagePath;
      const lockPath = resolve(cursor, 'pnpm-lock.yaml');
      if (existsSync(lockPath)) { packageLock = lockPath; break; }
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
    return {
      available: true,
      path: relative(root, real),
      version,
      sha256: sha256(readFileSync(real)),
      packageJson: packageJson ? { path: relative(root, packageJson), sha256: sha256(readFileSync(packageJson)) } : null,
      pnpmLock: packageLock ? { path: relative(root, packageLock), sha256: sha256(readFileSync(packageLock)) } : null,
    };
  } catch (error) {
    return { available: false, path: relative(root, real), error: String(error.message || error) };
  }
}

export function collectToolProvenance(root) {
  const nodePath = realpathSync(process.execPath);
  const pnpm = versionRecord(root, find('pnpm', 'PNPM_BIN'));
  const elm = versionRecord(root, find('elm', 'ELM_BIN'));
  const elmTest = versionRecord(root, find('elm-test', 'ELM_TEST_BIN'));
  const lockPath = resolve(root, 'pnpm-lock.yaml');
  const packagePath = resolve(root, 'node_modules/.pnpm');
  let wrapper = null;
  let native = null;
  let esbuildPackage = null;
  try {
    const entries = lstatSync(packagePath).isDirectory() ? readdirSync(packagePath) : [];
    const selected = entries.filter(name => name.startsWith('esbuild@')).sort().at(-1);
    if (selected) {
      const packageRoot = resolve(packagePath, selected, 'node_modules/esbuild');
      const packageJsonBytes = readFileSync(resolve(packageRoot, 'package.json'));
      const packageJson = JSON.parse(packageJsonBytes.toString('utf8'));
      const wrapperPath = resolve(packageRoot, 'bin/esbuild');
      const wrapperBytes = readFileSync(wrapperPath);
      const platformPackage = `@esbuild/${process.platform}-${process.arch}`;
      const platformRoot = resolve(packagePath, `${platformPackage.replace('/', '+')}@${packageJson.version}`, 'node_modules', platformPackage);
      const nativePath = resolve(platformRoot, 'bin/esbuild');
      wrapper = { path: relative(root, realpathSync(wrapperPath)), packageVersion: packageJson.version, packageJsonSha256: sha256(packageJsonBytes), wrapperSha256: sha256(wrapperBytes) };
      try {
        const nativeReal = realpathSync(nativePath);
        native = { path: relative(root, nativeReal), version: execFileSync(nativeReal, ['--version'], { encoding: 'utf8' }).trim(), sha256: sha256(readFileSync(nativeReal)) };
      } catch { native = { available: false }; }
      esbuildPackage = { selectedEntry: selected, packageVersion: packageJson.version, selection: 'lexicographically last esbuild@ entry, matching tools/build-elm-site.mjs' };
    }
  } catch { /* a missing optional build tool is recorded as incomplete */ }
  const complete = pnpm.available && pnpm.version === pinned.pnpm
    && elm.available && elm.version === pinned.elm
    && elmTest.available && elmTest.version === pinned.elmTest && elmTest.pnpmLock
    && esbuildPackage && wrapper && native?.sha256;
  return {
    provenanceComplete: Boolean(complete),
    pinnedToolVersions: pinned,
    node: { version: process.version, path: relative(root, nodePath), sha256: sha256(readFileSync(nodePath)) },
    pnpm,
    elm,
    elmTest,
    esbuild: { package: esbuildPackage, wrapper, nativeBinary: native },
    pnpmLockSha256: sha256(readFileSync(lockPath)),
    minificationSelection: 'build-elm-site.mjs selects lexicographically last vendored esbuild entry; output mode/warnings require a build receipt',
    limitation: 'Missing tool hashes are represented as incomplete provenance; source capture can still be used as a narrower observation.',
  };
}
