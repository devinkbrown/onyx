// SPDX-License-Identifier: AGPL-3.0-or-later
import { For, Show } from 'solid-js';
import type { SceneProps, SceneVariant } from '../engine';
import { SceneShell, seededRand } from './SceneShell';

/* ── Tokyo Night: dense neon cityscape — building silhouettes with blinking
   windows, driving rain, colorful puddle reflections, drifting clouds, fog,
   neon sign glows, car headlights and a distant lightning flash. Ported from
   darkbear's TokyoNightBg. */

const WINDOW_COLORS = ['#54acf1', '#ff9e64', '#9ece6a', '#5ce0d6', '#7dcfff', '#e0af68', '#f7768e'];

const buildings = (() => {
  const rand = seededRand(779);
  return Array.from({ length: 20 }, (_, i) => {
    const windowCount = Math.floor(4 + rand() * 10);
    return {
      x: i * 5 + rand() * 3,
      w: 2.5 + rand() * 5,
      h: 15 + rand() * 50,
      spire: rand() > 0.5,
      spireH: 6 + rand() * 15,
      windows: Array.from({ length: windowCount }, (_, wi) => ({
        top: 6 + wi * (85 / windowCount),
        color: WINDOW_COLORS[wi % 7]!,
        dur: 1.5 + (wi + i) * 0.3,
        delay: i * 0.15 + wi * 0.25,
      })),
    };
  });
})();

const rain = (() => {
  const rand = seededRand(780);
  return Array.from({ length: 40 }, () => ({
    x: rand() * 110,
    dur: 0.4 + rand() * 0.8,
    delay: rand() * 3,
    h: 18 + rand() * 35,
    angle: 8 + rand() * 15,
  }));
})();

const puddles = (() => {
  const rand = seededRand(781);
  return Array.from({ length: 15 }, () => ({
    x: rand() * 85, w: 40 + rand() * 80,
    dur: 2 + rand() * 2, delay: rand() * 4,
    color: ['#54acf1', '#5ce0d6', '#ff9e64', '#9ece6a'][Math.floor(rand() * 4)]!,
  }));
})();

const cars = (() => {
  const rand = seededRand(782);
  return Array.from({ length: 10 }, (_, i) => ({
    anim: i < 5 ? 'tn-carL' : 'tn-carR',
    speed: 4 + rand() * 8,
    delay: rand() * 15,
    color: ['#ff9e64', '#54acf1', '#9ece6a', '#e0af68', '#5ce0d6', '#7dcfff', '#f7768e', '#73daca', '#2ac3de', '#e0af68'][i]!,
    y: 0.1 + rand() * 1.2,
  }));
})();

const clouds = (() => {
  const rand = seededRand(783);
  return Array.from({ length: 5 }, () => ({
    y: 2 + rand() * 15, w: 100 + rand() * 150, h: 40 + rand() * 50,
    dur: 35 + rand() * 25, delay: rand() * 20,
  }));
})();

const neons = (() => {
  const rand = seededRand(784);
  return [
    { x: 15, y: 25, color: '#ff9e64', dur: 3, delay: 0 },
    { x: 35, y: 20, color: '#5ce0d6', dur: 4, delay: 1.5 },
    { x: 55, y: 30, color: '#7dcfff', dur: 2.5, delay: 0.8 },
    { x: 75, y: 22, color: '#9ece6a', dur: 5, delay: 2.5 },
    { x: 25, y: 35, color: '#f7768e', dur: 3.5, delay: 3 },
    { x: 65, y: 18, color: '#e0af68', dur: 4.5, delay: 1 },
  ].map((n, i) => ({ ...n, w: 100 + rand() * 120, h: 30 + rand() * 25, anim: `tn-neon${i + 1}` }));
})();

