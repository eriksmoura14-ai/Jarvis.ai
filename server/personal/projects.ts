import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ChatRequest, ChatResponse, PersonalSnapshot } from '../../shared/contracts.js';
import { validChange, validProposal, localDay, priorities, type ProjectChange, type ProjectProposal } from '../../shared/projects.js';
import { PersonalError, type PersonalStore } from './store.js';
export class ProjectProposals {
  private key = randomBytes(32);
  private signature(data: Omit<ProjectProposal, 'token'>) { return createHmac('sha256', this.key).update(JSON.stringify(data)).digest('hex'); }
  create(change: ProjectChange, snapshot: PersonalSnapshot): ProjectProposal {
    const data = { id: randomUUID(), change, projectsRevision: snapshot.projectsRevision ?? 0, generation: snapshot.generation, expiresAt: new Date(Date.now() + 600_000).toISOString() };
    return { ...data, token: this.signature(data) };
  }
  verify(value: unknown): ProjectProposal {
    if (!validProposal(value)) throw new PersonalError('Proposta inválida. Peça um novo plano.', 400);
    const data = { id: value.id, change: value.change, projectsRevision: value.projectsRevision, generation: value.generation, expiresAt: value.expiresAt };
    if (!timingSafeEqual(Buffer.from(value.token, 'hex'), Buffer.from(this.signature(data), 'hex'))) throw new PersonalError('A proposta mudou ou o servidor reiniciou. Peça um novo plano.', 400);
    if (Date.parse(value.expiresAt) <= Date.now()) throw new PersonalError('A proposta expirou. Peça um novo plano.', 409);
    return value;
  }
}
export function registerProjectRoutes(app: FastifyInstance, store: PersonalStore, proposals: ProjectProposals) {
  app.post<{ Body: { change: ProjectChange; projectsRevision: number } }>('/api/personal/projects/change', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', additionalProperties: false, required: ['change', 'projectsRevision'], properties: { change: { type: 'object' }, projectsRevision: { type: 'integer', minimum: 0 } } } },
  }, async request => {
    if (!validChange(request.body.change)) throw new PersonalError('Confira os campos do projeto, as tarefas e as datas.', 400);
    return store.applyProjectChange(request.body.change, request.body.projectsRevision);
  });
  app.post<{ Body: { proposal: ProjectProposal } }>('/api/personal/projects/confirm', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', additionalProperties: false, required: ['proposal'], properties: { proposal: { type: 'object' } } } },
  }, async request => {
    const proposal = proposals.verify(request.body.proposal);
    return store.applyProjectChange(proposal.change, proposal.projectsRevision, { id: proposal.id, generation: proposal.generation });
  });
}
export function projectCommand(request: ChatRequest, snapshot: PersonalSnapshot, modelAvailable = false): Omit<ChatResponse, 'id' | 'createdAt'> | undefined {
  const text = request.message.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/^jarvis[,.:!]?\s+/, '').replace(/[.!?]+$/, '');
  const projects = snapshot.projects ?? [];
  // Priorities can live in the vault or profile, beyond registered tasks.
  // Keep explicit task listings deterministic; let a connected model interpret
  // a broader priorities question using all available personal context.
  if (modelAvailable && /^quais (?:sao )?(?:as )?minhas prioridades(?: hoje)?$/.test(text)) return;
  if (/^(?:projetos|meus projetos|listar projetos)$/.test(text)) return { provider: 'local', command: 'conversation', message: projects.length
    ? 'Seus projetos:\n' + projects.map(project => `• ${project.title}: ${project.tasks.filter(task => task.status === 'done').length}/${project.tasks.length} tarefas concluídas${project.archived ? ' (arquivado)' : ''}.`).join('\n')
    : 'Você ainda não tem projetos. Abra “Projetos e tarefas” para criar um ou peça “crie um projeto para estudar inglês”.' };
  if (/^(?:tarefas|minhas tarefas|pendencias|minhas pendencias|o que (?:eu )?tenho (?:para|pra) fazer(?: hoje)?|quais (?:sao )?(?:as )?minhas prioridades(?: hoje)?)$/.test(text)) {
    const list = priorities(projects, localDay(new Date(), request.timeZone));
    return { provider: 'local', command: 'conversation', message: list.length ? 'Suas próximas tarefas:\n' + list.slice(0, 10).map(({ task, project, when }) => `• ${task.title} — ${project.title} (${when}).`).join('\n') + (list.length > 10 ? '\nVeja as demais em Projetos e tarefas.' : '') : 'Você não tem tarefas pendentes em projetos ativos.' };
  }
}
