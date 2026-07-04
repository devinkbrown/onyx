import { For } from 'solid-js';
import type { SceneProps, SceneVariant } from '../engine';
import { SceneShell, seededRand } from './SceneShell';

/* ── Volcanic: blazing caldera — layered heat glow, lava vein rivers, magma
   pools, smoke columns, flying debris, an ember vortex and three tiers of
   rising sparks. Ported from darkbear's EmberBg. */

const sparksSmall = (() => {
  const rand = seededRand(661);
  return Array.from({ length: 28 }, () => ({
    x: rand() * 100,
    size: 2 + rand() * 3,
    dur: 1.2 + rand() * 1.8,
    delay: rand() * 9,
    drift: (rand() - 0.5) * 80,
  }));
})();

const sparksMed = (() => {
  const rand = seededRand(662);
  return Array.from({ length: 20 }, () => ({
    x: rand() * 100,
    size: 4 + rand() * 4,
    dur: 2 + rand() * 2.5,
    delay: rand() * 10,
    drift: (rand() - 0.5) * 100,
    color: rand() > 0.5 ? '#fbbf24' : '#f97316',
  }));
})();

const sparksLarge = (() => {
  const rand = seededRand(663);
  return Array.from({ length: 14 }, () => ({
    x: rand() * 100,
    size: 6 + rand() * 4,
    dur: 3 + rand() * 4,
    delay: rand() * 12,
    drift: (rand() - 0.5) * 120,
  }));
})();

const debris = (() => {
  const rand = seededRand(664);
  return Array.from({ length: 15 }, () => ({
    x: rand() * 100,
    size: 4 + rand() * 6,
    dur: 4 + rand() * 5,
    delay: rand() * 14,
    rot: rand() * 360,
  }));
})();

const vortex = (() => {
  const rand = seededRand(665);
  return Array.from({ length: 24 }, (_, i) => {
    const angle = (i / 24) * 360;
    const r = 40 + rand() * 35;
    const rad = (angle * Math.PI) / 180;
    return {
      px: Math.cos(rad) * r,
      py: Math.sin(rad) * r,
      size: 3 + rand() * 5,
      dur: 3 + rand() * 3,
      delay: rand() * 4,
      color: rand() > 0.5 ? '#fbbf24' : rand() > 0.3 ? '#f97316' : '#ef4444',
    };
  });
})();

const smoke = (() => {
  const rand = seededRand(666);
  return Array.from({ length: 8 }, () => ({
    x: 10 + rand() * 80,
    dur: 18 + rand() * 12,
    delay: rand() * 10,
    w: 100 + rand() * 120,
  }));
})();

const LAVA_VEINS = [6, 14, 22, 33, 44, 54, 63, 72, 82, 91].map((x, i) => ({
  x,
  w: 4 + (i % 3) * 2,
  h: 25 + (i % 5) * 10,
  hot: i % 2 === 0,
  dur: 3 + i * 0.9,
  delay: i * 0.55,
}));

const LAVA_STREAMS = [78, 83, 87, 91, 95].map((y, i) => ({
  bottom: 100 - y,
  h: 3 + i * 2,
  dur: 5 + i * 1.8,
  delay: i * 1.5,
}));

const MAGMA_POOLS = [20, 50, 78].map((x, i) => ({
  left: x - 12,
  bright: i % 2 === 0,
  dur: 2.5 + i * 1.2,
  delay: i * 0.8,
}));

