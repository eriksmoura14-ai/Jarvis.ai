import { afterEach, describe, expect, it, vi } from 'vitest';
import { particleSphere, type AssistantState } from './particle-sphere';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function fixture() {
  vi.spyOn(Math, 'random').mockReturnValue(.5);
  const queue = new Map<number, FrameRequestCallback>(); let sequence = 0;
  const handlers = new Map<string, () => void>();
  const document = { hidden: false, addEventListener: vi.fn((name: string, callback: () => void) => handlers.set(name, callback)), removeEventListener: vi.fn((name: string) => handlers.delete(name)) };
  vi.stubGlobal('document', document); vi.stubGlobal('devicePixelRatio', 3);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { queue.set(++sequence, callback); return sequence; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => queue.delete(id));
  const disconnect = vi.fn(); let resize = () => {};
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect = disconnect; });
  const ctx = { clearRect: vi.fn(), setTransform: vi.fn(), createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, beginPath() {}, arc: vi.fn(), fill() {}, fillStyle: '' };
  const canvas = { width: 0, height: 0, getContext: () => ctx, getBoundingClientRect: () => ({ width: 470, height: 285 }) } as unknown as HTMLCanvasElement;
  const tick = (time: number) => { const callbacks = [...queue.values()]; queue.clear(); callbacks.forEach(callback => callback(time)); };
  return { canvas, ctx, queue, tick, disconnect, handlers, document, resize: () => resize() };
}
describe('Canvas Moderna e ciclo de vida', () => {
  it('reaproveita as 1700 partículas e limita resolução sem depender do microfone', () => {
    const f = fixture(); const sphere = particleSphere(f.canvas, () => 'idle', () => undefined);
    expect(f.canvas.width).toBe(940); expect(f.canvas.height).toBe(570);
    expect(f.ctx.arc).toHaveBeenCalledTimes(1700);
    sphere.animate(true); f.tick(16); f.tick(32);
    expect(f.ctx.clearRect).toHaveBeenCalledTimes(3); expect(f.queue.size).toBe(1);
    sphere.destroy(); expect(f.queue.size).toBe(0); expect(f.disconnect).toHaveBeenCalledOnce(); expect(f.handlers.size).toBe(0);
  });
  it('mantém transições contínuas em ouvir, pensar, falar e voltar à espera', () => {
    const f = fixture(); let state: AssistantState = 'idle'; let level: number | undefined;
    const readLevel = vi.fn(() => level);
    const sphere = particleSphere(f.canvas, () => state, readLevel); sphere.animate(true); f.tick(100);
    let previous = f.ctx.arc.mock.calls.slice(-1700);
    for (const [index, next] of (['listening', 'thinking', 'speaking', 'idle'] as const).entries()) {
      state = next; level = next === 'listening' || next === 'speaking' ? 1 : undefined; f.tick(116 + index * 16);
      const current = f.ctx.arc.mock.calls.slice(-1700);
      // The camera and every point continue smoothly; a state switch does not
      // rebuild the sphere or jump its noise phase to a different timestamp.
      // Depth sorting changes paint order, so compare the spatial clouds rather
      // than treating the same draw index as the same physical particle.
      const maxShift = Math.max(...current.filter((_point, i) => i % 17 === 0).map(point => Math.min(...previous.map(before => Math.hypot(point[0] - before[0], point[1] - before[1])))));
      expect(maxShift).toBeLessThan(8); previous = current;
    }
    expect(readLevel).toHaveBeenCalledTimes(5); sphere.destroy();
  });
  it('pausa sem gastar frames, suspende em segundo plano e ignora callbacks após desmontar', () => {
    const f = fixture(); const sphere = particleSphere(f.canvas, () => 'idle', () => undefined);
    sphere.animate(true); f.tick(16); const draws = f.ctx.clearRect.mock.calls.length;
    sphere.animate(false); f.tick(1000); expect(f.ctx.clearRect).toHaveBeenCalledTimes(draws); expect(f.queue.size).toBe(0);
    sphere.animate(true); f.document.hidden = true; f.handlers.get('visibilitychange')!(); expect(f.queue.size).toBe(0);
    f.document.hidden = false; f.handlers.get('visibilitychange')!(); expect(f.queue.size).toBe(1);
    const late = [...f.queue.values()][0]; sphere.destroy(); late(100_000); f.resize();
    expect(f.ctx.clearRect).toHaveBeenCalledTimes(draws); expect(f.queue.size).toBe(0);
  });
});
