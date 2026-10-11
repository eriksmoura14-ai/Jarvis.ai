import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { PersonalSnapshot } from '../../shared/contracts';
import { MAX_IMPORT_FILES, MAX_IMPORT_BYTES, MAX_NOTE_BYTES, MAX_KNOWLEDGE_NOTES, MAX_LIBRARY_BYTES, pathKey, validMarkdownFiles, validKnowledgeSummary, validKnowledgeSources, type KnowledgeNote, type KnowledgeSource, type MarkdownFile } from '../../shared/knowledge';
import { ObsidianConnection } from './ObsidianConnection';
import { personalRequest } from '../lib/personal';

export function KnowledgeSources({ sources, onOpen }: { sources?: KnowledgeSource[]; onOpen: (id: string, revision: number) => void }) {
  if (!sources?.length) return null;
  return <section className="knowledge-sources" aria-label="Notas consultadas">
    <p>Notas consultadas · Obsidian</p>
    <small>Trechos recuperados da biblioteca pessoal. Confira como sustentam a resposta.</small>
    {sources.map(source => <details key={source.reference}><summary data-gamepad>[{source.reference}] {source.title}{source.heading && source.heading !== source.title ? ` · ${source.heading}` : ''}</summary>
      <small>{source.path}</small><p className="knowledge-excerpt">{source.excerpt}</p>
      <button data-gamepad className="secondary-button" onClick={() => onOpen(source.id, source.revision)}>Abrir nota: {source.title}</button>
    </details>)}
  </section>;
}

