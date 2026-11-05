import { describe, expect, it } from 'vitest';
import { createOperatorImport } from './operator-import';
import type { OwnerSnapshot, RequestContext } from './contracts';

const owner: OwnerSnapshot = { networkId: 'net' as OwnerSnapshot['networkId'], accountId: 'alice' as OwnerSnapshot['accountId'], accountGeneration: 1 as OwnerSnapshot['accountGeneration'], connectionGeneration: 2 as OwnerSnapshot['connectionGeneration'], physicalRef: null, ownerRef: 'owner' as OwnerSnapshot['ownerRef'] };
const context: RequestContext = { schemaVersion: 1, requestId: 'request' as RequestContext['requestId'], owner };
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const doctor = { schema_version: 1, mode: 'preflight', readiness: 'unknown', report_build_version: '0.9.0', failed: false,
  checks: [{ id: 'mesh_security', status: 'pass', detail: 'credential-DO-NOT-SHOW', source: '/private/config.toml' }, { id: 'injected-check', status: 'surprise' }],
  capabilities: { source: 'local-config', peer_live_verified: false, entries: [{ name: 'tls_configured', configured: true }] },
  diagnostics: { total: 2, passed: 1, failed: 0, skipped: 0, other: 1, truncated: false },
  observations: { tcp_active: 2, established_links: null, peers_up: 1, peers_total: 2, quorum: 1, components: 1, partitioned: 0, freshness: 'private freshness detail' },
  service_plan: { selected: 'systemd', template: { start_argv: ['/usr/sbin/onyx', '/secret/path'], preflight_argv: ['/usr/sbin/onyx', '--check-config'] } } };

function provider(read: () => Promise<Uint8Array | null>, current: () => OwnerSnapshot = () => owner) {
  return createOperatorImport({ ownerSnapshot: current, isCurrent: (candidate) => candidate.ownerRef === current().ownerRef,
    readPrivateFile: read, emit: () => undefined });
}

