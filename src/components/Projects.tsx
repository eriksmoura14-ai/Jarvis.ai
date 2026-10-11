import { useState, type FormEvent } from 'react';
import type { PersonalSnapshot } from '../../shared/contracts';
import { priorities, localDay, MAX_PLAN_TASKS, type ProjectChange, type ProjectProposal } from '../../shared/projects';
import { personalRequest } from '../lib/personal';

export function Projects({ snapshot, onRefresh }: { snapshot: PersonalSnapshot; onRefresh: () => Promise<void> }) {
  const [title, setTitle] = useState(''); const [description, setDescription] = useState(''); const [steps, setSteps] = useState('');
  const [target, setTarget] = useState<string>(); const [taskTitle, setTaskTitle] = useState(''); const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const projects = snapshot.projects ?? [];
  const act = async (change: ProjectChange) => {
    if (busy) return false; setBusy(true); setError(''); setNotice('');
    try { await personalRequest('projects/change', 'POST', { change, projectsRevision: snapshot.projectsRevision ?? 0 }); await onRefresh(); setNotice('Projetos atualizados na sua conta.'); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar.'); await onRefresh().catch(() => {}); return false; }
    finally { setBusy(false); }
  };
  const create = (event: FormEvent) => {
    event.preventDefault(); const tasks = steps.split('\n').map(line => line.trim()).filter(Boolean).map(title => ({ title }));
    if (tasks.length > MAX_PLAN_TASKS || tasks.some(task => task.title.length > 150)) { setError('Use até vinte etapas, com 150 caracteres por linha.'); return; }
    void act({ action: 'create_project', title: title.trim(), description: description.trim(), tasks }).then(saved => { if (saved) { setTitle(''); setDescription(''); setSteps(''); } });
  };
  return <div className="projects-panel">
    <p className="modal-description">Seus objetivos, etapas e progresso aparecem nos aparelhos conectados à conta. Você também pode pedir ao JARVIS um plano e revisar a proposta antes de salvar.</p>
    <form aria-label="Criar projeto" onSubmit={create}>
      <label htmlFor="project-title">Nome do projeto</label><input data-gamepad id="project-title" required maxLength={100} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} placeholder="Estudar inglês" />
      <label htmlFor="project-description">Objetivo do projeto</label><textarea data-gamepad id="project-description" maxLength={1000} value={description} disabled={busy} onChange={event => setDescription(event.target.value)} placeholder="O que você quer alcançar?" />
      <label htmlFor="project-steps">Etapas iniciais (uma por linha)</label><textarea data-gamepad id="project-steps" maxLength={3020} value={steps} disabled={busy} onChange={event => setSteps(event.target.value)} placeholder="Estudar vocabulário\nPraticar conversação" />
      <button data-gamepad className="primary-button" disabled={busy || !title.trim() || projects.length >= 20}>Criar projeto</button>
    </form>
    {!projects.length && <p>Nenhum projeto salvo ainda.</p>}
    {projects.map(project => { const done = project.tasks.filter(task => task.status === 'done').length; return <article className="project-card" key={project.id} aria-label={`Projeto ${project.title}`}>
      <h3>{project.title}{project.archived && <small> · Arquivado</small>}</h3><p>{project.description}</p>
      <p className="project-progress">{done} de {project.tasks.length} tarefas concluídas</p>
      <progress max={Math.max(1, project.tasks.length)} value={done} aria-label={`Progresso de ${project.title}`} />
      <ul>{project.tasks.map(task => <li key={task.id}><span className={task.status === 'done' ? 'task-done' : ''}>{task.title}{task.dueDate && <small>Prazo: {task.dueDate.split('-').reverse().join('/')}</small>}</span>
        <button data-gamepad className="secondary-button" disabled={busy || project.archived} aria-label={`${task.status === 'done' ? 'Reabrir' : 'Concluir'} tarefa: ${task.title}`} onClick={() => void act({ action: task.status === 'done' ? 'reopen_task' : 'complete_task', projectId: project.id, taskId: task.id })}>{task.status === 'done' ? 'Reabrir' : 'Concluir'}</button></li>)}</ul>
      {!project.archived && <button data-gamepad className="secondary-button" disabled={busy} onClick={() => { setTarget(target === project.id ? undefined : project.id); setTaskTitle(''); setDueDate(''); }}>Adicionar tarefa em {project.title}</button>}
      {target === project.id && !project.archived && <form aria-label={`Adicionar tarefa em ${project.title}`} onSubmit={event => { event.preventDefault(); void act({ action: 'add_tasks', projectId: project.id, tasks: [{ title: taskTitle.trim(), ...(dueDate ? { dueDate } : {}) }] }).then(saved => { if (saved) { setTarget(undefined); setTaskTitle(''); setDueDate(''); } }); }}>
        <label htmlFor="task-title">Nome da tarefa</label><input data-gamepad id="task-title" required maxLength={150} value={taskTitle} disabled={busy} onChange={event => setTaskTitle(event.target.value)} />
        <label htmlFor="task-date">Prazo da tarefa (opcional)</label><input data-gamepad id="task-date" type="date" value={dueDate} disabled={busy} onChange={event => setDueDate(event.target.value)} />
        <button data-gamepad className="primary-button" disabled={busy || !taskTitle.trim()}>Salvar tarefa</button>
      </form>}
      <button data-gamepad className="secondary-button" disabled={busy} onClick={() => void act({ action: project.archived ? 'restore_project' : 'archive_project', projectId: project.id })}>{project.archived ? 'Restaurar' : 'Arquivar'} projeto: {project.title}</button>
    </article>; })}
    <p className="privacy-note">Arquivar preserva o projeto e remove suas tarefas das prioridades. Não há notificações em segundo plano nesta etapa. Limites: vinte projetos e duzentas tarefas na conta.</p>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="personal-error">{error}</p>}
  </div>;
}

