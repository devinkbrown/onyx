// SPDX-License-Identifier: AGPL-3.0-or-later
import { createMemo, For, Show } from 'solid-js';
import type { SceneProps, SceneVariant } from '../engine';
import { SceneShell, seededRand } from './SceneShell';
import { useScenePolicy } from './scenePolicy';

/* ── Thunderstorm: realistic branched bolt strikes (SMIL flash patterns),
   driving rain in three wind layers, roiling storm clouds, sheet lightning,
   ground splashes and low fog. Ported from darkbear's LightningBg. */

/* Solid's JSX typings have no `vector-effect` attribute; spread it instead. */
const NON_SCALING_STROKE = { 'vector-effect': 'non-scaling-stroke' };

const rain = (() => {
  const rand = seededRand(900);
  return Array.from({ length: 60 }, () => {
    const windLayer = rand();
    const angle = 8 + rand() * 12 + (windLayer > 0.7 ? rand() * 8 : 0);
    return {
      x: rand() * 130 - 15,
      len: 14 + rand() * 32,
      width: rand() > 0.85 ? 1.5 : 1,
      dur: 0.25 + rand() * 0.45,
      delay: rand() * 3,
      opacity: 0.15 + rand() * 0.4,
      angle,
      layer: windLayer < 0.4 ? 0 : windLayer < 0.75 ? 1 : 2,
    };
  });
})();

const clouds = (() => {
  const rand = seededRand(902);
  return Array.from({ length: 14 }, (_, i) => ({
    x: -25 + rand() * 130,
    y: -12 + rand() * 28,
    w: 200 + rand() * 500,
    h: 60 + rand() * 140,
    opacity: 0.35 + rand() * 0.5,
    dur: 18 + rand() * 40,
    delay: rand() * 20,
    layer: i < 5 ? 0 : i < 9 ? 1 : 2,
    roilDur: 8 + rand() * 12,
    roilDelay: rand() * 8,
  }));
})();

const sheetFlashes = (() => {
  const rand = seededRand(904);
  return Array.from({ length: 5 }, () => ({
    x: rand() * 80 + 5,
    y: rand() * 15 + 3,
    w: 20 + rand() * 25,
    h: 10 + rand() * 12,
    cycle: 6 + rand() * 14,
    delay: rand() * 18,
    flashes: 1 + Math.floor(rand() * 3),
  }));
})();

const bolts = (() => {
  const rand = seededRand(903);
  const flashPatterns = [
    { vals: '0;0;1;0;0.6;0;0', times: '0;0.74;0.75;0.76;0.78;0.80;1' },
    { vals: '0;0;1;0;0.8;0;0.5;0;0', times: '0;0.72;0.73;0.74;0.76;0.78;0.80;0.82;1' },
    { vals: '0;0;1;0;0;0.7;0;0.4;0;0', times: '0;0.74;0.75;0.76;0.79;0.80;0.82;0.84;0.86;1' },
    { vals: '0;0;1;0.3;0;0', times: '0;0.74;0.75;0.77;0.80;1' },
  ];
  return Array.from({ length: 7 }, (_, idx) => {
    const startX = 6 + rand() * 88;
    const segs: { x: number; y: number }[] = [{ x: startX, y: 3 + rand() * 8 }];
    let cx = startX;
    let cy = segs[0]!.y;
    const n = 7 + Math.floor(rand() * 7);
    const drift = (rand() - 0.5) * 0.6;
    for (let j = 0; j < n; j++) {
      const jitter = (rand() - 0.5) * 18;
      const bigKink = rand() > 0.82 ? (rand() - 0.5) * 12 : 0;
      cx += jitter + bigKink + drift * 3;
      cy += 4 + rand() * 8;
      cx = Math.max(2, Math.min(98, cx));
      cy = Math.min(95, cy);
      segs.push({ x: cx, y: cy });
    }
    const delay = rand() * 16;
    const branches: { d: string; delay: number }[] = [];
    const nBranches = 2 + Math.floor(rand() * 3);
    for (let b = 0; b < nBranches; b++) {
      const bi = 1 + Math.floor(rand() * Math.max(1, segs.length - 2));
      const bsegs: { x: number; y: number }[] = [{ x: segs[bi]!.x, y: segs[bi]!.y }];
      let bx = segs[bi]!.x;
      let by = segs[bi]!.y;
      const side = rand() > 0.5 ? 1 : -1;
      const bn = 2 + Math.floor(rand() * 4);
      for (let k = 0; k < bn; k++) {
        bx += side * (3 + rand() * 10) + (rand() - 0.5) * 4;
        by += 3 + rand() * 7;
        bsegs.push({ x: Math.max(1, Math.min(99, bx)), y: Math.min(96, by) });
      }
      branches.push({
        d: bsegs.map((s, si) => `${si === 0 ? 'M' : 'L'}${s.x},${s.y}`).join(' '),
        delay: delay + 0.01 + b * 0.015,
      });
    }
    const pattern = flashPatterns[Math.floor(rand() * flashPatterns.length)]!;
    return {
      mainD: segs.map((s, si) => `${si === 0 ? 'M' : 'L'}${s.x},${s.y}`).join(' '),
      origin: segs[0]!,
      end: segs[segs.length - 1]!,
      branches,
      cycle: 5 + rand() * 10,
      delay,
      pattern,
      intensity: 0.7 + rand() * 0.3,
      flash: idx % 4,
    };
  });
})();

