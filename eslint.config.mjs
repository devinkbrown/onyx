import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "public/opcodec_wasm.js",
    ".wt/**",
  ]),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "react/no-unescaped-entities": "warn",
      "react-hooks/purity": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/use-memo": "off",
      // Ocean renders arbitrary remote + data-URL media (avatars, stickers,
      // GIFs, link-preview thumbnails, custom emoji) under a static export.
      // next/image can't optimize arbitrary external hosts without a loader and
      // is the wrong fit here, so plain <img> is intentional.
      "@next/next/no-img-element": "off",
    },
  },
]);

export default eslintConfig;
