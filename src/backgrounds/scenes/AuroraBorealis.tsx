// SPDX-License-Identifier: AGPL-3.0-or-later
import { For } from 'solid-js';
import type { SceneProps, SceneVariant } from '../engine';
import { SceneShell, seededRand } from './SceneShell';

/* ── Aurora Borealis: mountain silhouettes, star field, rich flowing curtains,
   light pillars, ground reflection and electric crackles. Ported from
   darkbear's AuroraBg. */

const stars = (() => {
  const rand = seededRand(771);
  return Array.from({ length: 60 }, (_, i) => ({
    x: rand() * 100, y: rand() * 70,
    size: 0.8 + rand() * 2,
    opacity: 0.3 + rand() * 0.7,
    dur: 2 + rand() * 5,
    delay: rand() * 10,
    color: i % 4 === 0 ? '#c4b5fd' : i % 3 === 0 ? '#a78bfa' : '#e2e8f0',
    glow: i % 4 === 0 ? '#c4b5fd' : '#e2e8f0',
  }));
})();

const particles = (() => {
  const rand = seededRand(772);
  return Array.from({ length: 20 }, () => ({
    x: rand() * 100, y: rand() * 60,
    size: 2 + rand() * 4,
    dur: 3 + rand() * 6,
    delay: rand() * 10,
    color: rand() > 0.4 ? '#a78bfa' : rand() > 0.2 ? '#34d399' : '#22d3ee',
  }));
})();

const crackles = (() => {
  const rand = seededRand(773);
  return Array.from({ length: 6 }, () => ({
    x1: 10 + rand() * 80, y1: 5 + rand() * 30,
    x2: 10 + rand() * 80, y2: 10 + rand() * 40,
    dur: 8 + rand() * 8,
    delay: rand() * 12,
  }));
})();

const cols = (() => {
  const rand = seededRand(774);
  const palette = ['#a78bfa', '#34d399', '#22d3ee', '#c084fc', '#818cf8', '#6ee7b7', '#e879f9', '#06b6d4', '#8b5cf6', '#10b981', '#7c3aed', '#0ea5e9', '#a855f7', '#14b8a6'];
  return Array.from({ length: 20 }, (_, i) => ({
    left: i * 5,
    color: palette[i % palette.length]!,
    dur: 4 + rand() * 5,
    delay: rand() * 4,
    h: 50 + rand() * 30,
  }));
})();

const CURTAINS = [
  { c1: '#a78bfa', c2: '#34d399', top: '-10%', h: '70%', dur: '9s', delay: '0s', blur: 25 },
  { c1: '#06b6d4', c2: '#a78bfa', top: '-5%', h: '60%', dur: '13s', delay: '2s', blur: 30 },
  { c1: '#818cf8', c2: '#6366f1', top: '-8%', h: '75%', dur: '17s', delay: '5s', blur: 20 },
  { c1: '#e879f9', c2: '#22d3ee', top: '0%', h: '55%', dur: '11s', delay: '4s', blur: 35 },
  { c1: '#6366f1', c2: '#34d399', top: '-4%', h: '65%', dur: '15s', delay: '7s', blur: 28 },
  { c1: '#34d399', c2: '#c084fc', top: '2%', h: '50%', dur: '10s', delay: '3s', blur: 32 },
  { c1: '#7c3aed', c2: '#06b6d4', top: '-6%', h: '68%', dur: '14s', delay: '6s', blur: 25 },
  { c1: '#22d3ee', c2: '#e879f9', top: '1%', h: '58%', dur: '12s', delay: '8s', blur: 30 },
];

