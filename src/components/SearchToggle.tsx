import { Globe } from 'lucide-react';

export function SearchToggle({ enabled, checked, disabled, onChange }: { enabled: boolean; checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return <label className="search-toggle" title={enabled ? 'Envia o assunto ao buscador e mostra fontes.' : 'A pesquisa precisa de um backend atualizado e conectado.'}>
    <input data-gamepad type="checkbox" checked={checked} disabled={!enabled || disabled} onChange={event => onChange(event.target.checked)} /><Globe size={14} /> Pesquisar na web
    {!enabled && <small>Requer servidor conectado</small>}
  </label>;
}
