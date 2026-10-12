export interface AudioMeter { level: () => number | undefined; close: () => void }

// Analyse an existing, permitted audio stream. No permission requests or recording.
export function audioMeter(input: MediaStream | HTMLAudioElement): AudioMeter | undefined {
  if (typeof AudioContext === 'undefined') return;
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | MediaElementAudioSourceNode | undefined;
  let analyser: AnalyserNode | undefined;
  try {
    context = new AudioContext();
    // Never reroute audible playback through a context blocked by autoplay.
    if (input instanceof HTMLMediaElement && context.state !== 'running') { void context.close().catch(() => {}); return; }
    analyser = context.createAnalyser(); analyser.fftSize = 256;
    source = input instanceof HTMLMediaElement ? context.createMediaElementSource(input) : context.createMediaStreamSource(input);
    source.connect(analyser);
    // Preserve playback; microphone analysis must never feed speakers.
    if (input instanceof HTMLMediaElement) analyser.connect(context.destination);
    void context.resume().catch(() => {});
    const samples = new Float32Array(analyser.fftSize);
    const activeContext = context; const activeAnalyser = analyser; const activeSource = source;
    let closed = false;
    return {
      level: () => {
        if (closed || activeContext.state !== 'running') return;
        activeAnalyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        return Math.min(1, rms * 5);
      },
      close: () => {
        if (closed) return;
        closed = true; activeSource.disconnect(); activeAnalyser.disconnect();
        void activeContext.close().catch(() => {});
      },
    };
  } catch {
    // An unsupported analyser must not make voice unavailable.
    source?.disconnect(); analyser?.disconnect();
    void context?.close().catch(() => {});
    return;
  }
}
