import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { selectClosure } from './source-closure.mjs';

const temporaryRoots = [];
after(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

test('source closure binds pinned tool and workspace patch inputs without widening installed dependency capture', () => {
  const root = mkdtempSync(join(tmpdir(), 'onyx-source-closure-'));
  temporaryRoots.push(root);
  execFileSync('git', ['init', '--quiet', root]);

  const files = [
    'elm/elm.json', 'elm/src/Main.elm', 'elm/src/App.elm', 'elm/src/Wire.elm',
    'elm/src/Session.elm', 'elm/ports.js', 'elm/tests/BoundaryTest.elm',
    'elm/tools/closure-helper.mjs', 'package.json', 'pnpm-lock.yaml',
    'pnpm-workspace.yaml', '.zigversion', 'patches/@native-sdk__cli@0.6.2.patch',
    'tsconfig.json', 'eslint.config.mjs', '.github/workflows/elm-client.yml',
    'tools/build-elm-site.mjs', 'tools/materialize-elm-routes.mjs',
    'tools/materialize-route-entrypoints.mjs', 'tools/minify-elm-script.mjs',
    'tools/serve-dir.mjs', 'public/brand/mark.png', 'public/brand/mascot-still.png',
    'public/manifest.json', 'public/favicon.ico', 'public/favicon.svg',
    'public/favicon-32.png', 'public/apple-touch-icon.png', 'public/icon-192.png',
    'public/icon-192-maskable.png', 'public/icon-512.png', 'public/icon-512-maskable.png',
    'public/og.png', 'public/robots.txt', 'public/sitemap.xml',
    'ONYX_SERVER_PROTOCOL.md', 'src/app.ts', 'tests/app.test.ts', 'docs/readme.md',
    'src/lib/private-fixtures/marker.txt', 'node_modules/example/index.js',
  ];
  const directories = ['elm/tests', 'elm/tools', 'src', 'tests', 'public', 'docs'];
  for (const directory of directories) mkdirSync(join(root, directory), { recursive: true });
  for (const path of files) {
    const target = join(root, path);
    mkdirSync(resolve(target, '..'), { recursive: true });
    writeFileSync(target, `fixture:${path}\n`);
  }
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['add', '-f', 'node_modules/example/index.js'], { cwd: root });

  const closure = selectClosure(root);
  assert.ok(closure.paths.includes('.zigversion'));
  assert.ok(closure.paths.includes('patches/@native-sdk__cli@0.6.2.patch'));
  assert.ok(closure.paths.includes('pnpm-workspace.yaml'));
  assert.ok(!closure.paths.includes('node_modules/example/index.js'));
  assert.ok(!closure.paths.includes('src/lib/private-fixtures/marker.txt'));
  assert.ok(closure.requiredInputs.includes('.zigversion'));
  assert.ok(closure.requiredInputs.includes('patches/@native-sdk__cli@0.6.2.patch'));
});
