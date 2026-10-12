// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const config = readFileSync(
  resolve(process.cwd(), 'ops/nginx/eshmaki-server.conf'),
  'utf8',
);

function locationBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = config.match(new RegExp(`location ${escaped} \\{([\\s\\S]*?)\\n\\}`));
  expect(match, `missing dedicated nginx location for ${selector}`).not.toBeNull();
  return match?.[1] ?? '';
}

describe('public asset delivery policy', () => {
  it('serves Onyx fingerprints immutably and fails missing chunks closed', () => {
    const body = locationBody('^~ /assets/');

    expect(body).toContain('root /home/kain/onyx/out;');
    expect(body).toContain('try_files $uri =404;');
    expect(body).toContain('error_page 404 = @onyx_public_asset_not_found;');
    expect(body).toContain(
      'add_header Cache-Control "public, max-age=31536000, immutable";',
    );
    expect(body).not.toContain('expires ');
  });

  it('keeps stats fingerprints out of the stats SPA fallback', () => {
    const body = locationBody('^~ /stats/assets/');

    expect(body).toContain('alias /home/kain/onyx/out/assets/;');
    expect(body).toContain('error_page 404 = @onyx_public_asset_not_found;');
    expect(body).toContain(
      'add_header Cache-Control "public, max-age=31536000, immutable";',
    );
    expect(body).not.toContain('index.html');
    expect(body).not.toContain('expires ');
  });

  it('uses one bounded policy for stable-name public media', () => {
    const body = locationBody('~* \\.(png|jpg|jpeg|gif|ico|svg|webp|woff|woff2|ttf|eot)$');

    expect(body).toContain('add_header Cache-Control "public, max-age=86400";');
    expect(body.match(/Cache-Control/g)).toHaveLength(1);
    expect(body).not.toContain('expires ');
  });

  it('merges baseline security headers into cache-specific locations', () => {
    expect(config).toContain('add_header_inherit merge;');
  });

  it('denies framing from the inherited response-header policy', () => {
    expect(config.match(/^add_header Content-Security-Policy "frame-ancestors 'none'" always;$/gm)).toHaveLength(1);
    expect(config.match(/^add_header X-Frame-Options "DENY" always;$/gm)).toHaveLength(1);
    expect(config).toContain('browsers ignore\n# frame-ancestors in a meta CSP');
  });

  it('does not turn missing fingerprints into long-lived negative cache entries', () => {
    expect(config).toContain('location @onyx_public_asset_not_found {');
    expect(config).toMatch(/location @onyx_public_asset_not_found \{\s+return 404;\s+\}/);
  });

  it('serves only the exact canonical stats shell and fails descendants closed', () => {
    const canonical = locationBody('= /stats/');
    const descendants = locationBody('^~ /stats/');

    expect(canonical).toContain('root /home/kain/onyx/out;');
    expect(canonical).toContain('try_files /stats/index.html =404;');
    expect(canonical).toContain('add_header Cache-Control "no-cache";');
    expect(canonical).not.toContain('expires ');
    expect(descendants).toContain('return 404;');
    expect(descendants).not.toContain('index.html');
  });

  it('keeps protected resource prefixes bare while rendering branded unknown public routes', () => {
    const body = locationBody('/');
    const notFound = locationBody('= /404.html');
    const html = locationBody('~* \\.html$');

    expect(body).toContain('try_files $uri $uri/ $uri/index.html =404;');
    expect(body).toContain('error_page 404 /404.html;');
    expect(body).not.toContain('error_page 404 =');
    expect(body).toContain('add_header Cache-Control "no-cache";');
    expect(body.match(/Cache-Control/g)).toHaveLength(1);
    expect(body).not.toContain('expires ');

    expect(notFound).toContain('internal;');
    expect(notFound).toContain('root /home/kain/onyx/out;');
    expect(notFound).toContain('try_files /404.html =404;');
    expect(notFound).toContain('add_header Cache-Control "no-store" always;');
    expect(notFound).toContain('add_header X-Robots-Tag "noindex, nofollow" always;');
    expect(notFound).not.toContain('error_page');

    expect(config.indexOf('location ~* \\.html$')).toBeLessThan(config.indexOf('location / {'));
    expect(html).toContain('try_files $uri =404;');
    expect(html).toContain('error_page 404 /404.html;');
    expect(html).toContain('add_header Cache-Control "no-cache";');

    for (const selector of ['^~ /assets/', '^~ /stats/assets/', '^~ /stats/data/', '^~ /onyxos/']) {
      expect(locationBody(selector)).not.toContain('404.html');
    }
    expect(locationBody('= /stats/backups/latest.json')).not.toContain('404.html');
  });
});
