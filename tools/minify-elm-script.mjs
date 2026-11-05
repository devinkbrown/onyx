// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

export function minifyElmScript(esbuild, inputPath, outputPath) {
  // stdin keeps Elm's window export a classic script even inside a package
  // with `type: module`. File input would replace top-level this with undefined.
  const output = execFileSync(process.execPath, [esbuild, '--loader=js', '--minify'], {
    input: readFileSync(inputPath),
    maxBuffer: 32 * 1024 * 1024,
  });
  writeFileSync(outputPath, output);
}
