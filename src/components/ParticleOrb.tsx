import { useEffect, useRef, useState } from 'react';
import { particleSphere, type AssistantState } from '../lib/particle-sphere';

export function ParticleOrb({ state, level = () => undefined }: { state: AssistantState; level?: () => number | undefined }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef({ state, level }); current.current = { state, level };
  const [paused, setPaused] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const engine = useRef<ReturnType<typeof particleSphere>>(undefined);
  useEffect(() => {
    if (!canvas.current) return;
    const sphere = particleSphere(canvas.current, () => current.current.state, () => current.current.level());
    engine.current = sphere;
    return () => { sphere.destroy(); engine.current = undefined; };
  }, []);
  useEffect(() => { engine.current?.animate(!paused); }, [paused]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => { if (media.matches) setPaused(true); };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return <div className="jd-orb">
    <canvas ref={canvas} role="img" data-state={state} data-paused={paused} aria-label="JARVIS representado por uma esfera animada de partículas luminosas">Esfera de partículas do JARVIS.</canvas>
    <button data-gamepad type="button" className="jp-pause" aria-label={paused ? 'Iniciar animação' : 'Pausar animação'} onClick={() => setPaused(value => !value)}>{paused ? 'Animar' : 'Pausar'}</button>
  </div>;
}
