/**
 * Small client-side metadata helper for the static SPA routes.
 *
 * Vite serves one index.html, so each public route updates title/description
 * after navigation. Tests run in jsdom; production runs in the browser.
 */

export function setPageMeta(title: string, description: string): void {
  if (typeof document === 'undefined') return;
  document.title = title;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'description';
    document.head.append(meta);
  }
  meta.content = description;
}
