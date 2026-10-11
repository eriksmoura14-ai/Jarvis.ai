export const MAX_PROJECTS = 20;
export const MAX_TASKS = 200;
export const MAX_PLAN_TASKS = 20;
export interface TaskDraft { title: string; dueDate?: string }
export interface ProjectTask extends TaskDraft { id: string; status: 'pending' | 'done'; createdAt: string; completedAt?: string }
export interface PersonalProject { id: string; title: string; description: string; archived: boolean; createdAt: string; updatedAt: string; tasks: ProjectTask[] }
export type ProjectChange = { action: 'create_project'; title: string; description: string; tasks: TaskDraft[] }
  | { action: 'add_tasks'; projectId: string; tasks: TaskDraft[] }
  | { action: 'complete_task' | 'reopen_task'; projectId: string; taskId: string }
  | { action: 'archive_project' | 'restore_project'; projectId: string };
export interface ProjectProposal { id: string; change: ProjectChange; projectsRevision: number; generation: number; expiresAt: string; token: string }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const only = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const text = (value: unknown, max: number) => typeof value === 'string' && !!value.trim() && value.length <= max && !/[\u0000-\u001f]/.test(value);
export const validDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export const validTasks = (value: unknown): value is TaskDraft[] => Array.isArray(value) && value.length <= MAX_PLAN_TASKS && value.every(task => object(task)
  && only(task, ['title', 'dueDate']) && text(task.title, 150) && (task.dueDate === undefined || validDate(task.dueDate)));
export function validChange(value: unknown): value is ProjectChange {
  if (!object(value)) return false;
  if (value.action === 'create_project') return only(value, ['action', 'title', 'description', 'tasks']) && text(value.title, 100)
    && typeof value.description === 'string' && value.description.length <= 1000 && validTasks(value.tasks);
  if (value.action === 'add_tasks') return only(value, ['action', 'projectId', 'tasks']) && text(value.projectId, 36) && validTasks(value.tasks) && value.tasks.length > 0;
  if (['complete_task', 'reopen_task'].includes(String(value.action))) return only(value, ['action', 'projectId', 'taskId']) && text(value.projectId, 36) && text(value.taskId, 36);
  return ['archive_project', 'restore_project'].includes(String(value.action)) && only(value, ['action', 'projectId']) && text(value.projectId, 36);
}
export function validProposal(value: unknown): value is ProjectProposal {
  return object(value) && only(value, ['id', 'change', 'projectsRevision', 'generation', 'expiresAt', 'token']) && validChange(value.change) && text(value.id, 36) && Number.isSafeInteger(value.projectsRevision) && Number(value.projectsRevision) >= 0
    && Number.isSafeInteger(value.generation) && Number(value.generation) >= 0 && typeof value.expiresAt === 'string' && Number.isFinite(Date.parse(value.expiresAt))
    && typeof value.token === 'string' && /^[a-f0-9]{64}$/.test(value.token);
}
export function validProjects(value: unknown): value is PersonalProject[] {
  return Array.isArray(value) && value.length <= MAX_PROJECTS && value.every(project => object(project) && text(project.id, 36) && text(project.title, 100)
    && typeof project.description === 'string' && project.description.length <= 1000 && typeof project.archived === 'boolean'
    && typeof project.createdAt === 'string' && Number.isFinite(Date.parse(project.createdAt)) && typeof project.updatedAt === 'string' && Number.isFinite(Date.parse(project.updatedAt))
    && Array.isArray(project.tasks) && project.tasks.length <= MAX_TASKS && project.tasks.every(task => object(task) && text(task.id, 36) && text(task.title, 150)
      && ['pending', 'done'].includes(String(task.status)) && typeof task.createdAt === 'string' && Number.isFinite(Date.parse(task.createdAt))
      && (task.dueDate === undefined || validDate(task.dueDate)) && (task.completedAt === undefined || typeof task.completedAt === 'string' && Number.isFinite(Date.parse(task.completedAt)))))
    && value.reduce((count, project) => count + project.tasks.length, 0) <= MAX_TASKS;
}
export function localDay(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function priorities(projects: PersonalProject[], day: string) {
  return projects.filter(project => !project.archived).flatMap(project => project.tasks.filter(task => task.status === 'pending').map(task => ({ project, task })))
    .sort((a, b) => (a.task.dueDate ?? '9999').localeCompare(b.task.dueDate ?? '9999') || a.task.createdAt.localeCompare(b.task.createdAt))
    .map(item => ({ ...item, when: item.task.dueDate ? item.task.dueDate < day ? 'Atrasada' : item.task.dueDate === day ? 'Hoje' : `Prazo: ${item.task.dueDate.split('-').reverse().join('/')}` : 'Sem prazo' }));
}