export function ProjectPriorities({ snapshot, now, onOpen }: { snapshot: PersonalSnapshot; now: Date; onOpen: () => void }) {
  const day = localDay(now, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const next = priorities(snapshot.projects ?? [], day);
  return <section className="project-priorities" aria-label="Suas prioridades">
    <button data-gamepad className="secondary-button" onClick={onOpen}>Projetos e tarefas</button>
    {next.length ? <><p>Próximas tarefas · {next.length} pendente{next.length === 1 ? '' : 's'}</p><ul>{next.slice(0, 3).map(({ project, task, when }) => <li key={task.id}><strong>{task.title}</strong><small>{project.title} · {when}</small></li>)}</ul></> : <p>{snapshot.projects?.length ? 'Nenhuma tarefa pendente nos projetos ativos.' : 'Crie seu primeiro projeto ou peça ao JARVIS um plano.'}</p>}
  </section>;
}

export function ProposalReview({ proposal, snapshot, busy, onConfirm, onDismiss }: { proposal: ProjectProposal; snapshot: PersonalSnapshot; busy: boolean; onConfirm: () => Promise<void>; onDismiss: () => void }) {
  const change = proposal.change;
  const project = change.action === 'create_project' ? undefined : snapshot.projects?.find(project => project.id === change.projectId);
  const task = change.action === 'complete_task' || change.action === 'reopen_task' ? project?.tasks.find(task => task.id === change.taskId) : undefined;
  const stale = (snapshot.projectsRevision ?? 0) !== proposal.projectsRevision || snapshot.generation !== proposal.generation || Date.parse(proposal.expiresAt) <= Date.now();
  return <section className="project-proposal" aria-label="Revisar proposta do JARVIS">
    <h3>Proposta para revisar</h3>
    <p>{change.action === 'create_project' ? `Criar projeto: ${change.title}` : change.action === 'add_tasks' ? `Adicionar tarefas em ${project?.title ?? 'projeto'}` : `Concluir tarefa: ${task?.title ?? 'tarefa'}`}</p>
    {change.action === 'create_project' && <p>{change.description}</p>}
    {'tasks' in change && <ol>{change.tasks.map((task, index) => <li key={index}>{task.title}{task.dueDate && <small>Prazo: {task.dueDate.split('-').reverse().join('/')}</small>}</li>)}</ol>}
    <p>{stale ? 'Seus dados mudaram ou a proposta expirou. Peça uma nova proposta.' : 'Nada foi salvo. Confira as etapas e os prazos. A proposta expira em dez minutos.'}</p>
    <div className="memory-actions"><button data-gamepad className="primary-button" disabled={busy || stale} onClick={() => void onConfirm()}>Confirmar proposta</button><button data-gamepad className="secondary-button" disabled={busy} onClick={onDismiss}>Descartar proposta</button></div>
  </section>;
}
