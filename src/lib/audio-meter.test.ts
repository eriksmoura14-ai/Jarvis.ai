import { afterEach, describe, expect, it, vi } from 'vitest';
import { audioMeter } from './audio-meter';

afterEach(() => vi.unstubAllGlobals());
function fixture(state = 'running') {
  class Element {}
  vi.stubGlobal('HTMLMediaElement', Element);
  const analyser = { fftSize: 256, connect: vi.fn(), disconnect: vi.fn(), getFloatTimeDomainData: (samples: Float32Array) => samples.fill(.1) };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const context = { state, destination: {}, createAnalyser: () => analyser, createMediaStreamSource: vi.fn(() => source), createMediaElementSource: vi.fn(() => source), resume: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  vi.stubGlobal('AudioContext', class { constructor() { return context; } });
  return { context, analyser, source, element: new Element() as HTMLAudioElement };
}
describe('volume dos fluxos de áudio existentes', () => {
  it('mede o microfone já permitido, sem conectá-lo aos alto-falantes, e libera uma vez', () => {
    const f = fixture(); const stream = {} as MediaStream; const meter = audioMeter(stream)!;
    expect(f.context.createMediaStreamSource).toHaveBeenCalledWith(stream); expect(f.analyser.connect).not.toHaveBeenCalled();
    expect(meter.level()).toBeCloseTo(.5); meter.close(); meter.close();
    expect(meter.level()).toBeUndefined(); expect(f.source.disconnect).toHaveBeenCalledOnce(); expect(f.context.close).toHaveBeenCalledOnce();
  });
  it('preserva o caminho de reprodução de áudio real ao medir o volume', () => {
    const f = fixture(); const meter = audioMeter(f.element)!;
    expect(f.context.createMediaElementSource).toHaveBeenCalledWith(f.element); expect(f.analyser.connect).toHaveBeenCalledWith(f.context.destination);
    expect(meter.level()).toBeCloseTo(.5); meter.close();
  });
  it('não silencia reprodução quando o contexto de áudio está bloqueado ou indisponível', () => {
    const f = fixture('suspended'); expect(audioMeter(f.element)).toBeUndefined();
    expect(f.context.createMediaElementSource).not.toHaveBeenCalled(); expect(f.context.close).toHaveBeenCalledOnce();
    vi.stubGlobal('AudioContext', undefined); expect(audioMeter(f.element)).toBeUndefined();
  });
});
