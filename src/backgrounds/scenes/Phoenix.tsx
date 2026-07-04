import { For, Show } from 'solid-js';
import type { SceneProps, SceneVariant } from '../engine';
import { SceneShell, seededRand } from './SceneShell';

/* ── Phoenix: majestic flaming phoenix rising from an inferno — layered SVG
   bird with beating wings, sweeping tail plumes, crown flames, rising embers,
   fire vortex and smoke. Ported from darkbear's PhoenixBg. */

const embersSmall = (() => {
  const rand = seededRand(660);
  return Array.from({ length: 30 }, () => ({
    x: rand() * 100,
    size: 1.5 + rand() * 2.5,
    dur: 1.5 + rand() * 2,
    delay: rand() * 10,
    drift: (rand() - 0.5) * 70,
  }));
})();

const embersMed = (() => {
  const rand = seededRand(661);
  return Array.from({ length: 20 }, () => ({
    x: rand() * 100,
    size: 3 + rand() * 4,
    dur: 2.5 + rand() * 3,
    delay: rand() * 12,
    drift: (rand() - 0.5) * 90,
    color: rand() > 0.5 ? '#fbbf24' : '#f97316',
  }));
})();

const embersLarge = (() => {
  const rand = seededRand(662);
  return Array.from({ length: 12 }, () => ({
    x: rand() * 100,
    size: 5 + rand() * 5,
    dur: 3.5 + rand() * 4,
    delay: rand() * 14,
    drift: (rand() - 0.5) * 110,
  }));
})();

const smoke = (() => {
  const rand = seededRand(663);
  return Array.from({ length: 10 }, () => ({
    x: 5 + rand() * 90,
    dur: 16 + rand() * 14,
    delay: rand() * 12,
    w: 80 + rand() * 160,
  }));
})();

const vortex = (() => {
  const rand = seededRand(664);
  return Array.from({ length: 16 }, (_, i) => {
    const angle = (i / 16) * 360;
    const r = 35 + rand() * 40;
    const rad = (angle * Math.PI) / 180;
    return {
      px: Math.cos(rad) * r,
      py: Math.sin(rad) * r,
      size: 2 + rand() * 4,
      dur: 2.5 + rand() * 3,
      delay: rand() * 5,
      color: rand() > 0.5 ? '#fbbf24' : rand() > 0.3 ? '#f97316' : '#ef4444',
    };
  });
})();

const feathers = (() => {
  const rand = seededRand(665);
  return Array.from({ length: 8 }, () => ({
    x: 20 + rand() * 60,
    y: 15 + rand() * 50,
    size: 8 + rand() * 16,
    dur: 6 + rand() * 10,
    delay: rand() * 12,
    rot: rand() * 360,
    drift: (rand() - 0.5) * 80,
    color: rand() < 0.4 ? '#f59e0b' : rand() < 0.7 ? '#ef4444' : '#fb923c',
  }));
})();

const sparks = (() => {
  const rand = seededRand(666);
  return Array.from({ length: 16 }, () => {
    const angle = rand() * 360;
    const dist = 50 + rand() * 100;
    return {
      x: 30 + rand() * 40,
      y: 25 + rand() * 35,
      dur: 1.2 + rand() * 2.5,
      delay: rand() * 14,
      sx: Math.cos((angle * Math.PI) / 180) * dist,
      sy: Math.sin((angle * Math.PI) / 180) * dist,
      size: 0.8 + rand() * 1.8,
    };
  });
})();

const FIRE_VEINS = [8, 18, 30, 42, 55, 68, 78, 88].map((x, i) => ({
  x,
  w: 3 + (i % 3) * 2,
  h: 20 + (i % 5) * 8,
  hot: i % 2 === 0,
  dur: 2.8 + i * 0.7,
  delay: i * 0.45,
}));

const MAGMA_POOLS = [18, 48, 80].map((x, i) => ({
  left: x - 10,
  bright: i % 2 === 0,
  dur: 2.2 + i * 1.1,
  delay: i * 0.7,
}));

