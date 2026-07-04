import { For } from 'solid-js';
import type { SceneProps, SceneVariant } from '../engine';
import { SceneShell, seededRand } from './SceneShell';

/* ── Starfield: deep space — Milky Way band, tiered twinkling stars, nebulae,
   spiral galaxies, supernovae with lens flares, shooting stars, star clusters.
   Ported from darkbear's standalone StarfieldBg (fixed colorway). */

const stars = (() => {
  const rand = seededRand(7);
  return Array.from({ length: 280 }, () => {
    const r = rand();
    const tier = r < 0.55 ? 0 : r < 0.82 ? 1 : r < 0.94 ? 2 : 3;
    const size = tier === 0 ? 0.4 + rand() * 0.8
      : tier === 1 ? 1.2 + rand() * 1
      : tier === 2 ? 2.2 + rand() * 1
      : 3.2 + rand() * 0.8;
    const hueRoll = rand();
    const color = hueRoll < 0.45 ? '#e8eeff'
      : hueRoll < 0.65 ? '#a0b4ff'
      : hueRoll < 0.8 ? '#ffd6aa'
      : hueRoll < 0.92 ? '#c8a0ff'
      : '#ffe0e0';
    return {
      x: rand() * 100, y: rand() * 100, size, color,
      opacity: tier === 3 ? 0.6 + rand() * 0.35 : tier === 2 ? 0.4 + rand() * 0.4 : 0.1 + rand() * 0.5,
      delay: rand() * 12,
      dur: tier === 3 ? 1.5 + rand() * 2.5 : 2 + rand() * 5,
      glow: tier >= 2 ? `0 0 ${size * 4}px ${color}${tier === 3 ? '88' : '55'}` : undefined,
    };
  });
})();

const milkyWayStars = (() => {
  const rand = seededRand(314);
  return Array.from({ length: 200 }, () => {
    const t = rand();
    const cx = 20 + t * 60;
    const cy = 35 + t * 30;
    const spread = 8 + rand() * 12;
    return {
      x: cx + (rand() - 0.5) * spread * 2,
      y: cy + (rand() - 0.5) * spread,
      size: 0.3 + rand() * 0.8,
      opacity: 0.08 + rand() * 0.25,
      dur: 3 + rand() * 5,
      delay: rand() * 10,
    };
  });
})();

interface ClusterDot {
  left: number; top: number; size: number; opacity: number; dur: number; delay: number;
}

function clusterDots(count: number, phase: number, center: number, rBase: number, rStep: number, rMod: number, sizeBase: number, sizeStep: number, opBase: number, opStep: number, opMod: number, durBase: number, durStep: number, delayStep: number): ClusterDot[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + phase;
    const r = rBase + (i % rMod) * rStep;
    return {
      left: center + Math.cos(angle) * r,
      top: center + Math.sin(angle) * r,
      size: sizeBase + (i % 3) * sizeStep,
      opacity: opBase + (i % opMod) * opStep,
      dur: durBase + i * durStep,
      delay: i * delayStep,
    };
  });
}

const cluster1 = clusterDots(20, 0, 40, 5, 7, 5, 0.8, 0.5, 0.3, 0.15, 4, 2.5, 0.25, 0.2);
const cluster2 = clusterDots(14, 0.5, 30, 4, 6, 4, 0.7, 0.4, 0.25, 0.18, 3, 3, 0.3, 0.25);
const cluster3 = clusterDots(10, 1, 22, 3, 5, 3, 0.6, 0.4, 0.3, 0.15, 3, 2.8, 0.35, 0.3);

