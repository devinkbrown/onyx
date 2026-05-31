'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';
import { useTheme } from '@/components/ui/ThemeProvider';
import type { TimeFormat } from '@/lib/format-time';
import { useDialogFocus } from './useDialogFocus';

type Density = 'cozy' | 'compact' | 'spacious';
type BgPattern = 'solid' | 'dots' | 'grid' | 'noise' | 'diagonal';
type MsgMaxWidth = 680 | 860 | 0;

const FONT_OPTIONS: Array<{ value: string; label: string; preview: string }> = [
  { value: 'system-ui, -apple-system, sans-serif', label: 'System Default', preview: 'Aa' },
  { value: "'Inter', sans-serif",                  label: 'Inter',          preview: 'Aa' },
  { value: "'JetBrains Mono', monospace",          label: 'JetBrains Mono', preview: 'Aa' },
  { value: "'Fira Code', monospace",               label: 'Fira Code',      preview: 'Aa' },
  { value: "'Roboto', sans-serif",                 label: 'Roboto',         preview: 'Aa' },
];

const MSG_WIDTH_OPTIONS: Array<{ value: MsgMaxWidth; label: string; desc: string }> = [
  { value: 680, label: 'Narrow',    desc: '680px — comfortable reading' },
  { value: 860, label: 'Medium',    desc: '860px — balanced width' },
  { value: 0,   label: 'Unlimited', desc: 'Full width' },
];

const DENSITIES: Array<{ id: Density; label: string; desc: string }> = [
  { id: 'cozy',     label: 'Cozy',     desc: 'Comfortable spacing with avatars' },
  { id: 'compact',  label: 'Compact',  desc: 'Tighter spacing, more messages visible' },
  { id: 'spacious', label: 'Spacious', desc: 'Extra breathing room between messages' },
];

interface ThemeDef {
  id: string;
  label: string;
  bg: string;
  sidebar: string;
  accent: string;
  badge?: string;
}

const THEMES: ThemeDef[] = [
  { id: 'ocean',    label: 'Ocean',    bg: '#06101d', sidebar: '#030810', accent: '#0ea5e9' },
  { id: 'midnight', label: 'Midnight', bg: '#061020', sidebar: '#030810', accent: '#0ea5e9' },
  { id: 'forest',   label: 'Forest',   bg: '#04150a', sidebar: '#010d05', accent: '#22c55e' },
  { id: 'ember',    label: 'Ember',    bg: '#180900', sidebar: '#0d0500', accent: '#f97316' },
  { id: 'arctic',   label: 'Arctic',   bg: '#161b22', sidebar: '#0d1117', accent: '#58a6ff' },
  { id: 'onyx',     label: 'Onyx',     bg: '#0a0a0a', sidebar: '#000000', accent: '#7c5af5', badge: 'OLED' },
  { id: 'ash',      label: 'Ash',      bg: '#313338', sidebar: '#1e1f22', accent: '#5865f2' },
  { id: 'amoled',   label: 'AMOLED',   bg: '#050505', sidebar: '#000000', accent: '#e8b84b', badge: 'OLED' },
  { id: 'light',    label: 'Light',    bg: '#f2f3f5', sidebar: '#e3e5e8', accent: '#5865f2' },
  { id: 'system',   label: 'System',   bg: '#23272a', sidebar: '#18191c', accent: '#5865f2', badge: 'AUTO' },
];

const ACCENT_PRESETS: Array<{ label: string; color: string }> = [
  { label: 'Sky',     color: '#0ea5e9' },
  { label: 'Cyan',    color: '#06b6d4' },
  { label: 'Violet',  color: '#7c5af5' },
  { label: 'Rose',    color: '#f43f5e' },
  { label: 'Amber',   color: '#f59e0b' },
  { label: 'Emerald', color: '#10b981' },
];

const BG_PATTERNS: Array<{ id: BgPattern; label: string }> = [
  { id: 'solid',    label: 'Solid' },
  { id: 'dots',     label: 'Dot grid' },
  { id: 'grid',     label: 'Fine grid' },
  { id: 'noise',    label: 'Noise' },
  { id: 'diagonal', label: 'Diagonal' },
];

