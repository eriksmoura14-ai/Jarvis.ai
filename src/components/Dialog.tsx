import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('keydown', escape); dialog?.close(); previous?.focus(); };
  }, [onClose]);
  return <dialog ref={ref} className="modal" aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="modal-heading"><h2 id="dialog-title">{title}</h2><button data-gamepad className="icon-button" aria-label="Fechar janela" onClick={onClose}><X size={20} /></button></div>
    {children}
  </dialog>;
}