const SHOOTERS = [
  { top: '6%', left: '12%', delay: '0.5s', cls: 'sf-shooter sf-shooter-fast' },
  { top: '25%', left: '60%', delay: '3s', cls: 'sf-shooter' },
  { top: '45%', left: '85%', delay: '5.5s', cls: 'sf-shooter sf-shooter-long' },
  { top: '70%', left: '15%', delay: '8s', cls: 'sf-shooter sf-shooter-fast' },
  { top: '18%', left: '38%', delay: '11s', cls: 'sf-shooter sf-shooter-long' },
  { top: '55%', left: '45%', delay: '14s', cls: 'sf-shooter' },
  { top: '80%', left: '55%', delay: '17s', cls: 'sf-shooter sf-shooter-long sf-shooter-fast' },
  { top: '35%', left: '25%', delay: '20s', cls: 'sf-shooter' },
  { top: '15%', left: '75%', delay: '23s', cls: 'sf-shooter sf-shooter-fast' },
  { top: '90%', left: '30%', delay: '26s', cls: 'sf-shooter sf-shooter-long' },
  { top: '42%', left: '8%', delay: '29s', cls: 'sf-shooter' },
  { top: '62%', left: '70%', delay: '32s', cls: 'sf-shooter sf-shooter-fast' },
];

