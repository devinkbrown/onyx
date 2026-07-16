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

    expect(body).toContain('alias /home/kain/orochi-stats/out/assets/;');
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

  it('does not turn missing fingerprints into long-lived negative cache entries', () => {
    expect(config).toContain('location @onyx_public_asset_not_found {');
    expect(config).toMatch(/location @onyx_public_asset_not_found \{\s+return 404;\s+\}/);
  });

  it('revalidates the stats SPA shell without weakening asset or data precedence', () => {
    const body = locationBody('^~ /stats/');

    expect(body).toContain('alias /home/kain/orochi-stats/out/;');
    expect(body).toContain('try_files $uri $uri/ /stats/index.html;');
    expect(body).toContain('add_header Cache-Control "no-cache";');
    expect(body.match(/Cache-Control/g)).toHaveLength(1);
    expect(body).not.toContain('expires ');
  });

  it('emits one revalidation policy for Onyx documents, the worker, and manifest', () => {
    const body = locationBody('/');

    expect(body).toContain('try_files $uri $uri/ $uri/index.html =404;');
    expect(body).toContain('add_header Cache-Control "no-cache";');
    expect(body.match(/Cache-Control/g)).toHaveLength(1);
    expect(body).not.toContain('expires ');
  });
});
