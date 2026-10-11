import { Globe } from 'lucide-react';
export function SearchStatus({ enabled }: { enabled: boolean }) {
  return <p className="search-auto-hint"><Globe size={14} aria-hidden="true" /> {enabled
    ? 'Pesquisa automática ativa. Perguntas pessoais usam suas notas e memórias; informações atuais usam a web.'
    : 'Conecte um servidor para pesquisar informações atuais. Notas e comandos locais continuam disponíveis.'}</p>;
}
