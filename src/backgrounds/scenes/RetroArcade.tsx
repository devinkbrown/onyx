// SPDX-License-Identifier: AGPL-3.0-or-later
import { For } from 'solid-js';
import type { SceneProps, SceneVariant } from '../engine';
import { SceneShell, seededRand } from './SceneShell';

/* ── Retro Arcade: CRT scanlines, pixel characters, neon glow, arcade cabinets ──
   Ported from darkbear's RetroArcadeBg (fixed colorway, CSS keyframes only). */

const INVADER_PIXELS: Record<'crab' | 'squid' | 'octo', [number, number][]> = {
  crab: [[2,0],[5,0],[0,1],[2,1],[3,1],[4,1],[5,1],[7,1],[0,2],[1,2],[2,2],[3,2],[4,2],[5,2],[6,2],[7,2],[0,3],[1,3],[3,3],[4,3],[6,3],[7,3],[0,4],[1,4],[2,4],[3,4],[4,4],[5,4],[6,4],[7,4],[1,5],[2,5],[5,5],[6,5],[0,6],[2,6],[5,6],[7,6]],
  squid: [[3,0],[0,1],[2,1],[3,1],[4,1],[6,1],[0,2],[1,2],[2,2],[3,2],[4,2],[5,2],[6,2],[0,3],[1,3],[2,3],[3,3],[4,3],[5,3],[6,3],[1,4],[2,4],[4,4],[5,4],[0,5],[1,5],[5,5],[6,5],[1,6],[5,6]],
  octo: [[3,0],[1,1],[3,1],[5,1],[0,2],[1,2],[2,2],[3,2],[4,2],[5,2],[6,2],[0,3],[2,3],[4,3],[6,3],[0,4],[1,4],[2,4],[3,4],[4,4],[5,4],[6,4],[2,5],[4,5],[0,6],[1,6],[5,6],[6,6]],
};

const SHIP_PIXELS: [number, number][] = [[3,0],[2,1],[3,1],[4,1],[1,2],[2,2],[3,2],[4,2],[5,2],[0,3],[1,3],[2,3],[3,3],[4,3],[5,3],[6,3]];

const starsBack = (() => {
  const rand = seededRand(800);
  return Array.from({ length: 30 }, () => ({
    x: rand() * 100, y: rand() * 100,
    size: 0.5 + rand() * 1,
    dur: 2 + rand() * 4,
    delay: rand() * 6,
  }));
})();

const starsFront = (() => {
  const rand = seededRand(799);
  return Array.from({ length: 20 }, () => ({
    x: rand() * 100, y: rand() * 100,
    size: 1 + rand() * 2,
    dur: 1 + rand() * 2.5,
    delay: rand() * 4,
    color: rand() < 0.3 ? '#ff88ff' : rand() < 0.6 ? '#88ffff' : '#ffffff',
  }));
})();

const invaders = (() => {
  const rand = seededRand(801);
  const types = ['crab', 'squid', 'octo'] as const;
  return Array.from({ length: 12 }, (_, i) => ({
    x: 3 + (i % 6) * 16 + rand() * 3,
    y: 4 + Math.floor(i / 6) * 12 + rand() * 2,
    pixels: INVADER_PIXELS[types[i % 3]!],
    dur: 3.5 + rand() * 3.5,
    delay: rand() * 5,
    color: i % 3 === 0 ? '#00ff88' : i % 3 === 1 ? '#ff00ff' : '#00ffff',
  }));
})();

const ghosts = (() => {
  const rand = seededRand(802);
  const colors = ['#ff0000', '#ffb8ff', '#00ffff', '#ffb852'];
  return Array.from({ length: 4 }, (_, i) => ({
    x: 5 + rand() * 85,
    y: 45 + rand() * 40,
    color: colors[i]!,
    dur: 14 + rand() * 12,
    delay: rand() * 10,
    dir: rand() > 0.5 ? 1 : -1,
  }));
})();

const coins = (() => {
  const rand = seededRand(803);
  return Array.from({ length: 15 }, () => ({
    x: rand() * 100,
    dur: 3.5 + rand() * 4.5,
    delay: rand() * 18,
    size: 5 + rand() * 7,
  }));
})();

