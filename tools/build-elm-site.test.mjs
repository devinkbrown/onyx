// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment node
import { expect, it } from 'vitest';
import { computeRuntimeShellRef } from './build-elm-site.mjs';

const schemas = { vault: 5, privateCrypto: 2, platform: 1, tabIntents: 1, localWorkspaces: 1 };

it('binds the raw service worker source into a deterministic runtime shell reference', () => {
  const files = [
    { path: '/app.js', bytes: Buffer.from('app') },
    { path: '/index.html', bytes: Buffer.from('<meta content="__ONYX_PUBLIC_INDEX_SHELL_REF__">') },
    { path: '/ports.js', bytes: Buffer.from('ports') },
    { path: '/runtime.js', bytes: Buffer.from("shellRef: '__ONYX_PUBLIC_RUNTIME_SHELL_REF__'") },
    { path: '/sw.js', bytes: Buffer.from('const BUILD = __ONYX_SW_BUILD_CONFIG__;') },
  ];

  const first = computeRuntimeShellRef(files, schemas);
  expect(computeRuntimeShellRef(files, schemas)).toBe(first);
  expect(computeRuntimeShellRef(files.map((file) => file.path === '/sw.js'
    ? { ...file, bytes: Buffer.from('const BUILD = changed;') }
    : file), schemas)).not.toBe(first);
});