function DensityPreview({ id }: { id: 'cozy' | 'compact' | 'spacious' }) {
  if (id === 'cozy') {
    return (
      <div className="dp-cozy">
        {[1, 2, 3].map(i => (
          <div key={i} className="dp-row dp-row--cozy">
            <div className="dp-avatar" />
            <div className="dp-lines">
              <div className="dp-nick" />
              <div className="dp-text" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (id === 'compact') {
    return (
      <div className="dp-compact">
        {[1, 2, 3].map(i => (
          <div key={i} className="dp-row dp-row--compact">
            <div className="dp-nick dp-nick--sm" />
            <div className="dp-text dp-text--sm" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="dp-spacious">
      {[1, 2, 3].map(i => (
        <div key={i} className="dp-row dp-row--spacious">
          <div className="dp-avatar" />
          <div className="dp-lines">
            <div className="dp-nick" />
            <div className="dp-text" style={{ width: '85%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

const TIME_FORMAT_OPTIONS: Array<{ id: TimeFormat; label: string; preview: string }> = [
  { id: '12h',    label: '12-hour',  preview: '2:30 PM' },
  { id: '24h',    label: '24-hour',  preview: '14:30' },
  { id: 'hidden', label: 'Hidden',   preview: '—' },
];

export default function ThemeModal() {
  const { setTheme: setUiTheme, fontSize: uiFontSize, setFontSize: setUiFontSize } = useTheme();
  const activeTheme        = useOnyxStore(s => s.activeTheme);
  const setTheme           = useOnyxStore(s => s.setTheme);
  const closeThemeModal    = useOnyxStore(s => s.closeThemeModal);
  const messageDensity     = useOnyxStore(s => s.messageDensity);
  const setMessageDensity  = useOnyxStore(s => s.setMessageDensity);
  const timeFormat         = useOnyxStore(s => s.timeFormat);
  const setTimeFormat      = useOnyxStore(s => s.setTimeFormat);
  const messageFontSize    = useOnyxStore(s => s.messageFontSize);
  const setMessageFontSize = useOnyxStore(s => s.setMessageFontSize);
  const accentColor        = useOnyxStore(s => s.accentColor);
  const setAccentColor     = useOnyxStore(s => s.setAccentColor);
  const reducedMotion      = useOnyxStore(s => s.reducedMotion);
  const setReducedMotion   = useOnyxStore(s => s.setReducedMotion);
  const highContrastMode   = useOnyxStore(s => s.highContrastMode);
  const setHighContrastMode = useOnyxStore(s => s.setHighContrastMode);
  const chatBackground     = useOnyxStore(s => s.chatBackground);
  const setChatBackground  = useOnyxStore(s => s.setChatBackground);
  const uiFont             = useOnyxStore(s => s.uiFont);
  const setUiFont          = useOnyxStore(s => s.setUiFont);
  const bubbleMode         = useOnyxStore(s => s.bubbleMode);
  const setBubbleMode      = useOnyxStore(s => s.setBubbleMode);
  const customCss          = useOnyxStore(s => s.customCss);
  const setCustomCss       = useOnyxStore(s => s.setCustomCss);
  const messageMaxWidth    = useOnyxStore(s => s.messageMaxWidth);
  const setMessageMaxWidth = useOnyxStore(s => s.setMessageMaxWidth);
  const glassSidebar       = useOnyxStore(s => s.glassSidebar);
  const setGlassSidebar    = useOnyxStore(s => s.setGlassSidebar);

  const [appliedFlash, setAppliedFlash] = useState<string | null>(null);
  const [useSystemTheme, setUseSystemTheme] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  useDialogFocus(modalRef);

  const activeThemeDef = THEMES.find(t => t.id === activeTheme) ?? THEMES[0];

  const handleSetTheme = useCallback((id: string) => {
    setTheme(id);
    // Also drive the new theme system for midnight/onyx/ash/amoled/light/system options
    if (id === 'midnight' || id === 'onyx' || id === 'ash' || id === 'amoled' || id === 'light' || id === 'system') {
      setUiTheme(id as 'midnight' | 'onyx' | 'ash' | 'amoled' | 'light' | 'system');
    }
    setUseSystemTheme(id === 'system');
    setAppliedFlash(id);
    const timer = setTimeout(() => setAppliedFlash(null), 1000);
    return () => clearTimeout(timer);
  }, [setTheme, setUiTheme]);

  // System theme detection
  useEffect(() => {
    if (!useSystemTheme) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (dark: boolean) => setTheme(dark ? 'ocean' : 'ash');
    apply(mq.matches);
    const handler = (e: MediaQueryListEvent) => apply(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [useSystemTheme, setTheme]);

  return (
    <div className="theme-modal-backdrop" onClick={closeThemeModal}>
      <div className="theme-modal" ref={modalRef} onClick={e => e.stopPropagation()} role="dialog" aria-modal aria-labelledby="theme-modal-title">

        <div className="theme-modal-header">
          <h2 id="theme-modal-title" className="theme-modal-title">Appearance</h2>
          <button className="theme-modal-close" onClick={closeThemeModal} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="theme-current-row">
          <span className="theme-current-label">
            Current theme: <strong>{activeThemeDef.label}</strong>
            {activeThemeDef.badge && (
              <span className="theme-oled-badge">{activeThemeDef.badge}</span>
            )}
          </span>
          {appliedFlash && (
            <span className="theme-applied-flash">Applied</span>
          )}
        </div>

        <div className="theme-grid" role="radiogroup" aria-label="Theme">
          {THEMES.map(t => {
            const active = activeTheme === t.id;
            return (
              <button
                key={t.id}
                className={`theme-swatch${active ? ' theme-swatch--active' : ''}`}
                onClick={() => handleSetTheme(t.id)}
                role="radio"
                aria-checked={active}
                aria-label={t.label}
              >
                <div
                  className="theme-swatch-preview"
                  style={{ background: t.bg }}
                >
                  {/* Sidebar strip */}
                  <div className="theme-swatch-sidebar" style={{ background: t.sidebar }} />
                  {/* Chat area — just the bg, already set on parent */}
                  {/* Accent dot */}
                  <div className="theme-swatch-accent-dot" style={{ background: t.accent }} />
                  {/* Bottom bar */}
                  <div className="theme-swatch-bar" style={{ background: t.accent }} />
                  {active && (
                    <div className="theme-swatch-check" style={{ borderColor: t.accent, background: t.accent }}>
                      <CheckIcon />
                    </div>
                  )}
                </div>
                <span className="theme-swatch-label" style={active ? { color: t.accent } : undefined}>
                  {t.label}
                  {t.badge && (
                    <span className="theme-oled-badge theme-oled-badge--inline">{t.badge}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── System Theme ── */}
        <button
          className={`motion-toggle${useSystemTheme ? ' motion-toggle--active' : ''}`}
          onClick={() => setUseSystemTheme(v => !v)}
          role="switch"
          aria-checked={useSystemTheme}
          style={{ marginTop: 14 }}
        >
          <span className="motion-toggle-icon">🖥</span>
          <div className="motion-toggle-info">
            <span className="motion-toggle-label">Follow system theme</span>
            <span className="motion-toggle-desc">Dark → Ocean · Light → Ash</span>
          </div>
          <div className={`toggle-track${useSystemTheme ? ' toggle-track--on' : ''}`}>
            <div className="toggle-thumb" />
          </div>
        </button>

        {/* ── Accent Color ── */}
        <h3 className="density-section-title">Accent Color</h3>

        <div className="accent-section">
          <div className="accent-presets" role="radiogroup" aria-label="Accent color preset">
            {ACCENT_PRESETS.map(p => {
              const active = accentColor === p.color;
              return (
                <button
                  key={p.color}
                  className={`accent-swatch${active ? ' accent-swatch--active' : ''}`}
                  style={{ background: p.color }}
                  onClick={() => setAccentColor(p.color)}
                  role="radio"
                  aria-checked={active}
                  aria-label={p.label}
                  title={p.label}
                >
                  {active && <CheckIcon />}
                </button>
              );
            })}
          </div>
          <div className="accent-custom-row">
            <span className="accent-custom-label">Custom</span>
            <input
              type="color"
              className="accent-color-input"
              value={accentColor}
              onChange={e => setAccentColor(e.target.value)}
              aria-label="Custom accent color"
            />
          </div>
        </div>

        {/* ── Message Density ── */}
        <h3 className="density-section-title">Message Density</h3>

        <div className="density-options" role="radiogroup" aria-label="Message Density">
          {DENSITIES.map(d => {
            const active = messageDensity === d.id;
            return (
              <button
                key={d.id}
                className={`density-option${active ? ' density-option--active' : ''}`}
                onClick={() => setMessageDensity(d.id)}
                role="radio"
                aria-checked={active}
                aria-label={d.label}
              >
                <div className="density-preview">
                  <DensityPreview id={d.id} />
                </div>
                <div className="density-info">
                  <span className="density-label">{d.label}</span>
                  <span className="density-desc">{d.desc}</span>
                </div>
                {active && <div className="density-check"><CheckIcon /></div>}
              </button>
            );
          })}
        </div>

        {/* ── Font Size (message text) ── */}
        <h3 className="density-section-title">Message Font Size</h3>

        <div className="font-size-section">
          <div className="theme-slider-row">
            <span className="theme-slider-label">12px</span>
            <input
              type="range"
              className="theme-slider"
              min={12}
              max={20}
              step={1}
              value={messageFontSize}
              onChange={e => setMessageFontSize(Number(e.target.value))}
              aria-label="Message font size"
            />
            <span className="theme-slider-label">20px</span>
          </div>
          <p className="font-size-preview" style={{ fontSize: `${messageFontSize}px` }}>
            Message Font Size — {messageFontSize}px
          </p>
        </div>

        {/* ── UI Zoom ── */}
        <h3 className="density-section-title">UI Zoom</h3>

        <div className="font-size-section">
          <div className="theme-slider-row">
            <span className="theme-slider-label">Small</span>
            <input
              type="range"
              className="theme-slider"
              min={12}
              max={20}
              step={2}
              value={uiFontSize}
              onChange={e => setUiFontSize(Number(e.target.value))}
              aria-label="UI font size"
            />
            <span className="theme-slider-label">Huge</span>
          </div>
          <div className="zoom-row">
            <span className="zoom-label">
              {uiFontSize === 12 ? 'Small (12px)' :
               uiFontSize === 14 ? 'Medium (14px)' :
               uiFontSize === 16 ? 'Default (16px)' :
               uiFontSize === 18 ? 'Large (18px)' :
               'Huge (20px)'}
            </span>
            <span className="zoom-pct">{Math.round((uiFontSize / 16) * 100)}%</span>
          </div>
        </div>

        {/* ── Time Format ── */}
        <h3 className="density-section-title">Time Format</h3>

        <div className="tf-options" role="radiogroup" aria-label="Time Format">
          {TIME_FORMAT_OPTIONS.map(opt => {
            const active = timeFormat === opt.id;
            return (
              <button
                key={opt.id}
                className={`tf-option${active ? ' tf-option--active' : ''}`}
                onClick={() => setTimeFormat(opt.id)}
                role="radio"
                aria-checked={active}
                aria-label={opt.label}
              >
                <span className="tf-preview">{opt.preview}</span>
                <span className="tf-label">{opt.label}</span>
                {active && <div className="density-check"><CheckIcon /></div>}
              </button>
            );
          })}
        </div>

        {/* ── Background Pattern ── */}
        <h3 className="density-section-title">Background</h3>

        <div className="bg-patterns" role="radiogroup" aria-label="Background pattern">
          {BG_PATTERNS.map(p => {
            const active = chatBackground === p.id;
            return (
              <button
                key={p.id}
                className={`bg-pattern-btn${active ? ' bg-pattern-btn--active' : ''}`}
                onClick={() => setChatBackground(p.id)}
                role="radio"
                aria-checked={active}
                aria-label={p.label}
                title={p.label}
              >
                <div className={`bg-pattern-preview bg-pattern-preview--${p.id}`} />
                <span className="bg-pattern-label">{p.label}</span>
                {active && <div className="bg-pattern-check"><CheckIcon /></div>}
              </button>
            );
          })}
        </div>

        {/* ── Reduced Motion ── */}
        <h3 className="density-section-title">Accessibility</h3>

        <button
          className={`motion-toggle${reducedMotion ? ' motion-toggle--active' : ''}`}
          onClick={() => setReducedMotion(!reducedMotion)}
          role="switch"
          aria-checked={reducedMotion}
        >
          <span className="motion-toggle-icon">🐢</span>
          <div className="motion-toggle-info">
            <span className="motion-toggle-label">Reduce motion</span>
            <span className="motion-toggle-desc">Disable animations and transitions</span>
          </div>
          <div className={`toggle-track${reducedMotion ? ' toggle-track--on' : ''}`}>
            <div className="toggle-thumb" />
          </div>
        </button>

        <button
          className={`motion-toggle${highContrastMode ? ' motion-toggle--active' : ''}`}
          onClick={() => setHighContrastMode(!highContrastMode)}
          role="switch"
          aria-checked={highContrastMode}
          style={{ marginTop: 8 }}
        >
          <span className="motion-toggle-icon">◑</span>
          <div className="motion-toggle-info">
            <span className="motion-toggle-label">High contrast</span>
            <span className="motion-toggle-desc">White on black with bright accents and thicker borders</span>
          </div>
          <div className={`toggle-track${highContrastMode ? ' toggle-track--on' : ''}`}>
            <div className="toggle-thumb" />
          </div>
        </button>

        {/* ── Font Family ── */}
        <h3 className="density-section-title">Font Family</h3>

        <div className="font-family-options" role="radiogroup" aria-label="Font family">
          {FONT_OPTIONS.map(opt => {
            const active = uiFont === opt.value;
            return (
              <button
                key={opt.value}
                className={`font-family-option${active ? ' font-family-option--active' : ''}`}
                onClick={() => setUiFont(opt.value)}
                role="radio"
                aria-checked={active}
                aria-label={opt.label}
              >
                <span className="font-family-preview" style={{ fontFamily: opt.value }}>{opt.preview}</span>
                <span className="font-family-label">{opt.label}</span>
                {active && <div className="density-check"><CheckIcon /></div>}
              </button>
            );
          })}
        </div>

        {/* ── Message Width ── */}
        <h3 className="density-section-title">Message Width</h3>

        <div className="msg-width-options" role="radiogroup" aria-label="Message max width">
          {MSG_WIDTH_OPTIONS.map(opt => {
            const active = messageMaxWidth === opt.value;
            return (
              <button
                key={opt.value}
                className={`msg-width-option${active ? ' msg-width-option--active' : ''}`}
                onClick={() => setMessageMaxWidth(opt.value as MsgMaxWidth)}
                role="radio"
                aria-checked={active}
                aria-label={opt.label}
              >
                <div className="msg-width-info">
                  <span className="msg-width-label">{opt.label}</span>
                  <span className="msg-width-desc">{opt.desc}</span>
                </div>
                {active && <div className="density-check"><CheckIcon /></div>}
              </button>
            );
          })}
        </div>

        {/* ── Layout Toggles ── */}
        <h3 className="density-section-title">Layout</h3>

        <div className="layout-toggles">
          <button
            className={`motion-toggle${bubbleMode ? ' motion-toggle--active' : ''}`}
            onClick={() => setBubbleMode(!bubbleMode)}
            role="switch"
            aria-checked={bubbleMode}
          >
            <span className="motion-toggle-icon">💬</span>
            <div className="motion-toggle-info">
              <span className="motion-toggle-label">Bubble mode</span>
              <span className="motion-toggle-desc">Messages shown as rounded cards</span>
            </div>
            <div className={`toggle-track${bubbleMode ? ' toggle-track--on' : ''}`}>
              <div className="toggle-thumb" />
            </div>
          </button>

          <button
            className={`motion-toggle${glassSidebar ? ' motion-toggle--active' : ''}`}
            onClick={() => setGlassSidebar(!glassSidebar)}
            role="switch"
            aria-checked={glassSidebar}
          >
            <span className="motion-toggle-icon">🔮</span>
            <div className="motion-toggle-info">
              <span className="motion-toggle-label">Glass sidebar</span>
              <span className="motion-toggle-desc">Frosted glass sidebar effect</span>
            </div>
            <div className={`toggle-track${glassSidebar ? ' toggle-track--on' : ''}`}>
              <div className="toggle-thumb" />
            </div>
          </button>
        </div>

        {/* ── Custom CSS ── */}
        <h3 className="density-section-title">Custom CSS</h3>

        <div className="custom-css-section">
          <textarea
            className="custom-css-textarea"
            value={customCss}
            onChange={e => setCustomCss(e.target.value)}
            placeholder={`/* Your custom CSS */\n.chat-msg-wrap { ... }`}
            aria-label="Custom CSS"
            spellCheck={false}
            rows={8}
          />
          <p className="custom-css-hint">CSS injected globally into the page. Changes apply instantly.</p>
        </div>

      </div>

      <style>{`
        .theme-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.72);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 900;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          animation: fadeIn var(--t-fast) var(--ease-out) both;
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }

        .theme-modal {
          background: var(--bg-elevated, #132131);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-xl, 16px);
          padding: 26px;
          width: 520px;
          max-width: calc(100vw - 32px);
          max-height: calc(100dvh - 64px);
          overflow-y: auto;
          box-shadow: var(--shadow-xl, 0 24px 64px rgba(0,0,0,0.75)), 0 0 0 1px var(--border-subtle) inset;
          animation: scaleIn var(--t-normal) var(--ease-out) both;
          scrollbar-width: thin;
          scrollbar-color: var(--border-normal) transparent;
        }
        .theme-modal::-webkit-scrollbar { width: 4px; }
        .theme-modal::-webkit-scrollbar-track { background: transparent; }
        .theme-modal::-webkit-scrollbar-thumb { background: var(--border-normal); border-radius: 2px; }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }

        .theme-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }

        .theme-modal-title {
          font-size: 18px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0;
        }

        .theme-modal-close {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          border: 1px solid var(--border-subtle);
          background: var(--bg-elevated);
          color: var(--text-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform var(--t-fast) var(--ease-out);
          flex-shrink: 0;
        }
        .theme-modal-close:hover {
          background: var(--bg-overlay);
          color: var(--text-primary);
          border-color: var(--border-normal);
          transform: translateY(-1px);
        }
        .theme-modal-close:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }

        .theme-current-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin: 0 0 18px;
          min-height: 22px;
        }

        .theme-current-label {
          font-size: 13px;
          color: var(--text-muted);
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .theme-current-label strong {
          color: var(--text-secondary);
          font-weight: 600;
        }

        .theme-applied-flash {
          font-size: 12px;
          font-weight: 600;
          color: var(--accent);
          animation: theme-flash-in 150ms var(--ease-out) both, theme-flash-out 300ms 700ms var(--ease-out) both;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .theme-applied-flash::before {
          content: '✓';
          font-size: 11px;
        }

        @keyframes theme-flash-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes theme-flash-out {
          from { opacity: 1; }
          to   { opacity: 0; }
        }

        .theme-oled-badge {
          display: inline-flex;
          align-items: center;
          padding: 1px 6px;
          border-radius: 99px;
          background: rgba(232,184,75,0.15);
          color: var(--gold, #e8b84b);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.04em;
          border: 1px solid rgba(232,184,75,0.25);
          line-height: 1.6;
        }

        .theme-oled-badge--inline {
          margin-left: 4px;
          font-size: 9px;
          padding: 1px 5px;
        }

        .theme-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(82px, 1fr));
          gap: 9px;
          padding: 10px;
          background: var(--bg-base);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-lg);
          box-shadow: var(--shadow-sm);
        }

        .theme-swatch {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 7px;
          background: var(--bg-deep);
          border: 1px solid transparent;
          border-radius: var(--r-md);
          cursor: pointer;
          padding: 7px;
          min-width: 0;
          position: relative;
          text-align: center;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out);
        }
        .theme-swatch:hover {
          background: var(--bg-float);
          border-color: var(--border-normal);
          transform: translateY(-2px);
        }
        .theme-swatch:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
        .theme-swatch--active {
          background: var(--accent-subtle);
          border-color: var(--accent-border);
          box-shadow: 0 0 0 1px var(--accent-glow) inset;
        }

        .theme-swatch-preview {
          width: 100%;
          aspect-ratio: 4/3;
          border-radius: var(--r-md);
          position: relative;
          overflow: hidden;
          border: 1px solid var(--border-subtle);
          box-shadow: var(--shadow-sm);
          transition: transform var(--t-normal) var(--ease-spring), opacity var(--t-fast) var(--ease-out);
        }
        .theme-swatch-preview::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, rgba(255,255,255,0.10), transparent 42%, rgba(0,0,0,0.20));
          opacity: 0.75;
          pointer-events: none;
        }
        .theme-swatch-preview::after {
          content: '';
          position: absolute;
          left: calc(28% + 8px);
          right: 9px;
          top: 24px;
          height: 3px;
          border-radius: var(--r-full);
          background: var(--text-primary);
          opacity: 0.28;
          box-shadow:
            0 9px 0 var(--text-secondary),
            18px 18px 0 var(--text-muted);
        }
        .theme-swatch:hover .theme-swatch-preview {
          transform: translateY(-1px) scale(1.01);
        }
        .theme-swatch--active .theme-swatch-preview {
          border-color: var(--accent);
          box-shadow: 0 0 0 2px var(--accent-glow), var(--shadow-md);
        }

        .theme-swatch-sidebar {
          position: absolute;
          left: 0;
          top: 0;
          width: 28%;
          height: 100%;
          border-right: 1px solid rgba(255,255,255,0.07);
        }

        .theme-swatch-accent-dot {
          position: absolute;
          top: 8px;
          left: calc(28% + 8px);
          width: 9px;
          height: 9px;
          border-radius: 50%;
          opacity: 0.9;
          box-shadow: 0 0 14px currentColor;
        }

        .theme-swatch-bar {
          position: absolute;
          bottom: 0;
          left: 28%;
          right: 0;
          height: 18%;
          opacity: 0.5;
          border-radius: 0 0 4px 0;
        }

        .theme-swatch-check {
          position: absolute;
          top: 5px;
          right: 5px;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          border: 2px solid;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          box-shadow: var(--shadow-sm);
        }

        .theme-swatch-label {
          font-size: 11px;
          font-weight: 700;
          color: var(--text-secondary);
          line-height: 1.2;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .theme-swatch:hover .theme-swatch-label {
          color: var(--text-primary);
        }

        /* ── Accent color section ── */
        .accent-section {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 12px;
          background: var(--bg-base);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-lg);
          box-shadow: var(--shadow-sm);
        }

        .accent-presets {
          display: flex;
          gap: 9px;
          flex-wrap: wrap;
        }

        .accent-swatch {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          border: 2px solid var(--bg-elevated);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          box-shadow: 0 0 0 1px var(--border-subtle), var(--shadow-sm);
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out);
        }
        .accent-swatch:hover {
          transform: translateY(-2px) scale(1.08);
        }
        .accent-swatch:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
        .accent-swatch--active {
          border-color: var(--text-primary);
          transform: scale(1.06);
          box-shadow: 0 0 0 3px var(--accent-glow), var(--shadow-md);
        }

        .accent-custom-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding-top: 10px;
          border-top: 1px solid var(--border-subtle);
        }

        .accent-custom-label {
          font-size: 12px;
          color: var(--text-secondary);
          font-weight: 600;
        }

        .accent-color-input {
          width: 46px;
          height: 32px;
          border-radius: var(--r-sm);
          border: 1px solid var(--border-normal);
          cursor: pointer;
          background: var(--bg-deep);
          padding: 3px;
          box-shadow: var(--shadow-sm);
        }
        .accent-color-input:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }

        /* ── Density section ── */
        .density-section-title {
          font-size: 10px;
          font-weight: 800;
          color: var(--text-muted);
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin: 26px 0 10px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .density-section-title::after {
          content: '';
          flex: 1;
          height: 1px;
          background: linear-gradient(to right, var(--border-subtle), transparent);
        }

        .density-options {
          display: flex;
          flex-direction: column;
          gap: 7px;
          padding: 10px;
          background: var(--bg-base);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-lg);
          box-shadow: var(--shadow-sm);
        }

        .density-option {
          display: flex;
          align-items: center;
          gap: 12px;
          background: var(--bg-deep);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          padding: 10px 12px;
          cursor: pointer;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out);
          text-align: left;
          position: relative;
        }
        .density-option:hover {
          background: var(--bg-float);
          border-color: var(--border-normal);
          transform: translateY(-1px);
        }
        .density-option:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
        .density-option--active {
          border-color: var(--accent-border);
          background: var(--accent-subtle);
          box-shadow: 0 0 0 1px var(--accent-glow) inset;
        }

        .density-preview {
          flex-shrink: 0;
          width: 68px;
          height: 42px;
          background: var(--bg-void);
          border-radius: var(--r-sm);
          border: 1px solid var(--border-subtle);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 4px 6px;
          gap: 0;
        }

        .density-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .density-label {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .density-desc {
          font-size: 11px;
          color: var(--text-muted);
        }
        .density-check {
          flex-shrink: 0;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--accent);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
        }

        /* ── Density preview rows ── */
        .dp-row {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .dp-row--cozy { margin-bottom: 4px; }
        .dp-row--compact { margin-bottom: 2px; }
        .dp-row--ultra { margin-bottom: 0; }

        .dp-avatar {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: var(--accent);
          flex-shrink: 0;
          opacity: 0.6;
        }
        .dp-lines {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;
        }
        .dp-nick {
          height: 3px;
          width: 24px;
          background: var(--accent);
          border-radius: 2px;
          opacity: 0.8;
        }
        .dp-nick--sm { height: 3px; width: 18px; background: var(--accent); border-radius: 2px; opacity: 0.7; }
        .dp-nick--xs { height: 2px; width: 14px; background: var(--accent); border-radius: 2px; opacity: 0.6; }
        .dp-text {
          height: 3px;
          width: 44px;
          background: var(--text-muted);
          border-radius: 2px;
          opacity: 0.4;
        }
        .dp-text--sm { height: 3px; width: 36px; background: var(--text-muted); border-radius: 2px; opacity: 0.35; }
        .dp-text--xs { height: 2px; width: 30px; background: var(--text-muted); border-radius: 2px; opacity: 0.3; }

        /* ── Font size section ── */
        .font-size-section {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 12px;
          background: var(--bg-base);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-lg);
          box-shadow: var(--shadow-sm);
        }

        .theme-slider-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .theme-slider {
          flex: 1;
          accent-color: var(--accent);
          cursor: pointer;
        }

        .theme-slider-label {
          font-size: 11px;
          color: var(--text-muted);
          min-width: 30px;
          text-align: center;
        }

        .font-size-preview {
          color: var(--text-secondary);
          line-height: 1.4;
          margin: 0;
        }

        .zoom-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin: 0;
        }

        .zoom-label {
          font-size: 12px;
          color: var(--text-secondary);
          font-weight: 500;
        }

        .zoom-pct {
          font-size: 12px;
          font-weight: 700;
          color: var(--accent);
          font-variant-numeric: tabular-nums;
        }

        /* ── Time format section ── */
        .tf-options {
          display: flex;
          gap: 8px;
          padding: 10px;
          background: var(--bg-base);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-lg);
          box-shadow: var(--shadow-sm);
        }

        .tf-option {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          padding: 12px 8px;
          background: var(--bg-deep);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          cursor: pointer;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out);
          position: relative;
        }
        .tf-option:hover {
          background: var(--bg-float);
          border-color: var(--border-normal);
          transform: translateY(-1px);
        }
        .tf-option:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
        .tf-option--active {
          border-color: var(--accent-border);
          background: var(--accent-subtle);
          box-shadow: 0 0 0 1px var(--accent-glow) inset;
        }

        .tf-preview {
          font-size: 13px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          color: var(--text-primary);
          letter-spacing: -0.2px;
        }
        .tf-option--active .tf-preview {
          color: var(--accent);
        }

        .tf-label {
          font-size: 11px;
          color: var(--text-muted);
          font-weight: 500;
        }
        .tf-option--active .tf-label {
          color: var(--text-secondary);
        }

        .tf-option .density-check {
          position: absolute;
          top: 5px;
          right: 5px;
          width: 14px;
          height: 14px;
        }

        /* ── Background pattern section ── */
        .bg-patterns {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          padding: 10px;
          background: var(--bg-base);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-lg);
          box-shadow: var(--shadow-sm);
        }

        .bg-pattern-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          background: var(--bg-deep);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          padding: 8px;
          cursor: pointer;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out);
          position: relative;
          flex: 1;
          min-width: 56px;
        }
        .bg-pattern-btn:hover {
          background: var(--bg-float);
          border-color: var(--border-normal);
          transform: translateY(-1px);
        }
        .bg-pattern-btn:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
        .bg-pattern-btn--active {
          border-color: var(--accent-border);
          background: var(--accent-subtle);
          box-shadow: 0 0 0 1px var(--accent-glow) inset;
        }

        .bg-pattern-preview {
          width: 44px;
          height: 28px;
          border-radius: var(--r-xs);
          background: var(--bg-deep);
          border: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }
        .bg-pattern-preview--dots {
          background-image: radial-gradient(circle, rgba(255,255,255,0.15) 1px, transparent 1px);
          background-color: var(--bg-deep);
          background-size: 6px 6px;
        }
        .bg-pattern-preview--grid {
          background-image:
            linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px);
          background-color: var(--bg-deep);
          background-size: 8px 8px;
        }
        .bg-pattern-preview--diagonal {
          background-image: repeating-linear-gradient(
            45deg,
            transparent,
            transparent 5px,
            rgba(255,255,255,0.08) 5px,
            rgba(255,255,255,0.08) 6px
          );
          background-color: var(--bg-deep);
        }
        .bg-pattern-preview--noise {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='60' height='60' filter='url(%23n)' opacity='0.2'/%3E%3C/svg%3E");
          background-color: var(--bg-deep);
          background-size: 60px 60px;
        }

        .bg-pattern-label {
          font-size: 10px;
          font-weight: 600;
          color: var(--text-muted);
          letter-spacing: 0.2px;
          white-space: nowrap;
        }
        .bg-pattern-btn--active .bg-pattern-label {
          color: var(--text-secondary);
        }

        .bg-pattern-check {
          position: absolute;
          top: 4px;
          right: 4px;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--accent);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
        }

        /* ── Motion toggle ── */
        .motion-toggle {
          display: flex;
          align-items: center;
          gap: 12px;
          background: var(--bg-base);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          padding: 10px 12px;
          cursor: pointer;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out);
          text-align: left;
          width: 100%;
        }
        .motion-toggle:hover {
          background: var(--bg-float);
          border-color: var(--border-normal);
          transform: translateY(-1px);
        }
        .motion-toggle:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
        .motion-toggle--active {
          border-color: var(--accent-border);
          background: var(--accent-subtle);
          box-shadow: 0 0 0 1px var(--accent-glow) inset;
        }

        .motion-toggle-icon {
          font-size: 18px;
          flex-shrink: 0;
        }

        .motion-toggle-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .motion-toggle-label {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .motion-toggle-desc {
          font-size: 11px;
          color: var(--text-muted);
        }

        .toggle-track {
          flex-shrink: 0;
          width: 36px;
          height: 20px;
          border-radius: var(--r-full);
          background: var(--bg-overlay);
          position: relative;
        }
        .toggle-track--on {
          background: var(--accent);
        }

        .toggle-thumb {
          position: absolute;
          top: 2px;
          left: 2px;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #fff;
          transition: transform var(--t-fast);
          box-shadow: 0 1px 3px rgba(0,0,0,0.4);
        }
        .toggle-track--on .toggle-thumb {
          transform: translateX(16px);
        }

        /* ── Font family section ── */
        .font-family-options {
          display: flex;
          flex-direction: column;
          gap: 7px;
          padding: 10px;
          background: var(--bg-base);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-lg);
          box-shadow: var(--shadow-sm);
        }

        .font-family-option {
          display: flex;
          align-items: center;
          gap: 12px;
          background: var(--bg-deep);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          padding: 10px 12px;
          cursor: pointer;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out);
          text-align: left;
          position: relative;
        }
        .font-family-option:hover {
          background: var(--bg-float);
          border-color: var(--border-normal);
          transform: translateY(-1px);
        }
        .font-family-option:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
        .font-family-option--active {
          border-color: var(--accent-border);
          background: var(--accent-subtle);
          box-shadow: 0 0 0 1px var(--accent-glow) inset;
        }

        .font-family-preview {
          font-size: 22px;
          font-weight: 600;
          color: var(--text-primary);
          width: 36px;
          text-align: center;
          flex-shrink: 0;
        }

        .font-family-label {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
          flex: 1;
        }

        /* ── Message width section ── */
        .msg-width-options {
          display: flex;
          flex-direction: column;
          gap: 7px;
          padding: 10px;
          background: var(--bg-base);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-lg);
          box-shadow: var(--shadow-sm);
        }

        .msg-width-option {
          display: flex;
          align-items: center;
          gap: 12px;
          background: var(--bg-deep);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          padding: 10px 12px;
          cursor: pointer;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out);
          text-align: left;
          position: relative;
        }
        .msg-width-option:hover {
          background: var(--bg-float);
          border-color: var(--border-normal);
          transform: translateY(-1px);
        }
        .msg-width-option:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
        .msg-width-option--active {
          border-color: var(--accent-border);
          background: var(--accent-subtle);
          box-shadow: 0 0 0 1px var(--accent-glow) inset;
        }

        .msg-width-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .msg-width-label {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .msg-width-desc {
          font-size: 11px;
          color: var(--text-muted);
        }

        /* ── Layout toggles section ── */
        .layout-toggles {
          display: flex;
          flex-direction: column;
          gap: 7px;
          padding: 10px;
          background: var(--bg-base);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-lg);
          box-shadow: var(--shadow-sm);
        }

        /* ── Custom CSS section ── */
        .custom-css-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 12px;
          background: var(--bg-base);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-lg);
          box-shadow: var(--shadow-sm);
        }

        .custom-css-textarea {
          width: 100%;
          background: var(--bg-deep);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          padding: 10px 12px;
          color: var(--text-primary);
          font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
          font-size: 12px;
          line-height: 1.6;
          resize: vertical;
          min-height: 140px;
          outline: none;
        }
        .custom-css-textarea:focus {
          border-color: var(--accent-border);
        }
        .custom-css-textarea::placeholder {
          color: var(--text-muted);
          opacity: 0.6;
        }

        .custom-css-hint {
          font-size: 11px;
          color: var(--text-muted);
          margin: 0;
          line-height: 1.5;
        }

        @media (prefers-reduced-motion: reduce) {
          .theme-modal-backdrop,
          .theme-modal,
          .theme-applied-flash {
            animation: none;
          }

          .theme-modal-close,
          .theme-swatch,
          .theme-swatch-preview,
          .accent-swatch,
          .density-option,
          .tf-option,
          .bg-pattern-btn,
          .motion-toggle,
          .toggle-thumb,
          .font-family-option,
          .msg-width-option {
            transition: none;
          }

          .theme-modal-close:hover,
          .theme-swatch:hover,
          .theme-swatch:hover .theme-swatch-preview,
          .accent-swatch:hover,
          .accent-swatch--active,
          .density-option:hover,
          .tf-option:hover,
          .bg-pattern-btn:hover,
          .motion-toggle:hover,
          .font-family-option:hover,
          .msg-width-option:hover {
            transform: none;
          }
        }
      `}</style>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M1 1l12 12M13 1L1 13" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 5l2.5 2.5 4.5-4.5" />
    </svg>
  );
}
