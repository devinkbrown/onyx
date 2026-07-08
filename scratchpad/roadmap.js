(function () {
  // theme toggle — media query is the default; the button overrides both ways
  var root = document.documentElement;
  var btn = document.getElementById('themeToggle');
  var label = document.getElementById('themeLabel');
  function current() {
    var set = root.getAttribute('data-theme');
    if (set) return set;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  function paint() { label.textContent = current() === 'light' ? 'Paper' : 'Ink'; }
  btn.addEventListener('click', function () {
    root.setAttribute('data-theme', current() === 'light' ? 'dark' : 'light');
    paint();
  });
  paint();

  // sumi ink-wash — calm, edge-weighted, reduced-motion aware
  var canvas = document.getElementById('ink-canvas');
  var ctx = canvas.getContext('2d');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
  var blooms = [], raf = null;

  function accent() { return getComputedStyle(root).getPropertyValue('--shu') || 'oklch(0.63 0.2 30)'; }
  function resize() {
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function seed() {
    blooms = [];
    for (var i = 0; i < 7; i++) {
      var edge = Math.random() < 0.5 ? 0.14 : 0.86;
      blooms.push({
        x: Math.random() < 0.55 ? edge : Math.random(),
        y: Math.random(), r: 120 + Math.random() * 260,
        vx: (Math.random() - 0.5) * 0.00006, vy: (Math.random() - 0.5) * 0.00006,
        a: 0.02 + Math.random() * 0.045, ink: Math.random() < 0.22
      });
    }
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    var isLight = current() === 'light', acc = accent();
    for (var i = 0; i < blooms.length; i++) {
      var b = blooms[i], cx = b.x * W, cy = b.y * H;
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, b.r);
      var col = b.ink ? acc : (isLight ? 'oklch(0.35 0.02 60)' : 'oklch(0.82 0.02 80)');
      g.addColorStop(0, col.replace(')', ' / ' + b.a + ')'));
      g.addColorStop(1, col.replace(')', ' / 0)'));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, b.r, 0, Math.PI * 2); ctx.fill();
    }
  }
  function tick() {
    for (var i = 0; i < blooms.length; i++) {
      var b = blooms[i];
      b.x += b.vx; b.y += b.vy;
      if (b.x < -0.2 || b.x > 1.2) b.vx *= -1;
      if (b.y < -0.2 || b.y > 1.2) b.vy *= -1;
    }
    draw(); raf = requestAnimationFrame(tick);
  }
  function start() {
    resize(); seed(); draw();
    if (reduce) return;
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }
  window.addEventListener('resize', function () { resize(); seed(); draw(); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = null; } }
    else if (!reduce && !raf) { raf = requestAnimationFrame(tick); }
  });
  // the canvas is fixed to the viewport; give it a real pixel size
  canvas.style.position = 'fixed'; canvas.style.inset = '0';
  start();
})();