describe('private operator report import', () => {
  it('projects doctor output into bounded enums and omits secret-bearing extra fields', async () => {
    const raw = bytes(doctor);
    const service = provider(async () => raw);
    const result = await service.preview({ context, inputRef: Symbol('private-file') });
    expect(result.status).toBe('ready');
    expect(result.plan?.kind).toBe('doctor-v1');
    expect(JSON.stringify(result.plan)).not.toContain('DO-NOT-SHOW');
    expect(JSON.stringify(result.plan)).not.toContain('/private/config.toml');
    expect(JSON.stringify(result.plan)).not.toContain('/secret/path');
    expect(result.plan?.kind === 'doctor-v1' && result.plan.checks[1]?.id).toBe('unknown-check');
    expect(raw.every((byte) => byte === 0)).toBe(true);
    service.dispose();
  });

  it('rejects unsupported schemas and oversized input without exposing text', async () => {
    const unsupported = provider(async () => bytes({ schema_version: 99, secret: 'hide' }));
    await expect(unsupported.preview({ context, inputRef: Symbol() })).resolves.toMatchObject({ status: 'unsupported-schema', plan: null });
    const oversized = provider(async () => new Uint8Array(1024 * 1024 + 1));
    await expect(oversized.preview({ context, inputRef: Symbol() })).resolves.toMatchObject({ status: 'too-large', plan: null });
    unsupported.dispose(); oversized.dispose();
  });

  it('rejects undocumented root extensions while never copying their values', async () => {
    const service = provider(async () => bytes({ ...doctor, harmless_extension: { token: 'never render this' } }));
    const result = await service.preview({ context, inputRef: Symbol() });
    expect(result.status).toBe('invalid');
    expect(JSON.stringify(result)).not.toContain('never render this');
    service.dispose();
  });

  it('projects setup assessment and service enums without host paths or configuration text', async () => {
    const setup = { schema_version: 4, mode: 'preview', readiness: 'unknown', changes_applied: false, profile: 'media',
      config: '/etc/private/config.toml', profile_diff: 'secret-bearing change', node_public_key: 'private-public-key-value',
      effective_profile: { max_clients: 256, media_enabled: true },
      network_assessment: { hostname: 'secret-host.internal', candidate_validation: 'configuration loader and static checks passed', hostname_check: 'DNS-label syntax valid; DNS not queried', hostname_resolution: 'unknown; DNS was not queried', listen_host: '127.0.0.1', address_check: 'numeric IPv4 syntax valid', address_ownership: 'unknown; local interface ownership was not checked', irc_port: 6667, tls_enabled: true, tls_port: 6697, port_check: 'IRC and TLS ports differ; other conflicts not assessed', port_availability: 'unknown; no socket was bound', public_reachability: 'unknown; no network probes were sent' },
      media_assessment: { enabled: 'yes', configured: { enabled: true, media_port: 1, native_media_port: 2, stun_port: 3, websocket_port: 4, websocket_media_relay: true, existing: false, advertised_host: 'secret-host.internal' }, relay: 'raw relay diagnostic' }, service_plan: { selected: 'openrc', template: { start_argv: ['daemon', '/private/path'], preflight_argv: ['daemon', '--check-config'] } } };
    const service = provider(async () => bytes(setup));
    const result = await service.preview({ context, inputRef: Symbol() });
    expect(result.status).toBe('ready');
    expect(result.plan?.kind).toBe('setup-v4');
    expect(JSON.stringify(result.plan)).not.toContain('secret-host.internal');
    expect(JSON.stringify(result.plan)).not.toContain('/etc/private/config.toml');
    expect(JSON.stringify(result.plan)).not.toContain('/private/path');
    expect(JSON.stringify(result.plan)).not.toContain('private-public-key-value');
    expect(result.plan?.kind === 'setup-v4' && result.plan.service.manager).toBe('openrc');
    expect(result.plan?.kind === 'setup-v4' && result.plan.network?.tlsPort).toBe(6697);
    expect(result.plan?.kind === 'setup-v4' && result.plan.network).toMatchObject({
      validation: 'static-passed', hostnameSyntax: 'valid', addressSyntax: 'ipv4', readiness: 'unknown',
    });
    expect(JSON.stringify(result.plan)).not.toContain('secret-host.internal');
    service.dispose();

    const pendingSetup = { ...setup, network_assessment: {
      ...setup.network_assessment,
      candidate_validation: 'candidate validation pending',
      hostname_check: 'not a DNS-label hostname; DNS not queried',
      address_check: 'not a numeric IP; runtime binding not checked',
    } };
    const pendingService = provider(async () => bytes(pendingSetup));
    const pendingResult = await pendingService.preview({ context, inputRef: Symbol() });
    expect(pendingResult.status).toBe('ready');
    expect(pendingResult.plan?.kind === 'setup-v4' && pendingResult.plan.network).toMatchObject({
      validation: 'pending', hostnameSyntax: 'invalid', addressSyntax: 'unknown', readiness: 'unknown',
    });
    expect(JSON.stringify(pendingResult.plan)).not.toContain('secret-host.internal');
    expect(JSON.stringify(pendingResult.plan)).not.toContain('/etc/private/config.toml');
    pendingService.dispose();
  });

  it('rejects unsafe numeric values and excessive nesting before projection', async () => {
    const unsafe = provider(async () => bytes({ ...doctor, diagnostics: { ...doctor.diagnostics, total: Number.MAX_SAFE_INTEGER + 1 } }));
    await expect(unsafe.preview({ context, inputRef: Symbol() })).resolves.toMatchObject({ status: 'too-large' });
    const deeplyNested = provider(async () => bytes({ ...doctor, injected: Array.from({ length: 25 }, () => []) }));
    await expect(deeplyNested.preview({ context, inputRef: Symbol() })).resolves.toMatchObject({ status: 'invalid' });
    unsafe.dispose(); deeplyNested.dispose();
  });

  it('does not retain a preview when owner changes during private file read', async () => {
    let current = owner;
    let finish!: (value: Uint8Array | null) => void;
    const service = provider(() => new Promise((resolve) => { finish = resolve; }), () => current);
    const pending = service.preview({ context, inputRef: Symbol() });
    current = { ...owner, ownerRef: 'next-owner' as OwnerSnapshot['ownerRef'], connectionGeneration: 3 as OwnerSnapshot['connectionGeneration'] };
    finish(bytes(doctor));
    await expect(pending).resolves.toMatchObject({ status: 'stale-owner', previewRef: null });
    service.dispose();
  });
  it('keeps unrecognized setup and doctor findings unknown and never upgrades a report to ready', async () => {
    const setup = { schema_version: 4, mode: 'apply-now', readiness: 'unknown', changes_applied: false, profile: 'community',
      network_assessment: { candidate_validation: 'validated by operator: trust me', hostname_check: 'resolved to 10.0.0.5', address_check: 'owned by eth0',
        irc_port: 6667, tls_enabled: false, tls_port: 6697 },
      media_assessment: { enabled: 'maybe', relay: 'verified relay' }, service_plan: { selected: 'launchd', template: { start_argv: [], preflight_argv: [] } } };
    const service = provider(async () => bytes(setup));
    const result = await service.preview({ context, inputRef: Symbol() });
    expect(result.status).toBe('ready');
    if (result.plan?.kind !== 'setup-v4') throw new Error('expected a setup projection');
    expect(result.plan).toMatchObject({ mode: 'unsupported-mode', readiness: 'unknown', service: { manager: 'unknown' } });
    expect(result.plan.network).toMatchObject({ validation: 'unknown', hostnameSyntax: 'unknown', addressSyntax: 'unknown', readiness: 'unknown' });
    expect(result.plan.media).toMatchObject({ enabled: 'unknown', readiness: 'unknown', relay: 'unknown' });
    expect(JSON.stringify(result.plan)).not.toMatch(/trust me|10\.0\.0\.5|eth0|verified relay|launchd/u);
    service.dispose();

    for (const report of [{ ...setup, readiness: 'ready' }, { ...doctor, readiness: 'ready' }]) {
      const claimed = provider(async () => bytes(report));
      await expect(claimed.preview({ context, inputRef: Symbol() })).resolves.toMatchObject({ status: 'invalid', plan: null, previewRef: null });
      claimed.dispose();
    }

    const doctorUnknown = provider(async () => bytes({ ...doctor, checks: [{ id: 'mesh_security', status: 'PASS' }, { id: 'tls', status: 'ok' }] }));
    const projected = await doctorUnknown.preview({ context, inputRef: Symbol() });
    expect(projected.plan?.kind === 'doctor-v1' && projected.plan.checks.map(check => check.status)).toEqual(['unknown', 'unknown']);
    expect(projected.plan?.readiness).toBe('unknown');
    doctorUnknown.dispose();
  });

  it('emits only the opaque preview reference and status, never report content', async () => {
    const emitted: unknown[] = [];
    const raw = bytes(doctor);
    const service = createOperatorImport({ ownerSnapshot: () => owner, isCurrent: () => true, readPrivateFile: async () => raw, emit: event => emitted.push(event) });
    const result = await service.preview({ context, inputRef: Symbol() });
    expect(result.status).toBe('ready');
    expect(emitted).toHaveLength(1);
    const event = emitted[0] as Record<string, unknown>;
    expect(Object.keys(event).sort()).toEqual(['context', 'previewRef', 'status']);
    expect(event).toMatchObject({ status: 'ready', previewRef: result.previewRef });
    expect(event.previewRef).toMatch(/^[0-9a-f]{48}$/u);
    expect(JSON.stringify(event)).not.toMatch(/DO-NOT-SHOW|private\/config|secret\/path|freshness detail|systemd|mesh_security/u);
    const invalid = createOperatorImport({ ownerSnapshot: () => owner, isCurrent: () => true,
      readPrivateFile: async () => bytes({ ...doctor, extra: 'credential-DO-NOT-SHOW' }), emit: event => emitted.push(event) });
    await expect(invalid.preview({ context, inputRef: Symbol() })).resolves.toMatchObject({ status: 'invalid' });
    expect(emitted).toHaveLength(1);
    service.dispose(); invalid.dispose();
  });
});
