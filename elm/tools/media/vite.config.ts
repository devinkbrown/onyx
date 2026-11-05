// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type BuildOptions } from 'vite';

const ROOT = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const ENTRY = path.resolve(ROOT, 'elm/runtime/media-entry.ts');

async function filesBelow(root: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, item.name);
      if (item.isSymbolicLink()) throw new Error(`Symlink in media output: ${path.relative(root, absolute)}`);
      if (item.isDirectory()) await visit(absolute);
      else if (item.isFile()) result.push(absolute);
    }
  };
  await visit(root);
  return result.sort((a, b) => a.localeCompare(b));
}

/** Build the browser-only Cadence bundle into a caller-owned stage directory. */
export async function buildMediaRuntime(stageDir: string): Promise<{
  readonly entry: string;
  readonly chunks: readonly string[];
  readonly workers: readonly string[];
  readonly codecAssets: readonly { readonly path: string; readonly sha256: string; readonly bytes: number }[];
  readonly files: readonly { readonly path: string; readonly sha256: string; readonly bytes: number }[];
}> {
  const stageAbsolute = path.resolve(stageDir);
  await mkdir(stageAbsolute, { recursive: true });
  const stageReal = await realpath(stageAbsolute);
  const output = path.join(stageReal, 'media-runtime');
  if (!output.startsWith(`${stageReal}${path.sep}`)) throw new Error('Media output escapes stage');
  await mkdir(output, { recursive: true });

  const options: BuildOptions = {
    configFile: false,
    root: ROOT,
    publicDir: false,
    resolve: { alias: { '@': path.resolve(ROOT, 'src') } },
    build: {
      target: 'es2022',
      outDir: output,
      emptyOutDir: false,
      manifest: 'manifest.json',
      sourcemap: false,
      minify: true,
      rollupOptions: {
        input: ENTRY,
        output: {
          format: 'es',
          entryFileNames: 'media-entry-[hash].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  };
  await build(options);

  const codecAssets: { path: string; sha256: string; bytes: number }[] = [];
  for (const name of ['opcodec_wasm.js', 'opcodec_wasm.wasm']) {
    const source = path.join(ROOT, 'public', name);
    const destination = path.join(stageReal, name);
    await copyFile(source, destination);
    const bytes = await readFile(destination);
    codecAssets.push({ path: `/${name}`, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength });
  }
  const builtFiles = await filesBelow(output);
  const files = await Promise.all(builtFiles.map(async absolute => {
    const bytes = await readFile(absolute);
    const mode = (await stat(absolute)).mode & 0o777;
    if (mode & 0o022) throw new Error(`Writable-by-group/media artifact: ${path.relative(stageReal, absolute)}`);
    return { path: `/${path.relative(stageReal, absolute).split(path.sep).join('/')}`, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength };
  }));
  const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8')) as Record<string, { file?: string; isEntry?: boolean; isDynamicEntry?: boolean }>;
  const entry = Object.values(manifest).find(item => item.isEntry)?.file;
  if (!entry) throw new Error('Media entry missing from generated manifest');
  const workers = files.filter(item => /worker|videoEncodeWorker/iu.test(item.path)).map(item => item.path);
  return {
    entry: `/media-runtime/${entry}`,
    chunks: files.filter(item => item.path.includes('/chunks/')).map(item => item.path),
    workers,
    codecAssets,
    files: [...files, ...codecAssets],
  };
}

export default { root: ROOT, publicDir: false };
