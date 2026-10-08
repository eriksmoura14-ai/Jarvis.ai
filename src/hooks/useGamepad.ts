import { useEffect, useState } from 'react';

// Poll only while a controller is connected. Edge may also translate controller input into keyboard events.
export function useGamepad() {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!navigator.getGamepads) return;
    let frame = 0;
    let previous: boolean[] = [];
    const poll = () => {
      const pad = Array.from(navigator.getGamepads()).find(item => item?.mapping === 'standard');
      if (!pad) { setConnected(false); frame = 0; previous = []; return; }
      setConnected(true);
      const pressed = pad.buttons.map(button => button.pressed);
      const controls = Array.from(document.querySelectorAll<HTMLElement>('[data-gamepad]'))
        .filter(element => !element.hasAttribute('disabled') && element.getClientRects().length && (!document.querySelector('dialog[open]') || !!element.closest('dialog[open]')));
      const active = document.activeElement as HTMLElement | null;
      for (const button of [12, 13, 14, 15]) {
        if (pressed[button] && !previous[button] && controls.length) {
          const current = controls.indexOf(active!);
          const step = button === 12 || button === 14 ? -1 : 1;
          controls[current < 0 ? 0 : (current + step + controls.length) % controls.length].focus();
        }
      }
      if (pressed[0] && !previous[0] && active?.matches('[data-gamepad]')) active.click();
      if (pressed[1] && !previous[1]) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      previous = pressed;
      frame = requestAnimationFrame(poll);
    };
    const start = () => { if (!frame) poll(); };
    const visibility = () => {
      if (document.hidden) { cancelAnimationFrame(frame); frame = 0; previous = []; }
      else start();
    };
    window.addEventListener('gamepadconnected', start);
    document.addEventListener('visibilitychange', visibility);
    start();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('gamepadconnected', start);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  return connected;
}
