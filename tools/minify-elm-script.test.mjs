// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { minifyElmScript } from './minify-elm-script.mjs';

it('preserves Elm browser exports when staging inside a module package', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'onyx-elm-minify-'));
  try {
    await writeFile(resolve(directory, 'package.json'), '{"type":"module"}');
    const input = resolve(directory, 'app.js');
    const output = resolve(directory, 'app.min.js');
    // The Elm compiler publishes its entrypoint through this outer wrapper.
    await writeFile(input, '(function(scope){"use strict";scope.Elm={Main:{init:function(){return "mounted";}}};})(this);');
    const entries = await readdir(resolve('node_modules/.pnpm'));
    const version = entries.filter((entry) => entry.startsWith('esbuild@')).sort().at(-1);
    expect(version).toBeDefined();
    minifyElmScript(resolve('node_modules/.pnpm', version, 'node_modules/esbuild/bin/esbuild'), input, output);
    const browser = {};
    runInNewContext(await readFile(output, 'utf8'), browser);
    expect(browser.Elm.Main.init()).toBe('mounted');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