export function Knowledge({ snapshot, onRefresh, initialNote }: { snapshot: PersonalSnapshot; onRefresh: () => Promise<void>; initialNote?: { id: string; revision: number } }) {
  const [files, setFiles] = useState<MarkdownFile[]>([]); const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false); const [reading, setReading] = useState(false);
  const [notice, setNotice] = useState(''); const [error, setError] = useState('');
  const [query, setQuery] = useState(''); const [resultQuery, setResultQuery] = useState(''); const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [selected, setSelected] = useState(initialNote); const [note, setNote] = useState<KnowledgeNote>(); const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<{ id: string; revision: number; content: string; path: string }>();
  const [removing, setRemoving] = useState<string>();
  const selection = useRef(0); const folder = useRef<HTMLInputElement>(null);
  const searchController = useRef<AbortController | undefined>(undefined);
  const library = snapshot.library ?? []; const revision = snapshot.libraryRevision ?? 0;
  useEffect(() => { folder.current?.setAttribute('webkitdirectory', ''); return () => { selection.current++; }; }, []);
  useEffect(() => { setSources([]); setResultQuery(''); setReplace(false); setRemoving(undefined);
    return () => searchController.current?.abort();
  }, [revision]);
  useEffect(() => {
    setNote(undefined); setLoading(false); if (!selected) return;
    const controller = new AbortController(); setLoading(true); if (!draft) setError('');
    void personalRequest<KnowledgeNote>(`knowledge/${encodeURIComponent(selected.id)}`, 'GET', undefined, controller.signal).then(value => {
      if (!validKnowledgeSummary(value) || typeof value.content !== 'string') throw new Error('O servidor retornou uma nota inválida.');
      if (!controller.signal.aborted) setNote(value);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível abrir a nota.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selected, revision]);
  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget; const chosen = Array.from(input.files ?? []); input.value = '';
    const token = ++selection.current; setReading(false); setFiles([]); setReplace(false); setError(''); setNotice('');
    const eligible = chosen.filter(file => /\.md$/i.test(file.name) && !(file.webkitRelativePath || file.name).split('/').some(part => part.startsWith('.')));
    if (!eligible.length) { setError('Selecione arquivos .md. Anexos e pastas ocultas não são importados.'); return; }
    if (eligible.length > MAX_IMPORT_FILES || eligible.some(file => file.size > MAX_NOTE_BYTES) || eligible.reduce((sum, file) => sum + file.size, 0) > MAX_IMPORT_BYTES) {
      setError('Selecione até 20 notas: 50 KB por arquivo e 250 KB no lote. Importe o restante em outro lote.'); return;
    }
    setReading(true);
    try {
      const decoded = await Promise.all(eligible.map(async file => ({ path: file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(1).join('/') : file.name,
        content: new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()) })));
      if (token !== selection.current) return;
      setFiles(decoded); if (chosen.length !== eligible.length) setNotice('Anexos e arquivos ocultos foram ignorados. Revise as notas abaixo.');
    } catch { if (token === selection.current) setError('Não foi possível ler o texto em UTF-8. Exporte novamente como Markdown e tente de novo.'); }
    finally { if (token === selection.current) setReading(false); }
  };
  const importFiles = async () => {
    if (busy || reading) return;
    if (!validMarkdownFiles(files)) { setError('Confira os caminhos: use nomes .md únicos, sem pastas ocultas, “..” ou barras invertidas, e texto UTF-8 não vazio.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const receipt = await personalRequest<{ added: number; updated: number; unchanged: number }>('knowledge/import', 'POST', { files, libraryRevision: revision, replace });
      setFiles([]); setReplace(false); setNotice(`Importação salva: ${receipt.added} nova(s), ${receipt.updated} atualizada(s), ${receipt.unchanged} sem alteração.`);
      await onRefresh().catch(() => setError('A importação foi salva. Recarregue para atualizar a biblioteca.'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível importar.'); await onRefresh().catch(() => {}); }
    finally { setBusy(false); }
  };
  const search = async (event: FormEvent) => {
    event.preventDefault(); if (busy || !query.trim()) return; setBusy(true); setError(''); setSources([]);
    const controller = new AbortController(); searchController.current = controller;
    const requestedQuery = query.trim();
    try { const result = await personalRequest<{ sources: KnowledgeSource[] }>(`knowledge/search?q=${encodeURIComponent(requestedQuery)}`, 'GET', undefined, controller.signal);
      if (controller.signal.aborted) return;
      if (!validKnowledgeSources(result.sources)) throw new Error('Referências inválidas na busca.');
      setSources(result.sources); setResultQuery(requestedQuery);
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível consultar.'); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    if (busy) return; setBusy(true); setError(''); setNotice('');
    try { await personalRequest(`knowledge/${encodeURIComponent(id)}`, 'DELETE', { libraryRevision: revision }); setSelected(undefined); setNote(undefined); if (draft?.id === id) setDraft(undefined); setRemoving(undefined); setNotice('Cópia removida da conta. O arquivo original do Obsidian foi preservado.');
      await onRefresh().catch(() => setError('A cópia foi removida. Recarregue para atualizar a biblioteca.'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível remover.'); await onRefresh().catch(() => {}); }
    finally { setBusy(false); }
  };
  const saveDraft = async () => {
    if (!draft || busy) return; setBusy(true); setError(''); setNotice('');
    try { await personalRequest(`knowledge/${encodeURIComponent(draft.id)}`, 'PUT', { content: draft.content, revision: draft.revision }); setDraft(undefined); setNotice('Nota salva na conta JARVIS. O plugin só grava no cofre quando estiver ativo e com permissão para receber alterações.'); await onRefresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar.'); await onRefresh().catch(() => {}); }
    finally { setBusy(false); }
  };
  const existing = files.filter(file => library.some(note => pathKey(note.path) === pathKey(file.path)));
  const disabled = busy || reading;
  return <div className="knowledge-panel">
    <p className="modal-description">Conecte o cofre pelo plugin do Obsidian ou importe cópias manualmente. Consulte suas notas pelo chat e edite pelo celular, computador ou Xbox. Revise antes de salvar.</p>
    <ObsidianConnection />
    <div className="knowledge-import">
      <label htmlFor="knowledge-files">Selecionar notas Markdown</label><input data-gamepad id="knowledge-files" type="file" accept=".md,text/markdown" multiple disabled={disabled} onChange={event => void pick(event)} />
      <label htmlFor="knowledge-folder">Selecionar pasta de notas (quando o navegador permitir)</label><input data-gamepad ref={folder} id="knowledge-folder" type="file" multiple disabled={disabled} onChange={event => void pick(event)} />
      <small>No celular, use a seleção de arquivos. Até 20 notas e 250 KB por lote; cada nota pode ter até 50 KB. Anexos e pastas ocultas são ignorados.</small>
      {reading && <p role="status">Lendo os arquivos selecionados…</p>}
      {!!files.length && <section aria-label="Revisar importação"><h3>Revisar importação · {files.length} nota(s)</h3><p>O texto será salvo na sua conta. Trechos pertinentes poderão ser enviados ao seu provedor de IA quando você conversar.</p>
        {files.map((file, index) => <div key={index} className="knowledge-draft"><label htmlFor={`knowledge-path-${index}`}>Caminho da nota {index + 1}</label><input data-gamepad id={`knowledge-path-${index}`} maxLength={240} value={file.path} disabled={disabled} onChange={event => setFiles(previous => previous.map((item, position) => position === index ? { ...item, path: event.target.value } : item))} /><small>{library.some(note => pathKey(note.path) === pathKey(file.path)) ? 'Caminho já importado; uma alteração requer autorização abaixo.' : 'Nova cópia na biblioteca.'}</small><details><summary data-gamepad>Prévia do texto: {file.path}</summary><pre className="knowledge-markdown">{file.content.slice(0, 1200)}{file.content.length > 1200 ? '\n… (prévia limitada)' : ''}</pre></details></div>)}
        {!!existing.length && <label className="knowledge-replace"><input data-gamepad type="checkbox" checked={replace} disabled={disabled} onChange={event => setReplace(event.target.checked)} />Atualizar também as cópias com o mesmo caminho</label>}
        <div className="memory-actions"><button data-gamepad className="primary-button" disabled={disabled} onClick={() => void importFiles()}>Confirmar importação</button><button data-gamepad className="secondary-button" disabled={disabled} onClick={() => { setFiles([]); setReplace(false); }}>Descartar seleção</button></div>
      </section>}
    </div>
    <form className="knowledge-search" onSubmit={event => void search(event)}><label htmlFor="knowledge-query">Buscar nas notas importadas</label><input data-gamepad id="knowledge-query" maxLength={500} value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} placeholder="React, inglês, ideias do projeto…" /><button data-gamepad className="secondary-button" disabled={disabled || !query.trim()}>Buscar trechos</button></form>
    {resultQuery && <p role="status">{sources.length ? `Trechos encontrados para “${resultQuery}”.` : `Nenhum trecho encontrado para “${resultQuery}”. Tente o título ou palavras do assunto.`}</p>}
    <KnowledgeSources sources={sources} onOpen={(id, revision) => setSelected({ id, revision })} />
    <p>{library.length.toLocaleString('pt-BR')} de {MAX_KNOWLEDGE_NOTES.toLocaleString('pt-BR')} notas · {(library.reduce((sum, note) => sum + note.bytes, 0) / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} MB de {MAX_LIBRARY_BYTES / 1_000_000} MB</p>
    {!library.length && <p>Nenhuma nota importada ainda.</p>}
    <ul className="knowledge-list">{library.map(note => <li key={note.id}><button data-gamepad className="secondary-button" disabled={disabled} onClick={() => setSelected({ id: note.id, revision: note.revision })}>{note.title}<small>{note.path}</small></button><button data-gamepad className="secondary-button" disabled={disabled} aria-label={`Remover cópia: ${note.title}`} onClick={() => setRemoving(note.id)}>Remover cópia</button>
      {removing === note.id && <div role="group" aria-label={`Confirmar remoção de ${note.title}`}><p>Remover esta cópia da conta? O original do Obsidian permanece no seu aparelho. Respostas antigas podem conter texto desta nota.</p><button data-gamepad className="secondary-button" disabled={disabled} onClick={() => setRemoving(undefined)}>Cancelar remoção</button><button data-gamepad className="primary-button" disabled={disabled} onClick={() => void remove(note.id)}>Confirmar remoção da cópia</button></div>}
    </li>)}</ul>
    {loading && <p role="status">Abrindo nota…</p>}
    {note && <article className="knowledge-note" aria-label={`Nota ${note.title}`}><h3>{note.title}</h3><small>{note.path}</small>{note.revision !== selected?.revision && <p role="status">Esta nota foi atualizada desde a consulta. Abaixo está a cópia atual.</p>}<pre className="knowledge-markdown">{note.content}</pre>{!draft && <button data-gamepad className="secondary-button" disabled={disabled} onClick={() => setDraft({ id: note.id, revision: note.revision, content: note.content, path: note.path })}>Editar nota</button>}</article>}
    {draft && <section aria-label="Editar nota Markdown"><h3>Editar nota · {draft.path}</h3><p>Seu rascunho permanece aqui se a nota mudar em outro aparelho. Compare com a versão atual e descarte o rascunho para reiniciar a edição se houver conflito.</p><label htmlFor="knowledge-edit">Texto Markdown</label><textarea data-gamepad id="knowledge-edit" rows={12} value={draft.content} disabled={disabled} onChange={event => setDraft({ ...draft, content: event.target.value })} /><div className="memory-actions"><button data-gamepad className="primary-button" disabled={disabled || !draft.content.trim()} onClick={() => void saveDraft()}>Salvar nota</button><button data-gamepad className="secondary-button" disabled={disabled} onClick={() => setDraft(undefined)}>Descartar rascunho</button></div></section>}
    <p className="privacy-note">A conexão automática requer o plugin instalado e vinculado no Obsidian. Para cópias importadas manualmente, importe novamente para atualizar. Links e anexos não são baixados; o assistente não escreve notas por conta própria.</p>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="personal-error">{error}</p>}
  </div>;
}
