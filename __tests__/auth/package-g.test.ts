import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('Package G auth and onboarding overhaul', () => {
  it('uses the Orochi registration store contract instead of parsing raw notices', () => {
    const registerForm = read('components/auth/RegisterForm.tsx');

    expect(registerForm).toContain('registerAccount');
    expect(registerForm).toContain('verifyAccount');
    expect(registerForm).toContain('registerPending');
    expect(registerForm).toContain('registerError');
    expect(registerForm).toContain('verifyRequired');
    expect(registerForm).not.toContain('REGISTER_SUCCESS_RE');
    expect(registerForm).not.toContain('ACCOUNT REGISTER');
  });

  it('keeps the auth surface on the Deep Lacquer split-stage treatment', () => {
    const authPage = read('components/auth/AuthPage.tsx');

    expect(authPage).toContain('grid-template-columns: 45fr 55fr');
    expect(authPage).toContain('auth-brand-grain');
    expect(authPage).toContain('elev-1');
    expect(authPage).not.toContain('auth-bg-orb');
    expect(authPage).not.toContain('auth-bg-grid');
  });

  it('keeps landing copy and integration handoff within Ocean constraints', () => {
    const landing = read('app/page.tsx');
    const onboarding = read('components/modals/OnboardingModal.tsx');

    expect(landing).toContain('font-size: var(--text-hero)');
    expect(landing).toContain('land-app-preview elev-2');
    expect(landing).not.toMatch(/Discord|WebRTC/i);
    expect(onboarding).toContain('OCEAN-INTEGRATION:');
    expect(onboarding).toContain('ocean:metadata-set');
  });
});
