import type { ChatRequest, ChatResponse, PersonalSnapshot } from '../../shared/contracts.js';
import { dailyPlanningQuestion, normalizeQuestion } from '../../shared/dialogue.js';
import { personalProfile } from '../../shared/memory.js';
import type { KnowledgeNote, KnowledgeSource } from '../../shared/knowledge.js';
import { localDay, priorities, MAX_PROJECTS, MAX_TASKS, type ProjectChange } from '../../shared/projects.js';
import { markdownBody } from './knowledge-index.js';

type Candidate = { title: string; note: KnowledgeNote; heading: string; excerpt: string; suggested: boolean };
const clean = (text: string) => text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_all, target: string, alias?: string) => alias ?? target)
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
const cells = (line: string) => /^\s*\|.*\|\s*$/.test(line) ? line.trim().slice(1, -1).split('|').map(clean) : [];
const goalScope = (text: string) => /\b(?:metas pessoais|objetivos pessoais|minhas metas|meus objetivos|metas registradas|metas e cronograma)\b/.test(normalizeQuestion(text));

// Read actual pending checkboxes and explicit personal goal tables. Ordinary
// prose, completed rows and code samples are not an instruction to make tasks.
function candidates(notes: KnowledgeNote[], excluded: Set<string>) {
  const result: Candidate[] = []; const seen = new Set(excluded);
  const add = (candidate: Candidate) => {
    const key = normalizeQuestion(candidate.title);
    if (!key || seen.has(key) || candidate.title.length > 150 || /[\u0000-\u001f]/.test(candidate.title)) return;
    // Only three will be suggested; keep bounded candidates of each kind even
    // when a large vault contains thousands of checkboxes or table rows.
    if (result.filter(item => item.suggested === candidate.suggested).length >= 20) return;
    seen.add(key); result.push(candidate);
  };
  for (const note of [...notes].sort((a, b) => a.path.localeCompare(b.path, 'pt-BR'))) {
    const lines = markdownBody(note.content).split('\n'); let heading = ''; let fenced = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(?:```|~~~)/.test(line)) { fenced = !fenced; continue; }
      if (fenced) continue;
      const section = line.match(/^#{1,6}\s+(.+)/)?.[1];
      if (section) { heading = clean(section).slice(0, 150); continue; }
      const scope = note.title + ' ' + note.path + ' ' + heading;
      const task = line.match(/^\s*[-*]\s+\[ \]\s+(.+)$/)?.[1];
      if (task && /\b(?:projetos|metas|objetivos|planejamento|tarefas|pendencias|rotina|prioridades)\b/.test(normalizeQuestion(scope)))
        add({ title: clean(task), note, heading, excerpt: line.trim().slice(0, 1200), suggested: false });
      if (!goalScope(scope)) continue;
      const columns = cells(line).map(normalizeQuestion); const separator = cells(lines[i + 1] ?? '');
      const goal = columns.findIndex(column => /^(?:meta|objetivo)$/.test(column));
      if (goal < 0 || columns.length !== separator.length || !separator.every(cell => /^:?-{3,}:?$/.test(cell))) continue;
      const status = columns.findIndex(column => /^(?:situacao|status|estado)\b/.test(column));
      for (let j = i + 2; j < lines.length; j++) {
        const row = cells(lines[j]); if (row.length !== columns.length) break;
        if (!row[goal] || /^(?:[-—–]+|a definir|nenhum|nenhuma|n\/?a|tbd)$/.test(normalizeQuestion(row[goal]))
          || status >= 0 && /^(?:concluid[oa]|realizad[oa]|atingid[oa]|finalizad[oa]|cancelad[oa])\b/.test(normalizeQuestion(row[status]))) continue;
        // A proposed next step is labelled as a suggestion; the recorded goal
        // is never presented as completed, due today or confirmed by the owner.
        const title = `Definir o próximo passo para: ${row[goal]}`;
        const excerpt = [line, lines[i + 1], lines[j]].join('\n');
        if (excerpt.length <= 1200) add({ title, note, heading, excerpt, suggested: true });
      }
    }
  }
  return result.sort((a, b) => Number(a.suggested) - Number(b.suggested));
}

export function dailyPlan(request: ChatRequest, snapshot: PersonalSnapshot, notes: KnowledgeNote[], now = new Date()): {
  reply: Omit<ChatResponse, 'id' | 'createdAt'> & { projectChange?: ProjectChange }; sources: KnowledgeSource[];
} | undefined {
  if (!dailyPlanningQuestion(request.message)) return;
  const projects = snapshot.projects ?? [];
  const day = localDay(now, request.timeZone);
  const pending = priorities(projects, day).slice(0, 3);
  const excluded = new Set(projects.flatMap(project => project.tasks.map(task => normalizeQuestion(task.title))));
  const fromNotes = candidates(notes, excluded).slice(0, 3 - pending.length);
  const sources: KnowledgeSource[] = fromNotes.map((item, index) => ({ reference: `N${index + 1}`, id: item.note.id, revision: item.note.revision,
    title: item.note.title, path: item.note.path, heading: item.heading, excerpt: item.excerpt }));
  const address = personalProfile(snapshot.memories).address;
  const parts = pending.map(({ task, project, when }) => `“${task.title}”, do projeto “${project.title}” (${when.toLowerCase()})`)
    .concat(fromNotes.map((item, index) => `“${item.title}”${item.suggested ? ', como sugestão baseada na meta registrada' : ', que está pendente na nota'} [N${index + 1}]`));
  let message = parts.length ? `${address ? address + ', eu' : 'Eu'} começaria por ${parts[0]}.`
    + (parts[1] ? ` Em seguida, cuidaria de ${parts[1]}.` : '') + (parts[2] ? ` Por fim, reservaria espaço para ${parts[2]}.` : '')
    : 'Não encontrei tarefas pendentes nem próximos passos em checklists ou tabelas de metas pessoais das notas. Qual objetivo você quer priorizar hoje?';
  if (pending.length) message += '\n\nUsei os prazos registrados para ordenar as tarefas, sem presumir que já foram concluídas.';
  if (fromNotes.length) message += '\n\nOs passos das notas são sugestões para hoje, sem prazo novo. Confira se ainda fazem sentido para você.';
  if (parts.length && parts.length < 3) message += ' Prefere incluir mais alguma prioridade para completar o dia?';
  const target = projects.find(project => !project.archived && normalizeQuestion(project.title) === 'plano diario');
  const tasks = fromNotes.map(item => ({ title: item.title }));
  let projectChange: ProjectChange | undefined;
  if (tasks.length && projects.reduce((count, project) => count + project.tasks.length, 0) + tasks.length <= MAX_TASKS
    && (target || projects.length < MAX_PROJECTS)) {
    projectChange = target ? { action: 'add_tasks', projectId: target.id, tasks }
      : { action: 'create_project', title: 'Plano diário', description: 'Próximos passos sugeridos a partir das notas pessoais, revisados antes de salvar. Sem prazos inventados.', tasks };
    message += '\n\nDeixei os passos novos numa proposta para você revisar e salvar. As tarefas já registradas continuam nos seus projetos.';
  } else if (tasks.length) message += '\n\nA conta atingiu o limite de projetos ou tarefas; não preparei novas tarefas para salvar.';
  return { reply: { provider: 'local', command: sources.length ? 'knowledge' : 'conversation', message, ...(projectChange ? { projectChange } : {}) }, sources };
}