const cabinets = (() => {
  const rand = seededRand(804);
  return Array.from({ length: 6 }, (_, i) => ({
    x: 2 + i * 17 + rand() * 5,
    h: 30 + rand() * 18,
    w: 8 + rand() * 5,
    screenColor: ['#00ff88', '#ff00ff', '#00ffff', '#ffff00', '#ff6600', '#88ff00'][i]!,
    flicker: 1.5 + rand() * 3,
  }));
})();

const CAB_BUTTONS = [
  { x: 55, color: 'rgba(255,0,0,0.1)' },
  { x: 63, color: 'rgba(0,100,255,0.08)' },
  { x: 71, color: 'rgba(255,255,0,0.07)' },
];

const tetris = (() => {
  const rand = seededRand(806);
  const colors = ['#00ffff', '#ffff00', '#ff00ff', '#00ff00', '#ff6600', '#ff0000', '#0088ff'];
  const shapes: number[][][] = [
    [[1,1,1,1]], [[1,1],[1,1]], [[0,1,0],[1,1,1]], [[1,0],[1,0],[1,1]], [[0,1],[0,1],[1,1]],
    [[1,1,0],[0,1,1]], [[0,1,1],[1,1,0]],
  ];
  return Array.from({ length: 12 }, () => {
    const shape = shapes[Math.floor(rand() * shapes.length)]!;
    const blocks: { left: number; top: number }[] = [];
    shape.forEach((row, ri) => row.forEach((cell, ci) => {
      if (cell) blocks.push({ left: ci * 7, top: ri * 7 });
    }));
    return {
      x: rand() * 92,
      blocks,
      color: colors[Math.floor(rand() * colors.length)]!,
      dur: 8 + rand() * 14,
      delay: rand() * 22,
      rot: Math.floor(rand() * 4) * 90,
    };
  });
})();

const lasers = (() => {
  const rand = seededRand(807);
  return Array.from({ length: 10 }, () => ({
    x: 8 + rand() * 84,
    dur: 0.5 + rand() * 0.7,
    delay: rand() * 14,
    color: rand() < 0.5 ? '#00ff88' : '#ff4444',
  }));
})();

const powerups = (() => {
  const rand = seededRand(808);
  const types = ['cherry', 'star', 'mushroom', 'heart'] as const;
  return Array.from({ length: 8 }, (_, i) => ({
    x: 10 + rand() * 80,
    y: 20 + rand() * 60,
    type: types[i % 4]!,
    dur: 5 + rand() * 6,
    delay: rand() * 16,
    size: 10 + rand() * 6,
  }));
})();

const explosions = (() => {
  const rand = seededRand(809);
  return Array.from({ length: 6 }, () => ({
    x: 10 + rand() * 80,
    y: 10 + rand() * 60,
    dur: 4 + rand() * 6,
    delay: rand() * 18,
    particles: Array.from({ length: 8 }, () => {
      const angle = rand() * 360;
      const dist = 15 + rand() * 30;
      return {
        ex: Math.cos((angle * Math.PI) / 180) * dist,
        ey: Math.sin((angle * Math.PI) / 180) * dist,
        size: 1.5 + rand() * 2,
        color: rand() < 0.33 ? '#ffff00' : rand() < 0.66 ? '#ff6600' : '#ff0000',
      };
    }),
  }));
})();

const mazeWalls = (() => {
  const rand = seededRand(810);
  const walls: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let i = 0; i < 20; i++) {
    const x = 5 + rand() * 90;
    const y = 40 + rand() * 55;
    const horiz = rand() > 0.5;
    const len = 5 + rand() * 15;
    walls.push({
      x1: x, y1: y,
      x2: horiz ? x + len : x,
      y2: horiz ? y : y + len * 0.6,
    });
  }
  return walls;
})();

const snake = (() => {
  const rand = seededRand(811);
  const segs: { x: number; y: number; fill: string; opacity: number }[] = [];
  let sx = 5 + rand() * 30;
  let sy = 35 + rand() * 20;
  for (let i = 0; i < 12; i++) {
    segs.push({ x: sx, y: sy, fill: i === 0 ? '#88ff00' : '#44cc00', opacity: 0.3 - i * 0.015 });
    if (rand() > 0.5) sx += 1.5; else sy += 1.2;
  }
  return { segs, dur: 18 + rand() * 10, delay: rand() * 5 };
})();