function PhoenixScene(props: SceneProps) {
  return (
    <SceneShell reducedMotion={props.reducedMotion} base="linear-gradient(180deg, #140705 0%, #1f0b05 55%, #0c0402 100%)">
      {/* Intense fire base — 5 layers of blazing gradient */}
      <div class="absolute bottom-0 left-0 right-0 h-[65%]"
        style={{ background: 'linear-gradient(to top, rgba(180,60,10,0.5), rgba(239,68,68,0.3) 35%, rgba(245,158,11,0.12) 65%, transparent)', animation: 'ph-heat 3s ease-in-out infinite' }} />
      <div class="absolute bottom-0 left-[5%] right-[5%] h-[55%]"
        style={{ background: 'radial-gradient(ellipse at 50% 100%, rgba(251,191,36,0.45), rgba(249,115,22,0.25) 45%, transparent 70%)', animation: 'ph-heat 4.5s ease-in-out 1s infinite' }} />
      <div class="absolute bottom-0 left-[15%] right-[15%] h-[45%]"
        style={{ background: 'radial-gradient(ellipse at 50% 100%, rgba(239,68,68,0.35), rgba(180,60,10,0.2) 55%, transparent)', animation: 'ph-heat 3.8s ease-in-out 1.8s infinite' }} />
      <div class="absolute bottom-0 left-[25%] right-[25%] h-[35%]"
        style={{ background: 'radial-gradient(ellipse at 50% 100%, rgba(255,200,60,0.5), transparent 65%)', animation: 'ph-heat 4s ease-in-out 0.5s infinite' }} />
      <div class="absolute bottom-0 left-[35%] right-[35%] h-[25%]"
        style={{ background: 'radial-gradient(ellipse at 50% 100%, rgba(255,240,100,0.55), transparent 70%)', animation: 'ph-heat 2.8s ease-in-out 2s infinite' }} />

      {/* Fire veins rising from below */}
      <For each={FIRE_VEINS}>
        {(v) => (
          <div class="absolute bottom-0"
            style={{ left: `${v.x}%`, width: `${v.w}px`, height: `${v.h}%`,
              background: `linear-gradient(to top, rgba(${v.hot ? '251,191,36' : '249,115,22'},0.7), rgba(239,68,68,0.4) 55%, rgba(180,60,10,0.15) 80%, transparent)`,
              filter: 'blur(1px)',
              'box-shadow': '0 0 6px rgba(249,115,22,0.5), 0 0 14px rgba(251,191,36,0.2)',
              animation: `ph-vein ${v.dur}s ease-in-out ${v.delay}s infinite` }} />
        )}
      </For>

      {/* Heat shimmer */}
      <div class="absolute bottom-0 left-0 right-0 h-[40%]"
        style={{ background: 'linear-gradient(to top, rgba(255,180,60,0.18), rgba(255,140,40,0.08) 50%, transparent)', filter: 'blur(3px)', animation: 'ph-shimmer 1.6s ease-in-out infinite' }} />

      {/* Dense smoke columns */}
      <For each={smoke}>
        {(s) => (
          <div class="absolute bottom-[2%]"
            style={{ left: `${s.x}%`, width: `${s.w}px`, height: '70%',
              background: 'linear-gradient(to top, rgba(60,30,15,0.6), rgba(50,25,12,0.4) 30%, rgba(35,18,10,0.2) 60%, rgba(20,10,5,0.08) 85%, transparent)',
              filter: 'blur(14px)', animation: `ph-smoke ${s.dur}s ease-in-out ${s.delay}s infinite` }} />
        )}
      </For>

      {/* Central phoenix glow — multi-layer radiance */}
      <div class="absolute top-[18%] left-[50%] -translate-x-1/2 w-[min(700px,55vw)] h-[min(600px,50vh)] rounded-full"
        style={{ background: 'radial-gradient(ellipse, rgba(245,158,11,0.18) 0%, rgba(239,68,68,0.08) 40%, transparent 65%)', animation: 'ph-core 5s ease-in-out infinite', filter: 'blur(35px)' }} />
      <div class="absolute top-[22%] left-[50%] -translate-x-1/2 w-[min(450px,38vw)] h-[min(400px,36vh)] rounded-full"
        style={{ background: 'radial-gradient(ellipse, rgba(251,191,36,0.2) 0%, rgba(245,158,11,0.08) 45%, transparent 70%)', animation: 'ph-core 5s ease-in-out 2.5s infinite', filter: 'blur(25px)' }} />
      <div class="absolute top-[28%] left-[50%] -translate-x-1/2 w-[min(250px,22vw)] h-[min(220px,20vh)] rounded-full"
        style={{ background: 'radial-gradient(ellipse, rgba(254,243,199,0.15) 0%, rgba(251,191,36,0.06) 50%, transparent 70%)', animation: 'ph-core 4s ease-in-out 1s infinite', filter: 'blur(18px)' }} />

      {/* Phoenix SVG — detailed majestic bird with layered flames */}
      <svg class="absolute inset-0 w-full h-full" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="ph-fg" x1="0.5" y1="1" x2="0.5" y2="0">
            <stop offset="0%" stop-color="#dc2626" stop-opacity="0.7" />
            <stop offset="30%" stop-color="#f97316" stop-opacity="0.6" />
            <stop offset="60%" stop-color="#f59e0b" stop-opacity="0.45" />
            <stop offset="85%" stop-color="#fbbf24" stop-opacity="0.25" />
            <stop offset="100%" stop-color="#fef3c7" stop-opacity="0.1" />
          </linearGradient>
          <linearGradient id="ph-wg" x1="0" y1="0.5" x2="1" y2="0.5">
            <stop offset="0%" stop-color="#ef4444" stop-opacity="0.35" />
            <stop offset="40%" stop-color="#f97316" stop-opacity="0.25" />
            <stop offset="70%" stop-color="#f59e0b" stop-opacity="0.15" />
            <stop offset="100%" stop-color="#fbbf24" stop-opacity="0.04" />
          </linearGradient>
          <linearGradient id="ph-wgr" x1="1" y1="0.5" x2="0" y2="0.5">
            <stop offset="0%" stop-color="#ef4444" stop-opacity="0.35" />
            <stop offset="40%" stop-color="#f97316" stop-opacity="0.25" />
            <stop offset="70%" stop-color="#f59e0b" stop-opacity="0.15" />
            <stop offset="100%" stop-color="#fbbf24" stop-opacity="0.04" />
          </linearGradient>
          <radialGradient id="ph-body" cx="0.5" cy="0.4" r="0.5">
            <stop offset="0%" stop-color="#fef3c7" stop-opacity="0.3" />
            <stop offset="40%" stop-color="#fbbf24" stop-opacity="0.22" />
            <stop offset="70%" stop-color="#f59e0b" stop-opacity="0.14" />
            <stop offset="100%" stop-color="#ef4444" stop-opacity="0.06" />
          </radialGradient>
        </defs>

        {/* Outer glow aura around the whole bird */}
        <g style={{ animation: 'ph-float 7s ease-in-out infinite' }}>
          <ellipse cx="500" cy="440" rx="160" ry="200" fill="rgba(245,158,11,0.06)" />
        </g>

        {/* Main phoenix group */}
        <g style={{ animation: 'ph-float 7s ease-in-out infinite' }}>

          {/* Tail — long sweeping fire plumes (7 streams) */}
          <path d="M500 620 Q475 720 430 850 Q455 790 465 730 Q485 670 500 620Z" fill="url(#ph-fg)" style={{ animation: 'ph-t1 3s ease-in-out infinite' }} />
          <path d="M500 620 Q525 730 570 860 Q545 790 535 730 Q515 670 500 620Z" fill="url(#ph-fg)" style={{ animation: 'ph-t2 3.4s ease-in-out infinite' }} />
          <path d="M500 620 Q490 740 500 880 Q510 760 505 700 Q502 660 500 620Z" fill="url(#ph-fg)" style={{ animation: 'ph-t3 3.8s ease-in-out infinite' }} />
          <path d="M500 620 Q460 740 400 870 Q440 800 460 740 Q480 680 500 620Z" fill="rgba(239,68,68,0.25)" style={{ animation: 'ph-t1 4.2s ease-in-out 0.5s infinite' }} />
          <path d="M500 620 Q540 740 600 870 Q560 800 540 740 Q520 680 500 620Z" fill="rgba(239,68,68,0.25)" style={{ animation: 'ph-t2 4s ease-in-out 0.8s infinite' }} />
          <path d="M500 620 Q465 760 380 900 Q430 830 455 760 Q480 690 500 620Z" fill="rgba(180,60,10,0.18)" style={{ animation: 'ph-t1 5s ease-in-out 1.2s infinite' }} />
          <path d="M500 620 Q535 760 620 900 Q570 830 545 760 Q520 690 500 620Z" fill="rgba(180,60,10,0.18)" style={{ animation: 'ph-t2 4.8s ease-in-out 1s infinite' }} />

          {/* Body — teardrop with layered glow */}
          <ellipse cx="500" cy="470" rx="40" ry="100" fill="url(#ph-body)" />
          <ellipse cx="500" cy="460" rx="28" ry="75" fill="rgba(251,191,36,0.22)" />
          <ellipse cx="500" cy="445" rx="16" ry="45" fill="rgba(254,243,199,0.2)" />
          <ellipse cx="500" cy="435" rx="8" ry="22" fill="rgba(255,255,220,0.18)" />

          {/* Left wing — primary feathers (sweeping arc with 4 layers) */}
          <path d="M475 445 Q400 370 270 290 Q320 340 355 375 Q390 410 430 438 Q455 448 475 445Z"
            fill="url(#ph-wg)" style={{ animation: 'ph-wl 3.8s ease-in-out infinite', 'transform-origin': '475px 445px' }} />
          <path d="M475 460 Q385 400 230 330 Q300 370 345 400 Q390 430 440 455 Q460 462 475 460Z"
            fill="rgba(249,115,22,0.18)" style={{ animation: 'ph-wl 3.8s ease-in-out 0.2s infinite', 'transform-origin': '475px 460px' }} />
          <path d="M475 475 Q370 430 200 380 Q280 410 335 435 Q395 460 450 473Z"
            fill="rgba(239,68,68,0.12)" style={{ animation: 'ph-wl 3.8s ease-in-out 0.4s infinite', 'transform-origin': '475px 475px' }} />
          <path d="M478 490 Q390 460 250 430 Q320 450 370 465 Q425 482 465 488Z"
            fill="rgba(180,60,10,0.08)" style={{ animation: 'ph-wl 3.8s ease-in-out 0.6s infinite', 'transform-origin': '478px 490px' }} />

          {/* Right wing — primary feathers (mirrored) */}
          <path d="M525 445 Q600 370 730 290 Q680 340 645 375 Q610 410 570 438 Q545 448 525 445Z"
            fill="url(#ph-wgr)" style={{ animation: 'ph-wr 3.8s ease-in-out infinite', 'transform-origin': '525px 445px' }} />
          <path d="M525 460 Q615 400 770 330 Q700 370 655 400 Q610 430 560 455 Q540 462 525 460Z"
            fill="rgba(249,115,22,0.18)" style={{ animation: 'ph-wr 3.8s ease-in-out 0.2s infinite', 'transform-origin': '525px 460px' }} />
          <path d="M525 475 Q630 430 800 380 Q720 410 665 435 Q605 460 550 473Z"
            fill="rgba(239,68,68,0.12)" style={{ animation: 'ph-wr 3.8s ease-in-out 0.4s infinite', 'transform-origin': '525px 475px' }} />
          <path d="M522 490 Q610 460 750 430 Q680 450 630 465 Q575 482 535 488Z"
            fill="rgba(180,60,10,0.08)" style={{ animation: 'ph-wr 3.8s ease-in-out 0.6s infinite', 'transform-origin': '522px 490px' }} />

          {/* Wing tip fire — left */}
          <path d="M270 290 Q250 260 220 220 Q240 255 260 280Z" fill="rgba(251,191,36,0.3)" style={{ animation: 'ph-wtl 2.5s ease-in-out infinite' }} />
          <path d="M270 290 Q240 275 200 250 Q235 270 265 285Z" fill="rgba(245,158,11,0.2)" style={{ animation: 'ph-wtl 3s ease-in-out 0.4s infinite' }} />
          <path d="M230 330 Q205 305 170 270 Q195 300 225 325Z" fill="rgba(239,68,68,0.15)" style={{ animation: 'ph-wtl 2.8s ease-in-out 0.8s infinite' }} />

          {/* Wing tip fire — right */}
          <path d="M730 290 Q750 260 780 220 Q760 255 740 280Z" fill="rgba(251,191,36,0.3)" style={{ animation: 'ph-wtr 2.5s ease-in-out infinite' }} />
          <path d="M730 290 Q760 275 800 250 Q765 270 735 285Z" fill="rgba(245,158,11,0.2)" style={{ animation: 'ph-wtr 3s ease-in-out 0.4s infinite' }} />
          <path d="M770 330 Q795 305 830 270 Q805 300 775 325Z" fill="rgba(239,68,68,0.15)" style={{ animation: 'ph-wtr 2.8s ease-in-out 0.8s infinite' }} />

          {/* Neck */}
          <ellipse cx="500" cy="380" rx="14" ry="35" fill="rgba(245,158,11,0.2)" />
          <ellipse cx="500" cy="375" rx="9" ry="25" fill="rgba(251,191,36,0.22)" />

          {/* Head */}
          <ellipse cx="500" cy="350" rx="18" ry="24" fill="rgba(245,158,11,0.22)" />
          <ellipse cx="500" cy="345" rx="12" ry="17" fill="rgba(251,191,36,0.28)" />
          <ellipse cx="500" cy="340" rx="7" ry="10" fill="rgba(254,243,199,0.2)" />

          {/* Eyes — twin points of white-hot light */}
          <circle cx="492" cy="342" r="2.5" fill="rgba(255,255,230,0.5)">
            <Show when={!props.reducedMotion}>
              <animate attributeName="opacity" values="0.5;0.9;0.5" dur="3s" repeatCount="indefinite" />
            </Show>
          </circle>
          <circle cx="508" cy="342" r="2.5" fill="rgba(255,255,230,0.5)">
            <Show when={!props.reducedMotion}>
              <animate attributeName="opacity" values="0.5;0.9;0.5" dur="3s" begin="0.3s" repeatCount="indefinite" />
            </Show>
          </circle>

          {/* Beak */}
          <path d="M500 335 L507 320 L500 326 L493 320Z" fill="rgba(254,243,199,0.35)" />

          {/* Crown flames — 5 tongues */}
          <path d="M500 330 Q497 305 490 280 Q498 300 500 330Z" fill="rgba(245,158,11,0.25)" style={{ animation: 'ph-crown 2.2s ease-in-out infinite' }} />
          <path d="M500 330 Q504 302 512 275 Q503 298 500 330Z" fill="rgba(239,68,68,0.2)" style={{ animation: 'ph-crown 2.6s ease-in-out 0.4s infinite' }} />
          <path d="M500 330 Q494 308 482 288 Q494 305 500 330Z" fill="rgba(251,191,36,0.18)" style={{ animation: 'ph-crown 2.4s ease-in-out 0.8s infinite' }} />
          <path d="M500 330 Q508 310 520 292 Q508 308 500 330Z" fill="rgba(249,115,22,0.15)" style={{ animation: 'ph-crown 3s ease-in-out 1.2s infinite' }} />
          <path d="M500 330 Q500 308 500 270 Q502 300 500 330Z" fill="rgba(254,243,199,0.12)" style={{ animation: 'ph-crown 2.8s ease-in-out 0.6s infinite' }} />
        </g>
      </svg>

      {/* Fire vortex swirl around phoenix center */}
      <div class="absolute" style={{ left: '50%', top: '42%', width: '0', height: '0' }}>
        <For each={vortex}>
          {(v) => (
            <div class="absolute rounded-full"
              style={{ left: `${v.px}px`, top: `${v.py}px`, width: `${v.size}px`, height: `${v.size}px`,
                background: v.color, opacity: 0,
                'box-shadow': `0 0 ${v.size * 4}px ${v.color}`,
                animation: `ph-vortex ${v.dur}s ease-in-out ${v.delay}s infinite` }} />
          )}
        </For>
      </div>

      {/* Floating fire feather shapes */}
      <For each={feathers}>
        {(f) => (
          <div class="absolute"
            style={{
              left: `${f.x}%`, top: `${f.y}%`,
              width: `${f.size * 0.35}px`, height: `${f.size}px`,
              'border-radius': '50% 50% 50% 50% / 20% 20% 80% 80%',
              background: `linear-gradient(to bottom, ${f.color}, transparent)`,
              'box-shadow': `0 0 ${f.size}px ${f.color}40`,
              transform: `rotate(${f.rot}deg)`,
              opacity: 0,
              animation: `ph-feather ${f.dur}s ease-in-out ${f.delay}s infinite`,
              ['--ph-frot' as string]: `${f.rot}deg`,
              ['--ph-fdrift' as string]: `${f.drift}px`,
            }} />
        )}
      </For>

      {/* Spark bursts radiating from phoenix */}
      <For each={sparks}>
        {(s) => (
          <div class="absolute rounded-full"
            style={{
              left: `${s.x}%`, top: `${s.y}%`,
              width: `${s.size}px`, height: `${s.size}px`,
              background: '#fbbf24',
              'box-shadow': '0 0 8px #f59e0b, 0 0 16px rgba(245,158,11,0.3)',
              animation: `ph-spark ${s.dur}s ease-out ${s.delay}s infinite`,
              ['--ph-sx' as string]: `${s.sx}px`,
              ['--ph-sy' as string]: `${s.sy}px`,
              opacity: 0,
            }} />
        )}
      </For>

      {/* Three tiers of rising embers */}
      <For each={embersSmall}>
        {(e) => (
          <div class="absolute rounded-full"
            style={{ left: `${e.x}%`, bottom: '0', width: `${e.size}px`, height: `${e.size}px`,
              background: '#fde68a', opacity: 0,
              'box-shadow': '0 0 8px #fbbf24, 0 0 16px rgba(251,191,36,0.3)',
              animation: `ph-eS ${e.dur}s ease-out ${e.delay}s infinite`,
              ['--dr' as string]: `${e.drift}px` }} />
        )}
      </For>
      <For each={embersMed}>
        {(e) => (
          <div class="absolute rounded-full"
            style={{ left: `${e.x}%`, bottom: '0', width: `${e.size}px`, height: `${e.size}px`,
              background: e.color, opacity: 0,
              'box-shadow': `0 0 ${e.size * 3}px ${e.color}, 0 0 ${e.size * 6}px rgba(249,115,22,0.25)`,
              animation: `ph-eM ${e.dur}s ease-out ${e.delay}s infinite`,
              ['--dr' as string]: `${e.drift}px` }} />
        )}
      </For>
      <For each={embersLarge}>
        {(e) => (
          <div class="absolute rounded-full"
            style={{ left: `${e.x}%`, bottom: '0', width: `${e.size}px`, height: `${e.size}px`,
              background: '#ef4444', opacity: 0,
              'box-shadow': `0 0 ${e.size * 5}px rgba(239,68,68,0.7), 0 0 ${e.size * 10}px rgba(180,60,10,0.35)`,
              animation: `ph-eL ${e.dur}s ease-out ${e.delay}s infinite`,
              ['--dr' as string]: `${e.drift}px` }} />
        )}
      </For>

      {/* Magma pools at base */}
      <For each={MAGMA_POOLS}>
        {(p) => (
          <div class="absolute bottom-0"
            style={{ left: `${p.left}%`, width: '20%', height: '8%',
              background: `radial-gradient(ellipse, rgba(${p.bright ? '255,200,60' : '251,191,36'},0.6), rgba(249,115,22,0.35) 40%, rgba(239,68,68,0.2) 70%, transparent)`,
              'border-radius': '50%', filter: 'blur(2px)',
              'box-shadow': '0 0 25px rgba(251,191,36,0.4), 0 0 50px rgba(249,115,22,0.2)',
              animation: `ph-pool ${p.dur}s ease-in-out ${p.delay}s infinite` }} />
        )}
      </For>

      {/* Flickering ambient light on the whole scene */}
      <div class="absolute inset-0"
        style={{ animation: 'ph-flicker 0.15s step-end infinite', background: 'rgba(245,158,11,0.02)' }} />

      <style>{`
        @keyframes ph-heat { 0%,100%{opacity:1} 50%{opacity:0.75} }
        @keyframes ph-vein { 0%,100%{opacity:1;transform:scaleY(1)} 50%{opacity:0.65;transform:scaleY(0.88)} }
        @keyframes ph-shimmer { 0%,100%{transform:translateX(0) skewX(0deg)} 33%{transform:translateX(3px) skewX(0.6deg)} 66%{transform:translateX(-3px) skewX(-0.6deg)} }
        @keyframes ph-smoke { 0%,100%{transform:translateY(0) scaleX(1);opacity:1} 50%{transform:translateY(-45px) scaleX(1.5);opacity:0.45} }
        @keyframes ph-core { 0%,100%{opacity:0.7;transform:translateX(-50%) scale(1)} 50%{opacity:1;transform:translateX(-50%) scale(1.1)} }
        @keyframes ph-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-14px)} }
        @keyframes ph-wl { 0%,100%{transform:rotate(0deg) scaleY(1)} 35%{transform:rotate(-10deg) scaleY(1.04)} 65%{transform:rotate(-4deg) scaleY(0.98)} }
        @keyframes ph-wr { 0%,100%{transform:rotate(0deg) scaleY(1)} 35%{transform:rotate(10deg) scaleY(1.04)} 65%{transform:rotate(4deg) scaleY(0.98)} }
        @keyframes ph-t1 { 0%,100%{transform:scaleY(1) skewX(0) translateY(0)} 50%{transform:scaleY(1.18) skewX(-4deg) translateY(5px)} }
        @keyframes ph-t2 { 0%,100%{transform:scaleY(1) skewX(0) translateY(0)} 50%{transform:scaleY(1.22) skewX(4deg) translateY(5px)} }
        @keyframes ph-t3 { 0%,100%{transform:scaleY(1) translateY(0)} 50%{transform:scaleY(1.28) translateY(8px)} }
        @keyframes ph-crown { 0%,100%{transform:scaleY(1);opacity:1} 50%{transform:scaleY(1.4);opacity:0.45} }
        @keyframes ph-wtl { 0%,100%{transform:scale(1);opacity:0.8} 50%{transform:scale(1.3) translate(-4px,-6px);opacity:0.3} }
        @keyframes ph-wtr { 0%,100%{transform:scale(1);opacity:0.8} 50%{transform:scale(1.3) translate(4px,-6px);opacity:0.3} }
        @keyframes ph-vortex { 0%,100%{opacity:0;transform:translate(-50%,-50%) scale(0.2)} 50%{opacity:0.85;transform:translate(-50%,-50%) scale(1.3)} }
        @keyframes ph-feather { 0%{opacity:0;transform:rotate(var(--ph-frot,0deg)) translateY(0) translateX(0)} 15%{opacity:0.4} 85%{opacity:0.15} 100%{opacity:0;transform:rotate(var(--ph-frot,0deg)) translateY(-200px) translateX(var(--ph-fdrift,0px))} }
        @keyframes ph-spark { 0%{transform:translate(0,0) scale(1);opacity:0} 10%{opacity:1} 100%{transform:translate(var(--ph-sx,20px),var(--ph-sy,-20px)) scale(0);opacity:0} }
        @keyframes ph-eS { 0%{opacity:0.9;transform:translateY(0) translateX(0)} 100%{opacity:0;transform:translateY(-300px) translateX(var(--dr))} }
        @keyframes ph-eM { 0%{opacity:0.75;transform:translateY(0) translateX(0)} 30%{opacity:0.55} 100%{opacity:0;transform:translateY(-400px) translateX(var(--dr))} }
        @keyframes ph-eL { 0%{opacity:0.6;transform:translateY(0) translateX(0)} 40%{opacity:0.4} 100%{opacity:0;transform:translateY(-500px) translateX(var(--dr))} }
        @keyframes ph-pool { 0%,100%{transform:scaleX(1) scaleY(1);opacity:1} 50%{transform:scaleX(1.25) scaleY(1.4);opacity:0.65} }
        @keyframes ph-flicker { 0%{opacity:0.6} 20%{opacity:0.9} 40%{opacity:0.5} 60%{opacity:1} 80%{opacity:0.7} 100%{opacity:0.55} }
      `}</style>
    </SceneShell>
  );
}

export const phoenix = {
  id: 'phoenix',
  label: 'Phoenix',
  kind: 'scene',
  component: PhoenixScene,
} as const satisfies SceneVariant;