function AuroraBorealisScene(props: SceneProps) {
  return (
    <SceneShell reducedMotion={props.reducedMotion} base="linear-gradient(180deg, #070313 0%, #0b0620 45%, #04020c 100%)">
      {/* Deep space background */}
      <div class="absolute top-0 left-0 right-0 h-[50%]"
        style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(100,60,180,0.25), rgba(50,30,100,0.15) 50%, transparent 80%)', filter: 'blur(6px)' }} />

      {/* Bright star field */}
      <For each={stars}>
        {(s) => (
          <div class="absolute rounded-full"
            style={{ left: `${s.x}%`, top: `${s.y}%`, width: `${s.size}px`, height: `${s.size}px`,
              background: s.color,
              opacity: s.opacity,
              'box-shadow': `0 0 4px ${s.glow}`,
              animation: `au-twinkle ${s.dur}s ease-in-out ${s.delay}s infinite` }} />
        )}
      </For>

      {/* Aurora curtain bands */}
      <For each={CURTAINS}>
        {(c) => (
          <div class="absolute left-0 right-0"
            style={{ top: c.top, height: c.h,
              background: `linear-gradient(180deg, ${c.c1}80 0%, ${c.c1}60 20%, ${c.c2}50 40%, ${c.c2}30 60%, transparent 100%)`,
              animation: `au-curtain ${c.dur} ease-in-out ${c.delay} infinite`,
              filter: `blur(${c.blur}px)` }} />
        )}
      </For>

      {/* Vertical light pillars */}
      <For each={cols}>
        {(col) => (
          <div class="absolute top-0"
            style={{ left: `${col.left}%`, width: '6%', height: `${col.h}%`,
              background: `linear-gradient(180deg, ${col.color}60, ${col.color}40 30%, ${col.color}20 60%, transparent)`,
              animation: `au-col ${col.dur}s ease-in-out ${col.delay}s infinite`,
              filter: 'blur(8px)' }} />
        )}
      </For>

      {/* Aurora reflection on ground */}
      <div class="absolute left-0 right-0" style={{ bottom: '0%', height: '25%' }}>
        <div class="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, rgba(167,139,250,0.3), rgba(52,211,153,0.2) 30%, rgba(34,211,238,0.15) 60%, transparent)',
            filter: 'blur(4px)', animation: 'au-reflect 12s ease-in-out infinite' }} />
      </div>

      {/* Floating aurora particles */}
      <For each={particles}>
        {(p) => (
          <div class="absolute rounded-full"
            style={{ left: `${p.x}%`, top: `${p.y}%`, width: `${p.size}px`, height: `${p.size}px`,
              background: p.color, opacity: 0,
              'box-shadow': `0 0 ${p.size * 8}px ${p.color}`,
              animation: `au-spark ${p.dur}s ease-in-out ${p.delay}s infinite` }} />
        )}
      </For>

      {/* Electric aurora crackles + mountain silhouettes */}
      <svg class="absolute inset-0 w-full h-full">
        <For each={crackles}>
          {(cr) => (
            <line x1={`${cr.x1}%`} y1={`${cr.y1}%`} x2={`${cr.x2}%`} y2={`${cr.y2}%`}
              stroke="rgba(220,200,255,0.8)" stroke-width="1.5" stroke-linecap="round"
              style={{ filter: 'drop-shadow(0 0 3px rgba(220,200,255,0.6))', animation: `au-crackle ${cr.dur}s ease-in-out ${cr.delay}s infinite` }} />
          )}
        </For>
      </svg>
      <svg class="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d="M0,100 L0,88 L6,80 L11,85 L18,68 L24,75 L32,55 L40,70 L48,48 L55,62 L62,40 L68,58 L76,44 L82,60 L90,50 L95,65 L100,58 L100,100 Z"
          fill="rgba(15,15,25,0.8)" />
        <path d="M0,100 L0,92 L8,86 L14,90 L22,80 L30,88 L38,76 L46,82 L54,72 L60,78 L68,68 L74,75 L82,64 L88,70 L94,62 L100,68 L100,100 Z"
          fill="rgba(8,8,18,0.9)" />
        <path d="M0,100 L0,95 L12,90 L18,93 L26,85 L34,91 L42,82 L50,88 L58,78 L66,84 L74,74 L80,80 L88,70 L94,76 L100,72 L100,100 Z"
          fill="rgba(5,5,12,0.95)" />
      </svg>

      <style>{`
        @keyframes au-twinkle { 0%,100%{opacity:inherit} 50%{opacity:0.2} }
        @keyframes au-curtain { 0%,100%{transform:scaleY(1) translateY(0);opacity:1} 30%{transform:scaleY(1.4) translateY(-8%);opacity:0.7} 70%{transform:scaleY(0.8) translateY(6%);opacity:1} }
        @keyframes au-col { 0%,100%{transform:scaleY(1) skewX(0deg);opacity:1} 50%{transform:scaleY(2.2) skewX(4deg);opacity:0.6} }
        @keyframes au-spark { 0%,100%{opacity:0} 25%{opacity:0.8;transform:translateY(-15px)} 75%{opacity:0.7;transform:translateY(10px)} }
        @keyframes au-crackle { 0%,100%{opacity:0} 48%{opacity:0} 49%{opacity:0.9} 50%{opacity:0} 50.5%{opacity:0.7} 51%{opacity:0} }
        @keyframes au-reflect { 0%,100%{opacity:1;transform:scaleX(1)} 50%{opacity:0.6;transform:scaleX(1.1)} }
      `}</style>
    </SceneShell>
  );
}

export const auroraBorealis = {
  id: 'aurora-borealis',
  label: 'Aurora Borealis',
  kind: 'scene',
  component: AuroraBorealisScene,
} as const satisfies SceneVariant;
