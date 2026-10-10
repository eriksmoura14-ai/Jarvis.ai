import { Globe } from 'lucide-react';

export function SearchToggle({ enabled, checked, disabled, automatic, onChange }: { enabled: boolean; checked: boolean; disabled: boolean; automatic?: boolean; onChange: (value: boolean) => void }) {
  return <div><label className="search-toggle" title={enabled ? 'Pede uma consulta à web com fontes. Pedidos pessoais usam seus dados da conta.' : 'A pesquisa precisa de um backend atualizado e conectado.'}>
    <input data-gamepad type="checkbox" checked={checked} disabled={!enabled || disabled} onChange={event => onChange(event.target.checked)} /><Globe size={14} /> Pesquisar na web
    {!enabled && <small>Requer servidor conectado</small>}
  </label>{automatic && <p className="search-auto-hint">Pesquisa automática ativa. Pedidos pessoais usam suas notas e memórias.</p>}</div>;
}
