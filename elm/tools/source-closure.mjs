// Shared allowlist for the source manifest and frozen source archive. Keep
// inclusion and exclusion behavior in one place so fingerprints and archives
// always describe the same client input closure.
import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';

export const exclusions = Object.freeze([
  '.git/', 'node_modules/', 'elm-stuff/', 'coverage/', 'dist/', 'out/',
  '.cache/', '.pnpm-store/', 'private/', 'secrets/', 'logs/',
]);

const publicFiles = [
  'manifest.json', 'favicon.ico', 'favicon.svg', 'favicon-32.png',
  'apple-touch-icon.png', 'icon-192.png', 'icon-192-maskable.png',
  'icon-512.png', 'icon-512-maskable.png', 'og.png', 'robots.txt', 'sitemap.xml',
].map(path => `public/${path}`);
const exact = new Set([
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc',
  // Reproducible toolchain and local patched dependency required by the workspace.
  '.zigversion', 'patches/@native-sdk__cli@0.6.2.patch',
  'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'eslint.config.mjs',
  'vite.config.ts', 'vitest.config.ts', 'vitest.setup.ts', 'playwright.config.ts',
  'index.html', '.browserslistrc', 'postcss.config.js', 'tailwind.config.js',
  '.github/workflows/elm-client.yml',
  'tools/build-elm-site.mjs', 'tools/materialize-elm-routes.mjs',
  'tools/materialize-route-entrypoints.mjs', 'tools/minify-elm-script.mjs',
  'tools/minify-elm-script.test.mjs', 'tools/serve-dir.mjs', 'tools/serve-dir.test.mjs',
  'tools/elm-client-contract.test.mjs', 'tools/check-server-contract.mjs',
  'tools/check-server-contract-v2.mjs', 'tools/check-server-contract.test.mjs',
  'tools/check-server-contract-v2.test.mjs', 'tools/check-landing-eager-budget.mjs',
  'tools/check-route-entrypoints.mjs', 'tools/check-vault-schema.mjs',
  'tools/check-elm-storage-schema.mjs', 'tools/check-elm-contracts.mjs',
  'tools/check-elm-source.mjs', 'tools/check-elm-client-build.mjs',
  'CLAUDE.md', 'CONTRIBUTING.md', 'docs/README.md', 'docs/architecture.md',
  'ONYX_SERVER_PROTOCOL.md',
  'AGENTS.md',
  ...publicFiles,
]);
const required = [
  'elm/elm.json', 'elm/src/Main.elm', 'elm/src/App.elm', 'elm/src/Wire.elm',
  'elm/src/Session.elm', 'elm/ports.js', 'elm/tests', 'elm/tools',
  'src', 'tests', 'public', 'docs',
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.zigversion',
  'patches/@native-sdk__cli@0.6.2.patch', 'tsconfig.json', 'eslint.config.mjs',
  '.github/workflows/elm-client.yml', 'tools/build-elm-site.mjs',
  'tools/materialize-elm-routes.mjs', 'tools/materialize-route-entrypoints.mjs',
  'tools/minify-elm-script.mjs', 'tools/serve-dir.mjs',
  'public/brand/mark.png', 'public/brand/mascot-still.png', ...publicFiles,
  'ONYX_SERVER_PROTOCOL.md',
];
const inScope = path => path.startsWith('elm/') || path.startsWith('src/')
  || path.startsWith('public/') || path.startsWith('tests/')
  || path.startsWith('docs/') || path.startsWith('.github/workflows/')
  || exact.has(path) || path.startsWith('tools/');
const isExcluded = path => exclusions.some(prefix => path === prefix.slice(0, -1) || path.startsWith(prefix))
  || path === 'private' || path.startsWith('private/')
  || path.split('/').some(segment => ['secrets', 'logs', 'private-fixtures', 'secret-fixtures'].includes(segment))
  || /^\.env(?:\.|$)/.test(path.split('/').at(-1) ?? '')
  || /\.(?:key|pem|log)$/i.test(path);

export function selectClosure(root) {
  const absoluteRoot = realpathSync(root);
  const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: absoluteRoot })
    .toString('utf8').split('\0').filter(Boolean).sort();
  const missing = required.filter(path => !listed.some(name => name === path || name.startsWith(`${path}/`)));
  if (missing.length) throw new Error(`Required source inputs missing: ${missing.join(', ')}`);
  const selected = listed.filter(path => !isExcluded(path) && inScope(path));
  for (const path of selected) {
    if (path.includes('\n') || path.includes('\r') || path.includes('\0') || path.startsWith('/') || path.split('/').includes('..')) {
      throw new Error(`Unsupported source path: ${JSON.stringify(path)}`);
    }
    const absolute = resolve(absoluteRoot, path);
    if (!absolute.startsWith(`${absoluteRoot}/`)) throw new Error(`Source path escapes repository: ${path}`);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      const target = realpathSync(absolute);
      const rel = relative(absoluteRoot, target);
      if (rel === '..' || rel.startsWith('../')) throw new Error(`Source symlink escapes repository: ${path}`);
      throw new Error(`Source symlinks are not supported in a reproducible cut: ${path}`);
    }
    if (!stat.isFile()) throw new Error(`Expected source file: ${path}`);
  }
  return { root: absoluteRoot, paths: selected, exclusions: [...exclusions], requiredInputs: [...required], selectorVersion: 'onyx-elm-full-client-closure-v2' };
}
