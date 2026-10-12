export type AssistantState = 'idle' | 'listening' | 'thinking' | 'speaking';
const energyFor = { idle: .12, listening: .48, thinking: .7, speaking: 1 };

// Geometry, noise, projection, colours and particle drawing from the approved
// Moderna HTML. Lifecycle and live audio replace its simulated events.
export function particleSphere(canvas: HTMLCanvasElement, readState: () => AssistantState, readLevel: () => number | undefined) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { animate: (_value: boolean) => {}, destroy: () => {} };
  let time = 0, last = 0, w = 0, h = 0, dpr = 1, energy = .12, rotation = 0, pulseTime = 0, speakingMix = 0;
  let animated = false, frameId = 0, destroyed = false;
  const seed = Math.random() * 5000;
  function hash(n: number) { const v = Math.sin(n * 127.1 + seed) * 43758.5453; return (v - Math.floor(v)) * 2 - 1; }
  function noise(t: number, key: number) { const k = Math.floor(t), u = t - k, s = u * u * (3 - 2 * u); return hash(k + key * 31.7) * (1 - s) + hash(k + 1 + key * 31.7) * s; }
  const points: { x: number; y: number; z: number; key: number; phase: number }[] = [], N = 1700, angle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - 2 * (i + .5) / N, r = Math.sqrt(1 - y * y), a = i * angle;
    points.push({ x: Math.cos(a) * r, y, z: Math.sin(a) * r, key: Math.random() * 1000, phase: Math.random() * Math.PI * 2 });
  }
  function draw() {
    if (!ctx || !w || !h || destroyed) return;
    ctx.clearRect(0, 0, w, h);
    const t = time, cx = w / 2 + noise(t * .16, 1) * 6, cy = h / 2 + noise(t * .12, 3) * 7;
    const base = Math.min(w * .29, h * .32) * (1 + noise(t * .32, 5) * .045);
    const glow = ctx.createRadialGradient(cx, cy, base * .1, cx, cy, base * 1.8);
    glow.addColorStop(0, 'rgba(87,151,255,.08)'); glow.addColorStop(.5, 'rgba(121,86,245,.05)'); glow.addColorStop(1, 'rgba(48,78,150,0)'); ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    const cr = Math.cos(rotation), sr = Math.sin(rotation), tilt = .18 + noise(t * .18, 7) * .3, ct = Math.cos(tilt), st = Math.sin(tilt);
    const pulse = noise(pulseTime, 9) * energy;
    const drift = .015 + energy * .025;
    const projected = points.map(p => {
      const wave = Math.sin(p.x * 4 + t * .7 + noise(t * .15, 11)) * Math.cos(p.y * 4 - t * .5) * Math.sin(p.z * 4 + t * .3);
      const spread = 1 + wave * (.055 + energy * .09) + noise(t * .5, p.key) * .038 + pulse * .06;
      const x0 = p.x * spread + noise(t * .4, p.key + 1) * drift, y0 = p.y * spread + noise(t * .38, p.key + 2) * drift, z0 = p.z * spread + noise(t * .43, p.key + 3) * drift;
      const x = x0 * cr + z0 * sr, z1 = -x0 * sr + z0 * cr, y = y0 * ct - z1 * st, z = y0 * st + z1 * ct;
      const perspective = 3.5 / (3.5 - z);
      return { x: cx + x * base * perspective, y: cy + y * base * perspective, z, r: (.6 + (z + 1) * .5) * perspective, key: p.key, phase: p.phase };
    }).sort((a, b) => a.z - b.z);
    for (const p of projected) {
      const front = Math.max(0, Math.min(1, (p.z + 1) / 2)), twinkle = .88 + noise(t * .35, p.key + 5) * .12;
      const alpha = (.17 + front * .73) * twinkle;
      ctx.beginPath(); ctx.fillStyle = `rgba(${95 + Math.round(45 * p.y / h)},${144 + Math.round(front * 65)},255,${alpha})`; ctx.arc(p.x, p.y, Math.max(.25, p.r), 0, Math.PI * 2); ctx.fill();
      if (front > .78 && p.phase > 6) { ctx.beginPath(); ctx.fillStyle = `rgba(191,225,255,${alpha * .15})`; ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2); ctx.fill(); }
    }
  }
  function resize() {
    if (destroyed || !ctx) return;
    const box = canvas.getBoundingClientRect(); w = box.width; h = box.height; dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw();
  }
  function frame(ts: number) {
    frameId = 0;
    if (!animated || destroyed || document.hidden) return;
    const dt = last ? Math.min((ts - last) / 1000, .05) : 0; last = ts;
    const state = readState(), level = readLevel();
    const target = level !== undefined && (state === 'speaking' || state === 'listening') ? .12 + Math.max(0, Math.min(1, level)) * .88 : energyFor[state];
    const smoothing = 1 - Math.exp(-dt * 4);
    time += dt; energy += (target - energy) * smoothing;
    speakingMix += ((state === 'speaking' ? 1 : 0) - speakingMix) * smoothing;
    // Integrate frequency rather than switching time multipliers on a state
    // change, keeping the noise phase continuous when speech starts or stops.
    pulseTime += dt * (.4 + speakingMix * 2.3);
    rotation += dt * (.12 + energy * .15 + noise(time * .16, 20) * .09);
    draw(); frameId = requestAnimationFrame(frame);
  }
  function schedule() { if (animated && !destroyed && !document.hidden && !frameId) { last = 0; frameId = requestAnimationFrame(frame); } }
  function visibility() { if (document.hidden) { cancelAnimationFrame(frameId); frameId = 0; last = 0; } else schedule(); }
  const observer = new ResizeObserver(resize); observer.observe(canvas);
  document.addEventListener('visibilitychange', visibility); resize();
  return {
    animate(value: boolean) { animated = value; cancelAnimationFrame(frameId); frameId = 0; last = 0; schedule(); },
    destroy() { destroyed = true; cancelAnimationFrame(frameId); frameId = 0; observer.disconnect(); document.removeEventListener('visibilitychange', visibility); },
  };
}