const splashes = (() => {
  const rand = seededRand(905);
  return Array.from({ length: 30 }, () => ({
    x: rand() * 100,
    dur: 0.3 + rand() * 0.4,
    delay: rand() * 2,
    size: 2 + rand() * 3,
  }));
})();

function LightningScene(props: SceneProps) {
  // Under reduced motion the SMIL flash patterns are omitted and the bolts
  // freeze at a modest static opacity — a long-exposure storm still.
  const still = (value: number) => (props.reducedMotion ? value : 0);
  const policy = useScenePolicy();
  const detail = createMemo(() => props.sceneDetail ?? policy().sceneDetail);
  const visibleClouds = createMemo(() => clouds.slice(0, detail() === 'sparse' ? 5 : detail() === 'balanced' ? 9 : clouds.length));
  const visibleSheets = createMemo(() => sheetFlashes.slice(0, detail() === 'balanced' ? 2 : sheetFlashes.length));
  const visibleBolts = createMemo(() => bolts.slice(0, detail() === 'sparse' ? 2 : detail() === 'balanced' ? 4 : bolts.length));
  const visibleRain = createMemo(() => rain.slice(0, detail() === 'sparse' ? 18 : detail() === 'balanced' ? 36 : rain.length));
  const visibleSplashes = createMemo(() => splashes.slice(0, detail() === 'balanced' ? 12 : splashes.length));

  return (
    <SceneShell
      reducedMotion={props.reducedMotion}
      sceneDetail={detail()}
      paused={props.paused}
      onRuntimePaused={props.onRuntimePaused}
      base="linear-gradient(180deg, #0a0e1d 0%, #0d1326 45%, #070b16 100%)"
    >
      {/* Storm clouds — layered with roiling motion */}
      <div data-scene-layer="clouds">
        <For each={visibleClouds()}>
          {(c) => (
            <div class="absolute rounded-full"
              style={{
                left: `${c.x}%`, top: `${c.y}%`,
                width: `${c.w}px`, height: `${c.h}px`,
                background: c.layer === 0
                  ? 'radial-gradient(ellipse, rgba(12,16,35,0.9) 0%, rgba(8,12,28,0.55) 35%, transparent 65%)'
                  : c.layer === 1
                  ? 'radial-gradient(ellipse, rgba(18,24,48,0.75) 0%, rgba(12,18,38,0.35) 40%, transparent 68%)'
                  : 'radial-gradient(ellipse, rgba(22,30,55,0.55) 0%, rgba(16,22,42,0.2) 45%, transparent 70%)',
                filter: `blur(${12 + c.layer * 8}px)`,
                animation: `ln-cloud ${c.dur}s ease-in-out ${c.delay}s infinite, ln-roil ${c.roilDur}s ease-in-out ${c.roilDelay}s infinite`,
                opacity: c.opacity,
              }} />
          )}
        </For>
      </div>

      {/* Cloud underside glow — ambient internal lightning */}
      <div class="absolute left-0 right-0 top-[6%] h-[22%]"
        style={{
          background: 'linear-gradient(to bottom, rgba(80,130,220,0.1), rgba(60,110,200,0.03), transparent)',
          filter: 'blur(28px)',
          animation: 'ln-underglow 5s ease-in-out infinite',
        }} />

      {/* Sheet lightning — cloud-to-cloud flickers with no visible bolt */}
      <Show when={detail() !== 'sparse'}>
        <div data-scene-layer="sheet-flashes">
          <For each={visibleSheets()}>
            {(sf) => (
              <div class="absolute rounded-full"
                style={{
                  left: `${sf.x}%`, top: `${sf.y}%`,
                  width: `${sf.w}%`, height: `${sf.h}%`,
                  background: 'radial-gradient(ellipse, rgba(140,180,255,0.35), rgba(100,150,240,0.1) 40%, transparent 65%)',
                  filter: 'blur(25px)',
                  animation: `ln-sheet${sf.flashes} ${sf.cycle}s ease-out ${sf.delay}s infinite`,
                }} />
            )}
          </For>
        </div>
      </Show>

      {/* Lightning bolts via SVG */}
      <svg class="absolute inset-0 w-full h-full" data-scene-layer="bolts" viewBox="0 0 100 100" preserveAspectRatio="none">
        <For each={visibleBolts()}>
          {(bolt) => {
            const { vals, times } = bolt.pattern;
            const c = bolt.cycle;
            const flashAnim = (begin: number) => (
              <animate attributeName="opacity" values={vals} keyTimes={times}
                dur={`${c}s`} begin={`${begin}s`} repeatCount="indefinite" />
            );
            return (
              <g>
                {/* Ultra-wide atmospheric scatter */}
                <path d={bolt.mainD} fill="none" stroke={`rgba(70,120,220,${0.3 * bolt.intensity})`} stroke-width="6"
                  stroke-linecap="round" stroke-linejoin="round" opacity={still(0.5)} {...NON_SCALING_STROKE}>
                  <Show when={!props.reducedMotion}>{flashAnim(bolt.delay)}</Show>
                </path>
                {/* Wide outer glow */}
                <path d={bolt.mainD} fill="none" stroke={`rgba(100,160,250,${0.5 * bolt.intensity})`} stroke-width="3.5"
                  stroke-linecap="round" stroke-linejoin="round" opacity={still(0.55)} {...NON_SCALING_STROKE}>
                  <Show when={!props.reducedMotion}>{flashAnim(bolt.delay)}</Show>
                </path>
                {/* Main channel */}
                <path d={bolt.mainD} fill="none" stroke={`rgba(190,215,255,${0.95 * bolt.intensity})`} stroke-width="1.6"
                  stroke-linecap="round" stroke-linejoin="round" opacity={still(0.6)} {...NON_SCALING_STROKE}>
                  <Show when={!props.reducedMotion}>{flashAnim(bolt.delay)}</Show>
                </path>
                {/* Hot white core */}
                <path d={bolt.mainD} fill="none" stroke="rgba(245,248,255,0.98)" stroke-width="0.6"
                  stroke-linecap="round" stroke-linejoin="round" opacity={still(0.65)} {...NON_SCALING_STROKE}>
                  <Show when={!props.reducedMotion}>{flashAnim(bolt.delay)}</Show>
                </path>
                {/* Branches */}
                <For each={bolt.branches}>
                  {(br) => (
                    <g>
                      <path d={br.d} fill="none" stroke={`rgba(120,170,250,${0.55 * bolt.intensity})`} stroke-width="2"
                        stroke-linecap="round" stroke-linejoin="round" opacity={still(0.4)} {...NON_SCALING_STROKE}>
                        <Show when={!props.reducedMotion}>{flashAnim(br.delay)}</Show>
                      </path>
                      <path d={br.d} fill="none" stroke={`rgba(180,210,255,${0.75 * bolt.intensity})`} stroke-width="1"
                        stroke-linecap="round" stroke-linejoin="round" opacity={still(0.45)} {...NON_SCALING_STROKE}>
                        <Show when={!props.reducedMotion}>{flashAnim(br.delay)}</Show>
                      </path>
                      <path d={br.d} fill="none" stroke="rgba(230,240,255,0.85)" stroke-width="0.4"
                        stroke-linecap="round" stroke-linejoin="round" opacity={still(0.5)} {...NON_SCALING_STROKE}>
                        <Show when={!props.reducedMotion}>{flashAnim(br.delay)}</Show>
                      </path>
                    </g>
                  )}
                </For>
                {/* Ground strike illumination — wide spread */}
                <ellipse cx={bolt.end.x} cy={bolt.end.y + 3}
                  rx="14" ry="5" fill={`rgba(100,160,250,${0.5 * bolt.intensity})`} opacity={still(0.3)}>
                  <Show when={!props.reducedMotion}>{flashAnim(bolt.delay)}</Show>
                </ellipse>
              </g>
            );
          }}
        </For>
      </svg>

      {/* Full-screen flash per bolt — whole sky illuminates */}
      <Show when={detail() === 'full'}>
        <div data-scene-layer="sky-flashes">
          <For each={visibleBolts()}>
            {(bolt) => (
              <div class="absolute inset-0"
                style={{ animation: `ln-skyflash-${bolt.flash} ${bolt.cycle}s ease-out ${bolt.delay}s infinite` }} />
            )}
          </For>
        </div>
      </Show>

      {/* Cloud illumination — localized glow near each bolt origin */}
      <div data-scene-layer="bolt-glow">
        <For each={visibleBolts()}>
          {(bolt) => (
            <div class="absolute rounded-full"
              style={{
                left: `${bolt.origin.x - 18}%`, top: `${bolt.origin.y - 6}%`,
                width: '36%', height: '22%',
                background: `radial-gradient(ellipse, rgba(140,185,255,${0.35 * bolt.intensity}), transparent 55%)`,
                filter: 'blur(22px)',
                animation: `ln-skyflash-${bolt.flash} ${bolt.cycle}s ease-out ${bolt.delay}s infinite`,
              }} />
          )}
        </For>
      </div>

      {/* Driving rain — three depth layers with varied angle for wind gusts */}
      <div data-scene-layer="rain">
        <For each={visibleRain()}>
          {(r) => (
            <div class="absolute"
              style={{
                left: `${r.x}%`, top: '-12%',
                width: `${r.width}px`, height: `${r.len}px`,
                background: r.layer === 0
                  ? `linear-gradient(to bottom, transparent, rgba(180,210,255,${r.opacity}))`
                  : r.layer === 1
                  ? `linear-gradient(to bottom, transparent, rgba(150,190,240,${r.opacity * 0.75}))`
                  : `linear-gradient(to bottom, transparent, rgba(130,170,230,${r.opacity * 0.5}))`,
                transform: `rotate(${r.angle}deg)`,
                'transform-origin': 'top left',
                animation: `ln-rain ${r.dur}s linear ${r.delay}s infinite`,
              }} />
          )}
        </For>
      </div>

      {/* Rain splash at ground level */}
      <Show when={detail() !== 'sparse'}>
        <div data-scene-layer="splashes">
          <For each={visibleSplashes()}>
            {(sp) => (
              <div class="absolute"
                style={{
                  left: `${sp.x}%`, bottom: '2%',
                  width: `${sp.size}px`, height: `${sp.size * 0.4}px`,
                  'border-radius': '50%',
                  background: 'rgba(160,200,255,0.3)',
                  filter: 'blur(0.5px)',
                  animation: `ln-splash ${sp.dur}s ease-out ${sp.delay}s infinite`,
                }} />
            )}
          </For>
        </div>
      </Show>

      {/* Low fog / mist — wind-driven */}
      <div class="absolute bottom-0 left-[-5%] right-[-5%] h-[28%]"
        style={{
          background: 'linear-gradient(to top, rgba(8,12,25,0.55), rgba(12,18,35,0.2) 45%, transparent)',
          filter: 'blur(12px)',
          animation: 'ln-fog 12s ease-in-out infinite',
        }} />
      <div class="absolute bottom-0 left-[-8%] right-[-8%] h-[20%]"
        style={{
          background: 'radial-gradient(ellipse at 55% 100%, rgba(18,25,48,0.45), transparent 50%)',
          filter: 'blur(20px)',
          animation: 'ln-fog 16s ease-in-out 4s infinite',
        }} />
      <div class="absolute bottom-0 left-[-3%] right-[-3%] h-[15%]"
        style={{
          background: 'radial-gradient(ellipse at 30% 100%, rgba(15,22,42,0.35), transparent 45%)',
          filter: 'blur(16px)',
          animation: 'ln-fog 20s ease-in-out 9s infinite',
        }} />

      <style>{`
        @keyframes ln-rain { 0%{top:-12%;opacity:0} 4%{opacity:1} 92%{opacity:0.7} 100%{top:112%;opacity:0} }
        @keyframes ln-cloud { 0%,100%{transform:translateX(0) scale(1)} 50%{transform:translateX(30px) scale(1.04)} }
        @keyframes ln-roil { 0%,100%{transform:scaleX(1) scaleY(1)} 30%{transform:scaleX(1.06) scaleY(0.95)} 60%{transform:scaleX(0.96) scaleY(1.04)} }
        @keyframes ln-underglow { 0%,100%{opacity:0.4} 40%{opacity:0.9} 60%{opacity:0.5} }
        @keyframes ln-fog { 0%,100%{transform:translateX(0);opacity:1} 50%{transform:translateX(20px);opacity:0.6} }
        @keyframes ln-splash { 0%{transform:scale(0);opacity:0.8} 50%{transform:scale(1.5);opacity:0.4} 100%{transform:scale(2.5);opacity:0} }

        @keyframes ln-sheet1 { 0%,88%{opacity:0} 89%{opacity:0.8} 90%{opacity:0} 100%{opacity:0} }
        @keyframes ln-sheet2 { 0%,85%{opacity:0} 86%{opacity:0.6} 87%{opacity:0} 88.5%{opacity:0.9} 89.5%{opacity:0} 100%{opacity:0} }
        @keyframes ln-sheet3 { 0%,82%{opacity:0} 83%{opacity:0.5} 83.5%{opacity:0} 84.5%{opacity:0.7} 85%{opacity:0.2} 86%{opacity:0.9} 86.5%{opacity:0} 100%{opacity:0} }

        @keyframes ln-skyflash-0 { 0%,73%{background:transparent} 74%{background:rgba(140,185,250,0.12)} 75%{background:rgba(160,200,255,0.18)} 76%{background:transparent} 78%{background:rgba(120,170,250,0.14)} 79%{background:transparent} 100%{background:transparent} }
        @keyframes ln-skyflash-1 { 0%,72%{background:transparent} 73%{background:rgba(150,190,255,0.16)} 74%{background:transparent} 76%{background:rgba(130,175,250,0.22)} 77.5%{background:rgba(110,160,245,0.08)} 78.5%{background:transparent} 100%{background:transparent} }
        @keyframes ln-skyflash-2 { 0%,74%{background:transparent} 75%{background:rgba(160,200,255,0.2)} 75.5%{background:rgba(140,185,250,0.06)} 76.5%{background:transparent} 100%{background:transparent} }
        @keyframes ln-skyflash-3 { 0%,73%{background:transparent} 74%{background:rgba(130,175,250,0.1)} 75%{background:rgba(150,195,255,0.2)} 76%{background:transparent} 78%{background:rgba(140,185,250,0.15)} 79%{background:transparent} 80.5%{background:rgba(120,165,245,0.08)} 81%{background:transparent} 100%{background:transparent} }
      `}</style>
    </SceneShell>
  );
}

export const lightning = {
  id: 'lightning',
  label: 'Thunderstorm',
  kind: 'scene',
  component: LightningScene,
} as const satisfies SceneVariant;