function VolcanicScene(props: SceneProps) {
  return (
    <SceneShell reducedMotion={props.reducedMotion} base="linear-gradient(180deg, #180705 0%, #240b06 55%, #100402 100%)">
      {/* Intense volcanic glow layers */}
      <div class="absolute bottom-0 left-0 right-0 h-[70%]"
        style={{ background: 'linear-gradient(to top, rgba(249,115,22,0.65), rgba(239,68,68,0.4) 40%, rgba(251,191,36,0.15) 70%, transparent)', animation: 'em-heat 3.5s ease-in-out infinite' }} />
      <div class="absolute bottom-0 left-[5%] right-[5%] h-[60%]"
        style={{ background: 'radial-gradient(ellipse at 50% 100%, rgba(251,191,36,0.55), rgba(249,115,22,0.3) 50%, transparent 70%)', animation: 'em-heat 5s ease-in-out 1s infinite' }} />
      <div class="absolute bottom-0 left-[15%] right-[15%] h-[50%]"
        style={{ background: 'radial-gradient(ellipse at 50% 100%, rgba(239,68,68,0.45), rgba(220,38,127,0.25) 60%, transparent)', animation: 'em-heat 4s ease-in-out 2s infinite' }} />
      <div class="absolute bottom-0 left-[25%] right-[25%] h-[40%]"
        style={{ background: 'radial-gradient(ellipse at 50% 100%, rgba(255,220,80,0.6), transparent 65%)', animation: 'em-heat 4.5s ease-in-out 0.5s infinite' }} />
      <div class="absolute bottom-0 left-[35%] right-[35%] h-[30%]"
        style={{ background: 'radial-gradient(ellipse at 50% 100%, rgba(255,255,120,0.7), transparent 70%)', animation: 'em-heat 3s ease-in-out 1.8s infinite' }} />

      {/* Bright lava vein rivers */}
      <For each={LAVA_VEINS}>
        {(v) => (
          <div class="absolute bottom-0"
            style={{ left: `${v.x}%`, width: `${v.w}px`, height: `${v.h}%`,
              background: `linear-gradient(to top, rgba(${v.hot ? '251,191,36' : '249,115,22'},0.9), rgba(239,68,68,0.6) 60%, rgba(220,38,127,0.3) 80%, transparent)`,
              filter: 'blur(1px)',
              'box-shadow': '0 0 8px rgba(249,115,22,0.6), 0 0 16px rgba(251,191,36,0.3)',
              animation: `em-vein ${v.dur}s ease-in-out ${v.delay}s infinite` }} />
        )}
      </For>

      {/* Flowing lava streams */}
      <For each={LAVA_STREAMS}>
        {(s) => (
          <div class="absolute left-0 right-0"
            style={{ bottom: `${s.bottom}%`, height: `${s.h}px`,
              background: 'linear-gradient(90deg, transparent 5%, rgba(249,115,22,0.5) 20%, rgba(251,191,36,0.8) 50%, rgba(249,115,22,0.5) 80%, transparent 95%)',
              animation: `em-flow ${s.dur}s ease-in-out ${s.delay}s infinite` }} />
        )}
      </For>

      {/* Glowing magma pools */}
      <For each={MAGMA_POOLS}>
        {(p) => (
          <div class="absolute bottom-0"
            style={{ left: `${p.left}%`, width: '24%', height: '10%',
              background: `radial-gradient(ellipse, rgba(${p.bright ? '255,220,80' : '251,191,36'},0.8), rgba(249,115,22,0.5) 40%, rgba(239,68,68,0.3) 70%, transparent)`,
              'border-radius': '50%', filter: 'blur(2px)',
              'box-shadow': '0 0 30px rgba(251,191,36,0.6), 0 0 60px rgba(249,115,22,0.3)',
              animation: `em-pool ${p.dur}s ease-in-out ${p.delay}s infinite` }} />
        )}
      </For>

      {/* Visible heat shimmer */}
      <div class="absolute bottom-0 left-0 right-0 h-[45%]"
        style={{ background: 'linear-gradient(to top, rgba(255,200,100,0.25), rgba(255,160,50,0.15) 50%, transparent)', filter: 'blur(3px)', animation: 'em-shimmer 1.8s ease-in-out infinite' }} />

      {/* Dense smoke columns */}
      <For each={smoke}>
        {(s) => (
          <div class="absolute bottom-[3%]"
            style={{ left: `${s.x}%`, width: `${s.w}px`, height: '75%',
              background: 'linear-gradient(to top, rgba(80,50,50,0.7), rgba(60,40,40,0.5) 30%, rgba(40,30,30,0.3) 60%, rgba(20,15,15,0.15) 80%, transparent)',
              filter: 'blur(12px)', animation: `em-smoke ${s.dur}s ease-in-out ${s.delay}s infinite` }} />
        )}
      </For>

      {/* Flying rock debris */}
      <For each={debris}>
        {(d) => (
          <div class="absolute"
            style={{ left: `${d.x}%`, bottom: '0', width: `${d.size}px`, height: `${d.size * 0.8}px`,
              background: 'rgba(80,40,15,0.8)', 'border-radius': '3px', opacity: 0,
              transform: `rotate(${d.rot}deg)`,
              'box-shadow': '0 0 4px rgba(80,40,15,0.4)',
              animation: `em-debris ${d.dur}s ease-out ${d.delay}s infinite` }} />
        )}
      </For>

      {/* Ember vortex swirl */}
      <div class="absolute" style={{ left: '50%', bottom: '18%', width: '0', height: '0' }}>
        <For each={vortex}>
          {(v) => (
            <div class="absolute rounded-full"
              style={{ left: `${v.px}px`, top: `${v.py}px`, width: `${v.size}px`, height: `${v.size}px`,
                background: v.color, opacity: 0,
                'box-shadow': `0 0 ${v.size * 5}px ${v.color}`,
                animation: `em-vortex ${v.dur}s ease-in-out ${v.delay}s infinite` }} />
          )}
        </For>
      </div>

      {/* Bright rising sparks */}
      <For each={sparksSmall}>
        {(s) => (
          <div class="absolute rounded-full"
            style={{ left: `${s.x}%`, bottom: '0', width: `${s.size}px`, height: `${s.size}px`,
              background: '#fde68a', opacity: 0,
              'box-shadow': '0 0 10px #fbbf24, 0 0 20px rgba(251,191,36,0.4)',
              animation: `em-sparkS ${s.dur}s ease-out ${s.delay}s infinite`,
              ['--dr' as string]: `${s.drift}px` }} />
        )}
      </For>

      {/* Medium ember particles */}
      <For each={sparksMed}>
        {(s) => (
          <div class="absolute rounded-full"
            style={{ left: `${s.x}%`, bottom: '0', width: `${s.size}px`, height: `${s.size}px`,
              background: s.color, opacity: 0,
              'box-shadow': `0 0 ${s.size * 4}px ${s.color}, 0 0 ${s.size * 8}px rgba(249,115,22,0.3)`,
              animation: `em-sparkM ${s.dur}s ease-out ${s.delay}s infinite`,
              ['--dr' as string]: `${s.drift}px` }} />
        )}
      </For>

      {/* Large glowing cinders */}
      <For each={sparksLarge}>
        {(s) => (
          <div class="absolute rounded-full"
            style={{ left: `${s.x}%`, bottom: '0', width: `${s.size}px`, height: `${s.size}px`,
              background: '#ef4444', opacity: 0,
              'box-shadow': `0 0 ${s.size * 6}px rgba(239,68,68,0.8), 0 0 ${s.size * 12}px rgba(220,38,127,0.4)`,
              animation: `em-sparkL ${s.dur}s ease-out ${s.delay}s infinite`,
              ['--dr' as string]: `${s.drift}px` }} />
        )}
      </For>

      <style>{`
        @keyframes em-heat { 0%,100%{opacity:1} 50%{opacity:1.4} }
        @keyframes em-vein { 0%,100%{opacity:1;transform:scaleY(1)} 50%{opacity:0.7;transform:scaleY(0.9)} }
        @keyframes em-flow { 0%,100%{transform:translateX(-8%) scaleX(1)} 50%{transform:translateX(8%) scaleX(1.15)} }
        @keyframes em-pool { 0%,100%{transform:scaleX(1) scaleY(1);opacity:1} 50%{transform:scaleX(1.3) scaleY(1.5);opacity:0.7} }
        @keyframes em-shimmer { 0%,100%{transform:translateX(0) skewX(0deg)} 33%{transform:translateX(4px) skewX(0.8deg)} 66%{transform:translateX(-4px) skewX(-0.8deg)} }
        @keyframes em-smoke { 0%,100%{transform:translateY(0) scaleX(1);opacity:1} 50%{transform:translateY(-50px) scaleX(1.6);opacity:0.5} }
        @keyframes em-debris { 0%{opacity:0.8;transform:translateY(0) rotate(0deg)} 15%{opacity:0.7} 100%{opacity:0;transform:translateY(-400px) translateX(60px) rotate(900deg)} }
        @keyframes em-vortex { 0%,100%{opacity:0;transform:translate(-50%,-50%) scale(0.2)} 50%{opacity:0.9;transform:translate(-50%,-50%) scale(1.3)} }
        @keyframes em-sparkS { 0%{opacity:0.9;transform:translateY(0) translateX(0)} 100%{opacity:0;transform:translateY(-280px) translateX(var(--dr))} }
        @keyframes em-sparkM { 0%{opacity:0.8;transform:translateY(0) translateX(0)} 30%{opacity:0.6} 100%{opacity:0;transform:translateY(-380px) translateX(var(--dr))} }
        @keyframes em-sparkL { 0%{opacity:0.7;transform:translateY(0) translateX(0)} 40%{opacity:0.5} 100%{opacity:0;transform:translateY(-480px) translateX(var(--dr))} }
      `}</style>
    </SceneShell>
  );
}

export const volcanic = {
  id: 'volcanic',
  label: 'Volcanic',
  kind: 'scene',
  component: VolcanicScene,
} as const satisfies SceneVariant;