function TokyoNightScene(props: SceneProps) {
  return (
    <SceneShell reducedMotion={props.reducedMotion} base="linear-gradient(180deg, #0a1420 0%, #0f1e2b 55%, #060b12 100%)">
      {/* Dark cyberpunk sky */}
      <div class="absolute top-0 left-0 right-0 h-[70%]"
        style={{ background: 'linear-gradient(180deg, rgba(0,24,44,0.8), rgba(84,172,241,0.25) 60%, rgba(93,182,254,0.15) 80%, transparent)' }} />

      {/* City glow horizon */}
      <div class="absolute left-0 right-0" style={{ bottom: '25%', height: '20%' }}>
        <div class="absolute inset-0" style={{
          background: 'linear-gradient(180deg, transparent, rgba(84,172,241,0.3) 30%, rgba(93,182,254,0.2) 60%, rgba(255,158,100,0.1) 80%, transparent)',
          filter: 'blur(6px)' }} />
      </div>

      {/* Dense moving clouds */}
      <For each={clouds}>
        {(cl) => (
          <div class="absolute"
            style={{ top: `${cl.y}%`, left: '-20%', width: `${cl.w}px`, height: `${cl.h}px`,
              background: 'radial-gradient(ellipse, rgba(31,64,90,0.6), rgba(7,43,70,0.3) 60%, transparent)',
              filter: 'blur(12px)', 'border-radius': '50%',
              animation: `tn-cloud ${cl.dur}s linear ${cl.delay}s infinite` }} />
        )}
      </For>

      {/* Atmospheric fog layers */}
      <div class="absolute left-0 right-0" style={{ bottom: '30%', height: '20%',
        background: 'linear-gradient(180deg, transparent, rgba(34,83,121,0.4) 40%, rgba(6,63,100,0.3) 70%, transparent)',
        filter: 'blur(10px)' }} />
      <div class="absolute left-0 right-0" style={{ bottom: '20%', height: '15%',
        background: 'linear-gradient(180deg, transparent, rgba(57,103,141,0.3) 50%, transparent)',
        filter: 'blur(8px)' }} />

      {/* Neon sign glows */}
      <For each={neons}>
        {(n) => (
          <div class="absolute rounded-full"
            style={{ left: `${n.x}%`, top: `${n.y}%`, width: `${n.w}px`, height: `${n.h}px`,
              background: `radial-gradient(ellipse, ${n.color}60, ${n.color}30 50%, transparent 80%)`,
              filter: 'blur(8px)',
              'box-shadow': `0 0 20px ${n.color}80, 0 0 40px ${n.color}40`,
              animation: `${n.anim} ${n.dur}s ease-in-out ${n.delay}s infinite` }} />
        )}
      </For>

      {/* Dark street ground */}
      <div class="absolute bottom-0 left-0 right-0 h-[15%]"
        style={{ background: 'linear-gradient(180deg, rgba(15,28,40,0.9), rgba(15,15,25,0.95))' }} />

      {/* Building silhouettes */}
      <For each={buildings}>
        {(b) => (
          <div class="absolute bottom-[15%]"
            style={{ left: `${b.x}%`, width: `${b.w}%`, height: `${b.h}%`,
              background: 'rgba(10,23,35,0.95)',
              'border-top': '2px solid rgba(50,98,137,0.6)',
              'box-shadow': 'inset 0 1px 0 rgba(50,98,137,0.3)' }}>
            <Show when={b.spire}>
              <div style={{ position: 'absolute', left: '45%', top: `-${b.spireH}px`, width: '3px', height: `${b.spireH}px`,
                background: 'rgba(84,172,241,0.6)',
                'box-shadow': '0 0 6px rgba(84,172,241,0.8)' }} />
            </Show>
            <For each={b.windows}>
              {(w) => (
                <div class="absolute"
                  style={{ left: '12%', right: '12%', height: '5px',
                    top: `${w.top}%`,
                    background: w.color,
                    opacity: 0, 'border-radius': '2px',
                    'box-shadow': `0 0 8px ${w.color}`,
                    animation: `tn-blink ${w.dur}s ease-in-out ${w.delay}s infinite` }} />
              )}
            </For>
          </div>
        )}
      </For>

      {/* Bright street reflections */}
      <div class="absolute bottom-[15%] left-0 right-0 h-[2px]"
        style={{ background: 'linear-gradient(90deg, rgba(84,172,241,0.4), rgba(93,182,254,0.3), rgba(255,158,100,0.2))', filter: 'blur(1px)' }} />

      {/* Colorful puddle reflections */}
      <For each={puddles}>
        {(p) => (
          <div class="absolute bottom-[15%]"
            style={{ left: `${p.x}%`, width: `${p.w}px`, height: '8px',
              background: `linear-gradient(90deg, transparent, ${p.color}50 30%, ${p.color}70 50%, ${p.color}50 70%, transparent)`,
              filter: 'blur(2px)', 'border-radius': '50%',
              animation: `tn-puddle ${p.dur}s ease-in-out ${p.delay}s infinite` }} />
        )}
      </For>

      {/* Heavy rain */}
      <For each={rain}>
        {(r) => (
          <div class="absolute opacity-0"
            style={{ left: `${r.x}%`, top: '-8%', width: '2px', height: `${r.h}px`,
              background: 'linear-gradient(180deg, transparent, rgba(84,172,241,0.6), rgba(84,172,241,0.4))',
              transform: `rotate(${r.angle}deg)`,
              animation: `tn-rain ${r.dur}s linear ${r.delay}s infinite` }} />
        )}
      </For>

      {/* Bright car headlights */}
      <For each={cars}>
        {(car) => (
          <div class="absolute rounded-full"
            style={{ bottom: `${15 + car.y * 2}%`, width: '8px', height: '3px',
              background: car.color,
              'box-shadow': `0 0 15px ${car.color}, 0 0 30px ${car.color}80`,
              animation: `${car.anim} ${car.speed}s linear ${car.delay}s infinite` }} />
        )}
      </For>

      {/* Intense lightning flash */}
      <div class="absolute inset-0" style={{ animation: 'tn-lightning 12s ease-in-out infinite' }} />

      <style>{`
        @keyframes tn-blink { 0%,100%{opacity:0.2} 40%{opacity:0.9} 60%{opacity:0.9} }
        @keyframes tn-carL { 0%{left:-3%;opacity:0} 8%{opacity:0.9} 92%{opacity:0.9} 100%{left:105%;opacity:0} }
        @keyframes tn-carR { 0%{right:-3%;opacity:0} 8%{opacity:0.9} 92%{opacity:0.9} 100%{right:105%;opacity:0} }
        @keyframes tn-rain { 0%{opacity:0;transform:translateY(0)} 10%{opacity:0.7} 90%{opacity:0.4} 100%{opacity:0;transform:translateY(115vh)} }
        @keyframes tn-neon1 { 0%,100%{opacity:1} 48%{opacity:0.3} 52%{opacity:1} }
        @keyframes tn-neon2 { 0%,100%{opacity:0.9} 50%{opacity:0.2} }
        @keyframes tn-neon3 { 0%,100%{opacity:1} 33%{opacity:0.5} 36%{opacity:1} 66%{opacity:0.4} 69%{opacity:1} }
        @keyframes tn-neon4 { 0%,100%{opacity:0.9} 50%{opacity:0.6} }
        @keyframes tn-neon5 { 0%,100%{opacity:1} 25%{opacity:0.3} 27%{opacity:1} 75%{opacity:0.4} 77%{opacity:1} }
        @keyframes tn-neon6 { 0%,100%{opacity:0.8} 50%{opacity:0.3} }
        @keyframes tn-cloud { 0%{transform:translateX(0)} 100%{transform:translateX(125vw)} }
        @keyframes tn-puddle { 0%,100%{opacity:0.8;transform:scaleX(1)} 50%{opacity:0.4;transform:scaleX(1.4)} }
        @keyframes tn-lightning { 0%,100%{background:transparent} 52%{background:transparent} 52.2%{background:rgba(84,172,241,0.15)} 52.4%{background:transparent} 52.8%{background:rgba(84,172,241,0.25)} 53%{background:transparent} }
      `}</style>
    </SceneShell>
  );
}

export const tokyoNight = {
  id: 'tokyo-night',
  label: 'Tokyo Night',
  kind: 'scene',
  component: TokyoNightScene,
} as const satisfies SceneVariant;
