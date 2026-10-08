export function Core({ state }: { state: 'idle' | 'thinking' | 'listening' | 'speaking' }) {
  return <div className={`core core-${state}`} aria-hidden="true">
    <div className="core-halo" />
    <svg className="core-outer" viewBox="0 0 260 260">
      <circle cx="130" cy="130" r="120" className="core-track" />
      <circle cx="130" cy="130" r="120" className="core-dashes" />
      <path d="M130 10 A120 120 0 0 1 243 90 M130 250 A120 120 0 0 1 17 170" className="core-arcs" />
    </svg>
    <svg className="core-inner" viewBox="0 0 260 260">
      <circle cx="130" cy="130" r="101" className="core-track" />
      <circle cx="130" cy="130" r="94" className="core-inner-dashes" />
      <path d="M130 29 A101 101 0 0 1 226 99 M130 231 A101 101 0 0 1 34 161" className="core-arcs" />
    </svg>
    <div className="core-sphere"><div className="core-grid" /><span className="core-letter">J<span>.</span></span></div>
    <span className="core-cross cross-top" /><span className="core-cross cross-bottom" />
    <span className="core-cross cross-left" /><span className="core-cross cross-right" />
  </div>;
}