const PAC_DOTS = Array.from({ length: 20 }, (_, i) => 5 + i * 4.8);
const PELLETS = [20, 55, 85].map((x, i) => ({ x, delay: i * 0.5 }));
const PONG_LINE = Array.from({ length: 10 }, (_, i) => 38 + i * 3);

function RetroArcadeScene(props: SceneProps) {
  return (
    <SceneShell reducedMotion={props.reducedMotion} base="radial-gradient(ellipse at 50% 38%, #0a0a24 0%, #05050f 55%, #030308 100%)">
      {/* Deep space gradient */}
      <div class="absolute inset-0" style={{
        background: 'radial-gradient(ellipse at 50% 40%, rgba(20,8,50,0.35) 0%, rgba(4,4,16,0.15) 50%, transparent 100%)',
      }} />

      {/* Parallax star layers */}
      <For each={starsBack}>
        {(s) => (
          <div class="absolute"
            style={{ left: `${s.x}%`, top: `${s.y}%`,
              width: `${s.size}px`, height: `${s.size}px`,
              background: '#888',
              animation: `rc-twinkle ${s.dur}s ease-in-out ${s.delay}s infinite` }} />
        )}
      </For>
      <For each={starsFront}>
        {(s) => (
          <div class="absolute"
            style={{ left: `${s.x}%`, top: `${s.y}%`,
              width: `${s.size}px`, height: `${s.size}px`,
              background: s.color,
              'box-shadow': `0 0 4px ${s.color}80`,
              animation: `rc-twinkle ${s.dur}s ease-in-out ${s.delay}s infinite` }} />
        )}
      </For>

      {/* Pixel grid overlay */}
      <div class="absolute inset-0" style={{
        'background-image': `
          linear-gradient(rgba(0,255,100,0.015) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,255,100,0.015) 1px, transparent 1px)`,
        'background-size': '12px 12px',
      }} />

      {/* Neon floor reflection at bottom */}
      <div class="absolute bottom-0 left-0 right-0 h-[12%]" style={{
        background: 'linear-gradient(to top, rgba(255,0,255,0.06), rgba(0,255,255,0.03) 50%, transparent)',
        filter: 'blur(8px)',
      }} />
      <div class="absolute bottom-0 left-0 right-0 h-[3%]" style={{
        background: 'linear-gradient(90deg, transparent 5%, rgba(255,0,255,0.08) 20%, rgba(0,255,255,0.06) 40%, rgba(0,255,136,0.07) 60%, rgba(255,255,0,0.05) 80%, transparent 95%)',
        filter: 'blur(4px)',
        animation: 'rc-floorpulse 4s ease-in-out infinite',
      }} />

      {/* SVG layer — invaders, pac-man, pong, maze, snake, spaceship */}
      <svg class="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        {/* Space Invaders */}
        <For each={invaders}>
          {(inv) => (
            <g style={{ animation: `rc-invader ${inv.dur}s ease-in-out ${inv.delay}s infinite` }}>
              <For each={inv.pixels}>
                {([px, py]) => (
                  <rect x={inv.x + px * 0.7} y={inv.y + py * 0.7}
                    width="0.7" height="0.7" fill={inv.color} opacity="0.45" />
                )}
              </For>
            </g>
          )}
        </For>

        {/* Player spaceship at bottom */}
        <g style={{ animation: 'rc-ship 10s ease-in-out infinite' }}>
          <For each={SHIP_PIXELS}>
            {([px, py]) => (
              <rect x={46 + px * 0.6} y={92 + py * 0.6}
                width="0.6" height="0.6" fill="#00ff88" opacity="0.5" />
            )}
          </For>
        </g>

        {/* Pac-Man chomping across */}
        <g style={{ animation: 'rc-pacmove 14s linear infinite' }}>
          <circle cx="0" cy="68" r="2.2" fill="#ffff00" opacity="0.5" />
          <path d="M0 68 L2.2 66.5 L2.2 69.5Z" fill="rgba(4,6,16,0.95)"
            style={{ animation: 'rc-chomp 0.25s step-end infinite' }} />
        </g>
        {/* Pac dot trail */}
        <For each={PAC_DOTS}>
          {(x) => <rect x={x} y="67.6" width="0.8" height="0.8" fill="#ffff00" opacity="0.12" />}
        </For>
        {/* Power pellets */}
        <For each={PELLETS}>
          {(p) => (
            <circle cx={p.x} cy="68" r="1" fill="#ffff00" opacity="0.2"
              style={{ animation: `rc-twinkle 1.5s ease-in-out ${p.delay}s infinite` }} />
          )}
        </For>

        {/* Pong game */}
        <rect x="2" y="42" width="0.8" height="6" fill="#ffffff" opacity="0.15"
          style={{ animation: 'rc-paddle-l 4s ease-in-out infinite' }} />
        <rect x="97.2" y="44" width="0.8" height="6" fill="#ffffff" opacity="0.15"
          style={{ animation: 'rc-paddle-r 3.5s ease-in-out infinite' }} />
        <rect x="49.5" y="44" width="1" height="1" fill="#ffffff" opacity="0.2"
          style={{ animation: 'rc-pongball 3s linear infinite' }} />
        <For each={PONG_LINE}>
          {(y) => <rect x="49.8" y={y} width="0.4" height="1.5" fill="#ffffff" opacity="0.05" />}
        </For>

        {/* Maze walls — pac-man style */}
        <For each={mazeWalls}>
          {(w) => (
            <line x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2}
              stroke="#0044ff" stroke-width="0.4" opacity="0.12"
              stroke-linecap="round" />
          )}
        </For>

        {/* Snake game */}
        <g style={{ animation: `rc-snakemove ${snake.dur}s ease-in-out ${snake.delay}s infinite` }}>
          <For each={snake.segs}>
            {(seg) => (
              <rect x={seg.x} y={seg.y} width="1.2" height="1.2"
                fill={seg.fill} opacity={seg.opacity} rx="0.1" />
            )}
          </For>
          {/* Apple */}
          <circle cx={snake.segs[0]!.x + 8} cy={snake.segs[0]!.y} r="0.7"
            fill="#ff0040" opacity="0.35" />
        </g>
      </svg>

      {/* Pac-Man ghosts */}
      <For each={ghosts}>
        {(g) => (
          <svg class="absolute" viewBox="0 0 14 16"
            style={{
              left: `${g.x}%`, top: `${g.y}%`,
              width: '24px', height: '28px',
              filter: `drop-shadow(0 0 8px ${g.color}50)`,
              animation: `rc-ghost ${g.dur}s ease-in-out ${g.delay}s infinite`,
              ['--rc-gdir' as string]: `${g.dir * 250}px`,
              opacity: 0,
            }}>
            <path d="M1 14 L1 5 Q1 1 7 1 Q13 1 13 5 L13 14 L11 12 L9 14 L7 12 L5 14 L3 12Z"
              fill={g.color} opacity="0.4" />
            <rect x="3" y="5" width="3" height="3" fill="white" opacity="0.55" rx="0.5" />
            <rect x="8" y="5" width="3" height="3" fill="white" opacity="0.55" rx="0.5" />
            <rect x={g.dir > 0 ? '5' : '3'} y="6" width="1.5" height="1.5" fill="#111" opacity="0.6" />
            <rect x={g.dir > 0 ? '10' : '8'} y="6" width="1.5" height="1.5" fill="#111" opacity="0.6" />
          </svg>
        )}
      </For>

      {/* Falling Tetris pieces */}
      <For each={tetris}>
        {(t) => (
          <div class="absolute" style={{
            left: `${t.x}%`, top: '-5%',
            transform: `rotate(${t.rot}deg)`,
            animation: `rc-tetfall ${t.dur}s linear ${t.delay}s infinite`,
            opacity: 0,
          }}>
            <For each={t.blocks}>
              {(b) => (
                <div class="absolute"
                  style={{
                    left: `${b.left}px`, top: `${b.top}px`,
                    width: '6px', height: '6px',
                    background: t.color,
                    opacity: 0.18,
                    border: `1px solid ${t.color}35`,
                    'box-shadow': `0 0 3px ${t.color}25`,
                  }} />
              )}
            </For>
          </div>
        )}
      </For>

      {/* Power-ups floating */}
      <For each={powerups}>
        {(p) => (
          <div class="absolute" style={{
            left: `${p.x}%`, top: `${p.y}%`,
            width: `${p.size}px`, height: `${p.size}px`,
            opacity: 0,
            animation: `rc-powerup ${p.dur}s ease-in-out ${p.delay}s infinite`,
          }}>
            <svg viewBox="0 0 16 16" width="100%" height="100%">
              {p.type === 'cherry' && <>
                <circle cx="6" cy="12" r="3.5" fill="#ff0040" opacity="0.4" />
                <circle cx="11" cy="10" r="3" fill="#ff0040" opacity="0.35" />
                <path d="M6 8 Q8 2 11 7" fill="none" stroke="#00cc00" stroke-width="1" opacity="0.3" />
              </>}
              {p.type === 'star' && <path d="M8 1 L10 6 L15 6 L11 9 L13 14 L8 11 L3 14 L5 9 L1 6 L6 6Z"
                fill="#ffff00" opacity="0.3" />}
              {p.type === 'mushroom' && <>
                <ellipse cx="8" cy="7" rx="6" ry="5" fill="#ff0000" opacity="0.35" />
                <circle cx="5" cy="6" r="1.5" fill="white" opacity="0.25" />
                <circle cx="11" cy="6" r="1.5" fill="white" opacity="0.25" />
                <rect x="6" y="11" width="4" height="4" fill="#ffe0a0" opacity="0.3" rx="1" />
              </>}
              {p.type === 'heart' && <path d="M8 14 Q2 9 2 5 Q2 2 5 2 Q7 2 8 4 Q9 2 11 2 Q14 2 14 5 Q14 9 8 14Z"
                fill="#ff4488" opacity="0.35" />}
            </svg>
          </div>
        )}
      </For>

      {/* Pixel explosion bursts */}
      <For each={explosions}>
        {(ex) => (
          <div class="absolute" style={{ left: `${ex.x}%`, top: `${ex.y}%`, width: '0', height: '0' }}>
            <For each={ex.particles}>
              {(p) => (
                <div class="absolute"
                  style={{
                    width: `${p.size}px`, height: `${p.size}px`,
                    background: p.color,
                    'box-shadow': `0 0 4px ${p.color}60`,
                    opacity: 0,
                    animation: `rc-explode ${ex.dur}s ease-out ${ex.delay}s infinite`,
                    ['--rc-ex' as string]: `${p.ex}px`,
                    ['--rc-ey' as string]: `${p.ey}px`,
                  }} />
              )}
            </For>
          </div>
        )}
      </For>

      {/* Arcade cabinet silhouettes */}
      <For each={cabinets}>
        {(cab) => (
          <div class="absolute bottom-0"
            style={{ left: `${cab.x}%`, width: `${cab.w}%`, height: `${cab.h}%` }}>
            <div class="absolute inset-0" style={{
              background: 'linear-gradient(to top, rgba(8,8,22,0.85), rgba(12,12,30,0.65) 65%, rgba(16,16,38,0.4) 82%, transparent)',
              'clip-path': 'polygon(8% 100%, 3% 28%, 12% 0%, 88% 0%, 97% 28%, 92% 100%)',
            }} />
            <div class="absolute" style={{
              left: '18%', right: '18%', top: '6%', height: '32%',
              background: cab.screenColor,
              opacity: 0.07,
              'box-shadow': `0 0 25px ${cab.screenColor}25, 0 0 50px ${cab.screenColor}10`,
              animation: `rc-screen ${cab.flicker}s step-end infinite`,
            }} />
            <div class="absolute" style={{
              left: '18%', right: '18%', top: '6%', height: '32%',
              'background-image': 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.12) 2px, rgba(0,0,0,0.12) 3px)',
              opacity: 0.5,
            }} />
            {/* Marquee glow at top */}
            <div class="absolute" style={{
              left: '15%', right: '15%', top: '1%', height: '4%',
              background: cab.screenColor,
              opacity: 0.04,
              filter: 'blur(3px)',
              animation: `rc-twinkle ${cab.flicker * 1.5}s ease-in-out infinite`,
            }} />
            {/* Joystick dot */}
            <div class="absolute" style={{
              left: '40%', top: '52%', width: '8%', height: '4%',
              'border-radius': '50%',
              background: 'rgba(200,200,200,0.08)',
            }} />
            {/* Buttons */}
            <For each={CAB_BUTTONS}>
              {(b) => (
                <div class="absolute" style={{
                  left: `${b.x}%`, top: '53%', width: '6%', height: '3%',
                  'border-radius': '50%',
                  background: b.color,
                }} />
              )}
            </For>
            <div class="absolute" style={{
              left: '40%', width: '20%', top: '70%', height: '2.5%',
              background: 'rgba(80,80,80,0.12)',
              'border-radius': '2px',
            }} />
          </div>
        )}
      </For>

      {/* Laser shots */}
      <For each={lasers}>
        {(l) => (
          <div class="absolute"
            style={{
              left: `${l.x}%`, bottom: '0', width: '2px', height: '14px',
              background: `linear-gradient(to top, ${l.color}, ${l.color}88)`,
              'box-shadow': `0 0 6px ${l.color}50, 0 0 14px ${l.color}20`,
              animation: `rc-laser ${l.dur}s linear ${l.delay}s infinite`,
              opacity: 0,
            }} />
        )}
      </For>

      {/* Falling coins with spin */}
      <For each={coins}>
        {(c) => (
          <div class="absolute"
            style={{
              left: `${c.x}%`, top: '-4%',
              width: `${c.size}px`, height: `${c.size}px`,
              'border-radius': '50%',
              background: 'linear-gradient(135deg, #ffd700, #ffaa00, #ffd700)',
              border: '1px solid rgba(255,200,0,0.25)',
              'box-shadow': '0 0 10px rgba(255,215,0,0.25), inset 0 0 3px rgba(255,255,200,0.25)',
              animation: `rc-coin ${c.dur}s ease-in ${c.delay}s infinite`,
              opacity: 0,
            }} />
        )}
      </For>

      {/* HUD elements */}
      <div class="absolute top-[2%] left-[50%] -translate-x-1/2" style={{
        'font-family': '"Courier New", monospace', 'font-size': '9px', 'letter-spacing': '4px',
        color: '#ff0000', opacity: 0.07,
        'text-shadow': '0 0 8px #ff000030',
        animation: 'rc-blink 1.5s step-end infinite',
      }}>HIGH SCORE</div>

      <div class="absolute top-[5%] left-[50%] -translate-x-1/2" style={{
        'font-family': '"Courier New", monospace', 'font-size': '7px', 'letter-spacing': '2px',
        color: '#ffffff', opacity: 0.05,
      }}>99999</div>

      {/* Lives indicator — 3 small ships */}
      <div class="absolute top-[2.5%] left-[5%] flex gap-[4px]">
        <For each={[0, 1, 2]}>
          {() => (
            <div style={{
              width: '6px', height: '6px',
              'clip-path': 'polygon(50% 0%, 0% 100%, 100% 100%)',
              background: '#00ff88', opacity: 0.08,
            }} />
          )}
        </For>
      </div>

      {/* Level indicator */}
      <div class="absolute top-[2.5%] right-[5%]" style={{
        'font-family': '"Courier New", monospace', 'font-size': '6px', 'letter-spacing': '1px',
        color: '#00ffff', opacity: 0.06,
      }}>LVL 42</div>

      {/* Health bar */}
      <div class="absolute top-[8%] left-[5%]" style={{
        width: '40px', height: '4px',
        background: 'rgba(255,0,0,0.06)',
        border: '1px solid rgba(255,255,255,0.04)',
      }}>
        <div style={{
          width: '75%', height: '100%',
          background: 'linear-gradient(90deg, #ff0000, #ffff00)',
          opacity: 0.3,
        }} />
      </div>

      <div class="absolute bottom-[3%] left-[50%] -translate-x-1/2" style={{
        'font-family': '"Courier New", monospace', 'font-size': '8px', 'letter-spacing': '3px',
        color: '#00ff88', opacity: 0.06,
        'text-shadow': '0 0 10px #00ff8830',
        animation: 'rc-blink 1s step-end infinite',
      }}>INSERT COIN</div>

      {/* "GAME OVER" — occasional flash */}
      <div class="absolute top-[45%] left-[50%] -translate-x-1/2" style={{
        'font-family': '"Courier New", monospace', 'font-size': '14px', 'letter-spacing': '6px',
        color: '#ff0000', opacity: 0,
        'text-shadow': '0 0 15px #ff000040, 0 0 30px #ff000020',
        animation: 'rc-gameover 20s step-end infinite',
      }}>GAME OVER</div>

      {/* CRT scanline overlay */}
      <div class="absolute inset-0" style={{
        'background-image': 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.05) 2px, rgba(0,0,0,0.05) 4px)',
        animation: 'rc-scanroll 6s linear infinite',
      }} />

      {/* Horizontal CRT interference line */}
      <div class="absolute left-0 right-0 h-[2px]" style={{
        background: 'rgba(255,255,255,0.03)',
        animation: 'rc-hline 4s linear infinite',
      }} />

      {/* CRT vignette */}
      <div class="absolute inset-0" style={{
        background: 'radial-gradient(ellipse at 50% 50%, transparent 45%, rgba(0,0,0,0.3) 100%)',
      }} />

      {/* Neon border glow — all 4 edges */}
      <div class="absolute top-0 left-0 bottom-0 w-[2px]" style={{
        background: 'linear-gradient(to bottom, transparent 8%, rgba(255,0,255,0.12) 25%, rgba(0,255,255,0.1) 50%, rgba(0,255,136,0.08) 75%, transparent 92%)',
        'box-shadow': '2px 0 15px rgba(255,0,255,0.04)',
      }} />
      <div class="absolute top-0 right-0 bottom-0 w-[2px]" style={{
        background: 'linear-gradient(to bottom, transparent 8%, rgba(0,255,255,0.12) 25%, rgba(255,0,255,0.1) 50%, rgba(0,255,136,0.08) 75%, transparent 92%)',
        'box-shadow': '-2px 0 15px rgba(0,255,255,0.04)',
      }} />
      <div class="absolute top-0 left-0 right-0 h-[2px]" style={{
        background: 'linear-gradient(to right, transparent 8%, rgba(255,0,255,0.08) 30%, rgba(0,255,255,0.06) 70%, transparent 92%)',
        'box-shadow': '0 2px 12px rgba(255,0,255,0.03)',
      }} />
      <div class="absolute bottom-0 left-0 right-0 h-[2px]" style={{
        background: 'linear-gradient(to right, transparent 8%, rgba(0,255,136,0.1) 30%, rgba(255,0,255,0.07) 70%, transparent 92%)',
        'box-shadow': '0 -2px 12px rgba(0,255,136,0.04)',
      }} />

      {/* Ambient neon glow clouds */}
      <div class="absolute top-[15%] left-[12%] w-[min(220px,22vw)] h-[min(220px,22vh)] rounded-full"
        style={{ background: 'radial-gradient(ellipse, rgba(255,0,255,0.045), transparent 60%)', filter: 'blur(35px)', animation: 'rc-glow1 7s ease-in-out infinite' }} />
      <div class="absolute top-[35%] right-[8%] w-[min(280px,25vw)] h-[min(280px,25vh)] rounded-full"
        style={{ background: 'radial-gradient(ellipse, rgba(0,255,255,0.04), transparent 60%)', filter: 'blur(40px)', animation: 'rc-glow1 9s ease-in-out 2.5s infinite' }} />
      <div class="absolute bottom-[20%] left-[35%] w-[min(200px,20vw)] h-[min(200px,20vh)] rounded-full"
        style={{ background: 'radial-gradient(ellipse, rgba(0,255,136,0.04), transparent 60%)', filter: 'blur(30px)', animation: 'rc-glow1 6s ease-in-out 4.5s infinite' }} />
      <div class="absolute top-[60%] left-[60%] w-[min(160px,16vw)] h-[min(160px,16vh)] rounded-full"
        style={{ background: 'radial-gradient(ellipse, rgba(255,255,0,0.025), transparent 60%)', filter: 'blur(25px)', animation: 'rc-glow1 8s ease-in-out 6s infinite' }} />

      {/* CRT flicker */}
      <div class="absolute inset-0" style={{
        animation: 'rc-crtflick 5s step-end infinite',
        background: 'rgba(255,255,255,0.012)',
        opacity: 0,
      }} />

      <style>{`
        @keyframes rc-twinkle { 0%,100%{opacity:0.15} 50%{opacity:0.65} }
        @keyframes rc-invader { 0%,100%{transform:translateX(0)} 25%{transform:translateX(6px)} 50%{transform:translateX(0)} 75%{transform:translateX(-6px)} }
        @keyframes rc-ship { 0%,100%{transform:translateX(0)} 25%{transform:translateX(12px)} 75%{transform:translateX(-12px)} }
        @keyframes rc-pacmove { 0%{transform:translateX(-5%)} 100%{transform:translateX(105%)} }
        @keyframes rc-chomp { 0%,49%{opacity:1} 50%,100%{opacity:0} }
        @keyframes rc-ghost { 0%{opacity:0;transform:translateX(0)} 6%{opacity:0.55} 94%{opacity:0.35} 100%{opacity:0;transform:translateX(var(--rc-gdir,120px))} }
        @keyframes rc-tetfall { 0%{opacity:0;transform:translateY(0)} 3%{opacity:0.22} 97%{opacity:0.1} 100%{opacity:0;transform:translateY(115vh)} }
        @keyframes rc-laser { 0%{opacity:0;bottom:0} 5%{opacity:0.6} 95%{opacity:0.4} 100%{opacity:0;bottom:100%} }
        @keyframes rc-coin { 0%{opacity:0;transform:translateY(0) rotateY(0deg)} 6%{opacity:0.3} 92%{opacity:0.15} 100%{opacity:0;transform:translateY(110vh) rotateY(1440deg)} }
        @keyframes rc-screen { 0%{opacity:0.07} 25%{opacity:0.09} 50%{opacity:0.04} 75%{opacity:0.08} 100%{opacity:0.07} }
        @keyframes rc-blink { 0%,49%{opacity:inherit} 50%,100%{opacity:0} }
        @keyframes rc-scanroll { 0%{background-position:0 0} 100%{background-position:0 80px} }
        @keyframes rc-hline { 0%{top:-2%} 100%{top:102%} }
        @keyframes rc-glow1 { 0%,100%{opacity:0.65;transform:scale(1)} 50%{opacity:1;transform:scale(1.12)} }
        @keyframes rc-crtflick { 0%,96%{opacity:0} 96.5%{opacity:1} 97%{opacity:0} 97.5%{opacity:0.6} 98%{opacity:0} }
        @keyframes rc-powerup { 0%{opacity:0;transform:scale(0.5)} 15%{opacity:0.5;transform:scale(1.1)} 50%{opacity:0.4;transform:scale(1) translateY(-8px)} 85%{opacity:0.3;transform:scale(0.9)} 100%{opacity:0;transform:scale(0.4)} }
        @keyframes rc-explode { 0%{opacity:0;transform:translate(0,0) scale(1)} 8%{opacity:0.8} 100%{opacity:0;transform:translate(var(--rc-ex,15px),var(--rc-ey,-15px)) scale(0)} }
        @keyframes rc-paddle-l { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
        @keyframes rc-paddle-r { 0%,100%{transform:translateY(0)} 50%{transform:translateY(3px)} }
        @keyframes rc-pongball { 0%{transform:translate(0,0)} 25%{transform:translate(20px,-3px)} 50%{transform:translate(0,2px)} 75%{transform:translate(-20px,-2px)} 100%{transform:translate(0,0)} }
        @keyframes rc-snakemove { 0%,100%{transform:translate(0,0)} 50%{transform:translate(15px,5px)} }
        @keyframes rc-floorpulse { 0%,100%{opacity:0.7} 50%{opacity:1} }
        @keyframes rc-gameover { 0%,92%{opacity:0} 93%{opacity:0.06} 93.5%{opacity:0} 94%{opacity:0.05} 94.5%{opacity:0} 95%{opacity:0.07} 96%{opacity:0} }
      `}</style>
    </SceneShell>
  );
}

export const retroArcade = {
  id: 'retro-arcade',
  label: 'Retro Arcade',
  kind: 'scene',
  component: RetroArcadeScene,
} as const satisfies SceneVariant;
