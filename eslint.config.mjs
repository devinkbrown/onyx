// Flat ESLint config for the Elm client tooling: TypeScript runtime, shared src/lib modules, tools and tests.
// The old config imported eslint-config-next, a leftover from the dead
// Next.js era that was never installed — lint had been broken since the port.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

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
      // Elm compiler output (generated test harness JS, never hand-edited).
      'elm/elm-stuff/**',
      'test-results/**',
      'public/opcodec_wasm.js',
      'public/sw.js',
      'tools/**',
      // Immutable, source-reviewed roadmap evidence is not application code.
      'docs/elm-roadmap/evidence/**',
      'node_modules/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Elm port bridge + smoke scripts: dual browser/node environment by
    // design (ports.js guards node requires behind typeof checks; the smoke
    // files drive browser shims from node). Declare both environments'
    // globals explicitly — no new packages can be added here, so extend
    // this list if a new global starts being used.
    files: ['elm/**/*.js', 'elm/**/*.mjs'],
    languageOptions: {
      globals: {
        AbortController: 'readonly',
        AbortSignal: 'readonly',
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
        MessageChannel: 'readonly',
        Response: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        XMLHttpRequest: 'readonly',
        __ONYX_SW_BUILD_CONFIG__: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        caches: 'readonly',
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
        require: 'readonly',
        self: 'readonly',
        setTimeout: 'readonly',
        structuredClone: 'readonly',
        WebSocket: 'readonly',
        window: 'readonly',
      },
    },
    rules: {
      // Dual-env bridge by design; node requires ride behind typeof guards.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    rules: {
      // `any` appears at a few untyped
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
      // Some runtime fixtures assign handles after declaration.
      'no-unassigned-vars': 'off',
      'no-useless-escape': 'warn',
      'no-useless-assignment': 'warn',
    },
  },
);