function StarfieldScene(props: SceneProps) {
  return (
    <SceneShell reducedMotion={props.reducedMotion} base="radial-gradient(ellipse at 30% 25%, #0c1030 0%, #070a1c 45%, #04050e 100%)">
      {/* Milky Way band — diagonal haze */}
      <div class="absolute inset-0" style={{
        background: 'linear-gradient(135deg, transparent 15%, rgba(160,180,255,0.04) 30%, rgba(200,180,255,0.06) 45%, rgba(180,190,255,0.05) 55%, rgba(160,180,255,0.03) 70%, transparent 85%)',
        filter: 'blur(40px)',
      }} />
      <div class="absolute inset-0" style={{
        background: 'linear-gradient(135deg, transparent 20%, rgba(255,220,180,0.02) 40%, rgba(255,200,160,0.03) 50%, rgba(255,220,180,0.02) 60%, transparent 80%)',
        filter: 'blur(60px)',
      }} />

      {/* Dense Milky Way star cluster */}
      <For each={milkyWayStars}>
        {(s) => (
          <div class="absolute rounded-full bg-white"
            style={{
              left: `${s.x}%`, top: `${s.y}%`,
              width: `${s.size}px`, height: `${s.size}px`,
              opacity: s.opacity,
              animation: `sf-twinkle ${s.dur}s ease-in-out ${s.delay}s infinite`,
            }} />
        )}
      </For>

      {/* Main star field with slow drift */}
      <div class="absolute inset-0" style={{ animation: 'sf-field-drift 180s linear infinite' }}>
        <For each={stars}>
          {(s) => (
            <div class="absolute rounded-full"
              style={{
                left: `${s.x}%`, top: `${s.y}%`,
                width: `${s.size}px`, height: `${s.size}px`,
                background: s.color, opacity: s.opacity,
                'box-shadow': s.glow,
                animation: `sf-twinkle ${s.dur}s ease-in-out ${s.delay}s infinite`,
              }} />
          )}
        </For>
      </div>

      {/* Nebula clouds — vivid, large */}
      <div class="absolute w-[800px] h-[800px] sm:w-[1200px] sm:h-[1200px] -top-[300px] -right-[250px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(129,140,248,0.14) 0%, rgba(129,140,248,0.04) 35%, transparent 55%)', animation: 'sf-drift-a 40s ease-in-out infinite', filter: 'blur(20px)' }} />
      <div class="absolute w-[700px] h-[700px] sm:w-[1000px] sm:h-[1000px] -bottom-[350px] -left-[250px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(192,132,252,0.12) 0%, rgba(192,132,252,0.03) 35%, transparent 55%)', animation: 'sf-drift-b 48s ease-in-out infinite', filter: 'blur(20px)' }} />
      <div class="absolute w-[500px] h-[500px] top-[25%] left-[50%] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(45,212,191,0.08) 0%, transparent 50%)', animation: 'sf-drift-c 35s ease-in-out infinite', filter: 'blur(15px)' }} />
      {/* Warm nebula wisp */}
      <div class="absolute w-[600px] h-[300px] top-[10%] left-[5%] rounded-full"
        style={{ background: 'radial-gradient(ellipse, rgba(255,180,120,0.06) 0%, transparent 55%)', transform: 'rotate(-25deg)', animation: 'sf-drift-c 55s ease-in-out infinite', filter: 'blur(25px)' }} />
      <div class="absolute w-[500px] h-[250px] bottom-[12%] right-[3%] rounded-full"
        style={{ background: 'radial-gradient(ellipse, rgba(192,132,252,0.07) 0%, transparent 55%)', transform: 'rotate(18deg)', animation: 'sf-drift-a 50s ease-in-out infinite', filter: 'blur(25px)' }} />
      {/* Deep rose cloud */}
      <div class="absolute w-[400px] h-[400px] top-[50%] left-[25%] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(255,120,150,0.05) 0%, transparent 50%)', animation: 'sf-drift-b 42s ease-in-out infinite', filter: 'blur(20px)' }} />

      {/* Galaxy 1 — spiral with arms */}
      <div class="absolute" style={{ top: '15%', right: '10%', width: '120px', height: '120px', animation: 'sf-galaxy-spin 100s linear infinite' }}>
        <div class="absolute inset-0 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(200,210,255,0.25) 0%, rgba(129,140,248,0.08) 30%, transparent 55%)' }} />
        <svg class="absolute inset-0" viewBox="0 0 120 120" style={{ opacity: 0.15 }}>
          <path d="M60 60 Q75 45 82 30 Q87 18 78 14 Q69 12 63 27 Q58 42 60 60" fill="rgba(200,210,255,0.6)" />
          <path d="M60 60 Q45 75 38 90 Q33 102 42 106 Q51 108 57 93 Q62 78 60 60" fill="rgba(200,210,255,0.6)" />
          <path d="M60 60 Q75 72 87 78 Q99 82 102 72 Q102 62 87 60 Q72 58 60 60" fill="rgba(180,190,255,0.5)" />
          <path d="M60 60 Q45 48 33 42 Q21 38 18 48 Q18 58 33 60 Q48 62 60 60" fill="rgba(180,190,255,0.5)" />
        </svg>
        <div class="absolute rounded-full" style={{ top: '40%', left: '40%', width: '20%', height: '20%', background: 'radial-gradient(circle, rgba(255,255,255,0.4) 0%, rgba(200,210,255,0.1) 60%, transparent 100%)', 'box-shadow': '0 0 15px rgba(200,210,255,0.2)' }} />
      </div>

      {/* Galaxy 2 — smaller, purple tint */}
      <div class="absolute" style={{ bottom: '22%', left: '6%', width: '75px', height: '75px', animation: 'sf-galaxy-spin 80s linear infinite reverse' }}>
        <div class="absolute inset-0 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(192,132,252,0.2) 0%, rgba(192,132,252,0.06) 30%, transparent 55%)' }} />
        <svg class="absolute inset-0" viewBox="0 0 75 75" style={{ opacity: 0.12 }}>
          <path d="M37.5 37.5 Q50 28 53 18 Q55 10 49 9 Q43 9 40 18 Q37 28 37.5 37.5" fill="rgba(220,180,255,0.6)" />
          <path d="M37.5 37.5 Q25 47 22 57 Q20 65 26 66 Q32 66 35 57 Q38 47 37.5 37.5" fill="rgba(220,180,255,0.6)" />
        </svg>
        <div class="absolute rounded-full" style={{ top: '40%', left: '40%', width: '20%', height: '20%', background: 'radial-gradient(circle, rgba(255,255,255,0.25), transparent 70%)', 'box-shadow': '0 0 10px rgba(192,132,252,0.15)' }} />
      </div>

      {/* Galaxy 3 — tiny deep field */}
      <div class="absolute" style={{ top: '60%', right: '30%', width: '35px', height: '35px', animation: 'sf-galaxy-spin 150s linear infinite', opacity: 0.5 }}>
        <div class="absolute inset-0 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(45,212,191,0.25) 0%, transparent 55%)' }} />
        <div class="absolute rounded-full" style={{ top: '40%', left: '40%', width: '20%', height: '20%', background: 'rgba(255,255,255,0.15)' }} />
      </div>

      {/* Supernova 1 — bright indigo with lens flare */}
      <div class="absolute" style={{ top: '38%', left: '80%' }}>
        <div class="absolute rounded-full" style={{ width: '70px', height: '70px', top: '-32px', left: '-32px', background: 'radial-gradient(circle, rgba(129,140,248,0.25) 0%, transparent 55%)', animation: 'sf-nova 7s ease-in-out infinite' }} />
        <div class="absolute" style={{ width: '50px', height: '2px', top: '2px', left: '-22px', background: 'linear-gradient(90deg, transparent, rgba(200,210,255,0.4), rgba(255,255,255,0.8), rgba(200,210,255,0.4), transparent)', animation: 'sf-nova 7s ease-in-out infinite' }} />
        <div class="absolute" style={{ width: '2px', height: '50px', top: '-22px', left: '2px', background: 'linear-gradient(180deg, transparent, rgba(200,210,255,0.4), rgba(255,255,255,0.8), rgba(200,210,255,0.4), transparent)', animation: 'sf-nova 7s ease-in-out infinite' }} />
        <div class="absolute" style={{ width: '35px', height: '1px', top: '2.5px', left: '-14.5px', background: 'linear-gradient(90deg, transparent, rgba(200,210,255,0.2), transparent)', transform: 'rotate(45deg)', animation: 'sf-nova 7s ease-in-out infinite' }} />
        <div class="absolute" style={{ width: '35px', height: '1px', top: '2.5px', left: '-14.5px', background: 'linear-gradient(90deg, transparent, rgba(200,210,255,0.2), transparent)', transform: 'rotate(-45deg)', animation: 'sf-nova 7s ease-in-out infinite' }} />
        <div class="rounded-full" style={{ width: '6px', height: '6px', background: 'radial-gradient(circle, #fff, rgba(129,140,248,0.5))', 'box-shadow': '0 0 12px rgba(129,140,248,0.6), 0 0 25px rgba(129,140,248,0.2)' }} />
      </div>

      {/* Supernova 2 — purple */}
      <div class="absolute" style={{ top: '68%', left: '32%' }}>
        <div class="absolute rounded-full" style={{ width: '50px', height: '50px', top: '-22px', left: '-22px', background: 'radial-gradient(circle, rgba(192,132,252,0.2) 0%, transparent 55%)', animation: 'sf-nova 11s ease-in-out 2s infinite' }} />
        <div class="absolute" style={{ width: '40px', height: '1.5px', top: '2px', left: '-17px', background: 'linear-gradient(90deg, transparent, rgba(220,200,255,0.4), rgba(255,255,255,0.7), rgba(220,200,255,0.4), transparent)', animation: 'sf-nova 11s ease-in-out 2s infinite' }} />
        <div class="absolute" style={{ width: '1.5px', height: '40px', top: '-17px', left: '2px', background: 'linear-gradient(180deg, transparent, rgba(220,200,255,0.4), rgba(255,255,255,0.7), rgba(220,200,255,0.4), transparent)', animation: 'sf-nova 11s ease-in-out 2s infinite' }} />
        <div class="rounded-full" style={{ width: '5px', height: '5px', background: 'radial-gradient(circle, #fff, rgba(192,132,252,0.4))', 'box-shadow': '0 0 10px rgba(192,132,252,0.5)' }} />
      </div>

      {/* Supernova 3 — teal */}
      <div class="absolute" style={{ top: '10%', left: '20%' }}>
        <div class="absolute rounded-full" style={{ width: '45px', height: '45px', top: '-20px', left: '-20px', background: 'radial-gradient(circle, rgba(45,212,191,0.18) 0%, transparent 55%)', animation: 'sf-nova 9s ease-in-out 5s infinite' }} />
        <div class="absolute" style={{ width: '34px', height: '1.5px', top: '2px', left: '-14px', background: 'linear-gradient(90deg, transparent, rgba(180,240,230,0.35), rgba(255,255,255,0.6), rgba(180,240,230,0.35), transparent)', animation: 'sf-nova 9s ease-in-out 5s infinite' }} />
        <div class="absolute" style={{ width: '1.5px', height: '34px', top: '-14px', left: '2px', background: 'linear-gradient(180deg, transparent, rgba(180,240,230,0.35), rgba(255,255,255,0.6), rgba(180,240,230,0.35), transparent)', animation: 'sf-nova 9s ease-in-out 5s infinite' }} />
        <div class="rounded-full" style={{ width: '4px', height: '4px', background: 'radial-gradient(circle, #fff, rgba(45,212,191,0.3))', 'box-shadow': '0 0 8px rgba(45,212,191,0.4)' }} />
      </div>

      {/* Supernova 4 — warm amber */}
      <div class="absolute" style={{ top: '82%', left: '72%' }}>
        <div class="absolute rounded-full" style={{ width: '40px', height: '40px', top: '-17px', left: '-17px', background: 'radial-gradient(circle, rgba(251,191,36,0.15) 0%, transparent 55%)', animation: 'sf-nova 13s ease-in-out 8s infinite' }} />
        <div class="absolute" style={{ width: '28px', height: '1.5px', top: '2px', left: '-11px', background: 'linear-gradient(90deg, transparent, rgba(255,230,180,0.3), rgba(255,255,255,0.5), rgba(255,230,180,0.3), transparent)', animation: 'sf-nova 13s ease-in-out 8s infinite' }} />
        <div class="absolute" style={{ width: '1.5px', height: '28px', top: '-11px', left: '2px', background: 'linear-gradient(180deg, transparent, rgba(255,230,180,0.3), rgba(255,255,255,0.5), rgba(255,230,180,0.3), transparent)', animation: 'sf-nova 13s ease-in-out 8s infinite' }} />
        <div class="rounded-full" style={{ width: '4px', height: '4px', background: 'radial-gradient(circle, #fff, rgba(251,191,36,0.3))', 'box-shadow': '0 0 7px rgba(251,191,36,0.4)' }} />
      </div>

      {/* Supernova 5 — red giant */}
      <div class="absolute" style={{ top: '50%', left: '55%' }}>
        <div class="absolute rounded-full" style={{ width: '55px', height: '55px', top: '-25px', left: '-25px', background: 'radial-gradient(circle, rgba(255,100,100,0.15) 0%, transparent 55%)', animation: 'sf-nova 15s ease-in-out 4s infinite' }} />
        <div class="absolute" style={{ width: '44px', height: '1.5px', top: '2px', left: '-19px', background: 'linear-gradient(90deg, transparent, rgba(255,180,180,0.3), rgba(255,255,255,0.55), rgba(255,180,180,0.3), transparent)', animation: 'sf-nova 15s ease-in-out 4s infinite' }} />
        <div class="absolute" style={{ width: '1.5px', height: '44px', top: '-19px', left: '2px', background: 'linear-gradient(180deg, transparent, rgba(255,180,180,0.3), rgba(255,255,255,0.55), rgba(255,180,180,0.3), transparent)', animation: 'sf-nova 15s ease-in-out 4s infinite' }} />
        <div class="rounded-full" style={{ width: '5px', height: '5px', background: 'radial-gradient(circle, #fff, rgba(255,100,100,0.4))', 'box-shadow': '0 0 10px rgba(255,100,100,0.5)' }} />
      </div>

      {/* Shooting stars — varied angles and speeds */}
      <For each={SHOOTERS}>
        {(sh) => <div class={sh.cls} style={{ top: sh.top, left: sh.left, 'animation-delay': sh.delay }} />}
      </For>

      {/* Star cluster 1 — open cluster */}
      <div class="absolute" style={{ top: '52%', right: '22%', width: '80px', height: '80px' }}>
        <For each={cluster1}>
          {(d) => (
            <div class="absolute rounded-full bg-white"
              style={{
                left: `${d.left}px`, top: `${d.top}px`,
                width: `${d.size}px`, height: `${d.size}px`,
                opacity: d.opacity,
                animation: `sf-twinkle ${d.dur}s ease-in-out ${d.delay}s infinite`,
              }} />
          )}
        </For>
      </div>

      {/* Star cluster 2 */}
      <div class="absolute" style={{ top: '20%', left: '70%', width: '60px', height: '60px' }}>
        <For each={cluster2}>
          {(d) => (
            <div class="absolute rounded-full bg-white"
              style={{
                left: `${d.left}px`, top: `${d.top}px`,
                width: `${d.size}px`, height: `${d.size}px`,
                opacity: d.opacity,
                animation: `sf-twinkle ${d.dur}s ease-in-out ${d.delay}s infinite`,
              }} />
          )}
        </For>
      </div>

      {/* Star cluster 3 — tight blue cluster */}
      <div class="absolute" style={{ top: '75%', left: '45%', width: '45px', height: '45px' }}>
        <For each={cluster3}>
          {(d) => (
            <div class="absolute rounded-full"
              style={{
                left: `${d.left}px`, top: `${d.top}px`,
                width: `${d.size}px`, height: `${d.size}px`,
                background: '#a0b4ff',
                opacity: d.opacity,
                animation: `sf-twinkle ${d.dur}s ease-in-out ${d.delay}s infinite`,
              }} />
          )}
        </For>
      </div>

      {/* Cosmic dust lane — diagonal dark band */}
      <div class="absolute inset-0 opacity-[0.03]"
        style={{ background: 'linear-gradient(135deg, transparent 30%, rgba(0,0,0,0.8) 45%, rgba(0,0,0,0.6) 50%, rgba(0,0,0,0.8) 55%, transparent 70%)' }} />

      {/* Noise grain */}
      <div class="absolute inset-0 opacity-[0.03]"
        style={{ 'background-image': `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")` }} />

      <style>{`
        @keyframes sf-twinkle {
          0%, 100% { opacity: inherit; transform: scale(1); }
          40% { opacity: 0.02; transform: scale(0.3); }
          60% { opacity: 0.02; transform: scale(0.3); }
        }
        @keyframes sf-field-drift {
          0% { transform: translate(0, 0); }
          25% { transform: translate(-10px, 6px); }
          50% { transform: translate(4px, -8px); }
          75% { transform: translate(8px, 4px); }
          100% { transform: translate(0, 0); }
        }
        @keyframes sf-drift-a {
          0%, 100% { transform: translate(0, 0) scale(1); }
          30% { transform: translate(-50px, 35px) scale(1.12); }
          70% { transform: translate(25px, -20px) scale(0.92); }
        }
        @keyframes sf-drift-b {
          0%, 100% { transform: translate(0, 0) scale(1); }
          40% { transform: translate(40px, -28px) scale(1.1); }
          80% { transform: translate(-18px, 12px) scale(0.94); }
        }
        @keyframes sf-drift-c {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-28px, 22px) scale(1.18); }
        }
        @keyframes sf-galaxy-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes sf-nova {
          0%, 100% { opacity: 1; transform: scale(1); }
          30% { opacity: 0.2; transform: scale(0.5); }
          70% { opacity: 0.2; transform: scale(0.5); }
        }
        .sf-shooter {
          position: absolute;
          width: 90px;
          height: 2px;
          background: linear-gradient(90deg, rgba(255,255,255,0.8), rgba(200,210,255,0.3), transparent);
          transform: rotate(-35deg);
          animation: sf-shoot 8s ease-in infinite;
          opacity: 0;
          border-radius: 1px;
        }
        .sf-shooter-long {
          width: 160px;
          height: 2.5px;
          background: linear-gradient(90deg, rgba(255,255,255,0.9), rgba(129,140,248,0.4), transparent);
        }
        .sf-shooter-fast {
          animation-duration: 6s !important;
        }
        @keyframes sf-shoot {
          0% { opacity: 0; transform: rotate(-35deg) translateX(0); }
          1% { opacity: 0.9; }
          5% { opacity: 0; transform: rotate(-35deg) translateX(400px); }
          100% { opacity: 0; }
        }
      `}</style>
    </SceneShell>
  );
}

export const starfield = {
  id: 'starfield',
  label: 'Starfield',
  kind: 'scene',
  component: StarfieldScene,
} as const satisfies SceneVariant;
