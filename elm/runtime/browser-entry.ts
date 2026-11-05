// The static Elm shell consumes this runtime as a browser global. Keep this
// explicit side-effect entry separate from bootstrap's importable API so
// Rollup's application-mode tree shaking cannot discard its exports.
import { createBrowserRuntime } from './bootstrap';
import { createBrowserPlatform, loadBrowserBuildCompatibility } from './browser-platform';

declare global {
  interface Window {
    OnyxRuntime?: {
      readonly createBrowserRuntime: typeof createBrowserRuntime;
      readonly shellRef: string;
      readonly createBrowserPlatform: typeof createBrowserPlatform;
      readonly loadBrowserBuildCompatibility: typeof loadBrowserBuildCompatibility;
    };
  }
}

window.OnyxRuntime = { createBrowserRuntime, shellRef: '__ONYX_PUBLIC_RUNTIME_SHELL_REF__', createBrowserPlatform, loadBrowserBuildCompatibility };
