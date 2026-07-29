// Flat ESLint config for the real stack (SolidJS + TypeScript + Vite).
// The old config imported eslint-config-next, a leftover from the dead
// Next.js era that was never installed — lint had been broken since the port.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import solid from 'eslint-plugin-solid/configs/typescript';

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      '.wt/**',
      '.claude/**',
      'scratchpad/**',
      'out/**',
      'zig-out/**',
      '.zig-cache/**',
      'coverage/**',
      'dist/**',
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
