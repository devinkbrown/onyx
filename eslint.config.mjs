// Flat ESLint config for the real stack (SolidJS + TypeScript + Vite).
// The old config imported eslint-config-next, a leftover from the dead
// Next.js era that was never installed — lint had been broken since the port.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import solid from 'eslint-plugin-solid/configs/typescript';

// Globals the Elm client JS uses (browser for ports.js, node for the
// smoke suites); declared explicitly instead of pulling in `globals`.
const ELM_JS_GLOBALS = {
  AbortController: 'readonly',
  Blob: 'readonly',
  BroadcastChannel: 'readonly',
  Buffer: 'readonly',
  CryptoKey: 'readonly',
  CustomEvent: 'readonly',
  File: 'readonly',
  FileReader: 'readonly',
  FormData: 'readonly',
  HTMLElement: 'readonly',
  IDBKeyRange: 'readonly',
  MutationObserver: 'readonly',
  ResizeObserver: 'readonly',
  TextDecoder: 'readonly',
  TextEncoder: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  WebSocket: 'readonly',
  XMLHttpRequest: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  clearTimeout: 'readonly',
  crypto: 'readonly',
  document: 'readonly',
  fetch: 'readonly',
  indexedDB: 'readonly',
  localStorage: 'readonly',
  location: 'readonly',
  module: 'readonly',
  navigator: 'readonly',
  performance: 'readonly',
  process: 'readonly',
  requestAnimationFrame: 'readonly',
  require: 'readonly',
  setTimeout: 'readonly',
  window: 'readonly',
};

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      '.wt/**',
      '.work/**',
      '.claude/**',
      '.onyx-deploy-backups/**',
      'scratchpad/**',
      'deploy-backups/**',
      'out/**',
      'zig-out/**',
      '.zig-cache/**',
      'coverage/**',
      'dist/**',
      'elm/dist-elm/**',
      // Elm compiler cache and compiled bundles (regenerable, gitignored).
      'elm/elm-stuff/**',
      'elm/app.js',
      'test-results/**',
      'public/opcodec_wasm.js',
      'public/sw.js',
      'tools/**',
      'node_modules/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    ...solid,
  },
  {
    // Elm client JS: ports.js runs in the browser (and is loaded by the
    // node smoke tests via require), the *.smoke.mjs suites run in node.
    files: ['elm/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: ELM_JS_GLOBALS,
    },
  },
  {
    rules: {
      // The store bridges Zustand and Solid; `any` appears at a few untyped
      // protocol boundaries. Surface as warnings, fail on real errors.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'prefer-const': 'warn',
      // IRC protocol code matches control characters by design (CTCP \x01,
      // formatting \x02..\x1f, channel-name \x07) — not an accident here.
      'no-control-regex': 'off',
      // `let el; <div ref={el} />` is the canonical Solid ref pattern.
      'no-unassigned-vars': 'off',
      'no-useless-escape': 'warn',
      'no-useless-assignment': 'warn',
    },
  },
);
