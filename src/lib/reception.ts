import type { PersonalMemory } from '../../shared/contracts';
import { personalProfile } from '../../shared/memory';

export interface ReceptionPreferences { greeting: boolean; autoNews: boolean; readNews: boolean; topic: string }
export const RECEPTION_KEY = 'jarvis.reception.v1';
export function loadReception(): ReceptionPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(RECEPTION_KEY) ?? '{}') as Partial<ReceptionPreferences>;
    return { greeting: value.greeting !== false, autoNews: value.autoNews === true, readNews: value.readNews === true,
      topic: typeof value.topic === 'string' && value.topic.trim() ? value.topic.trim().slice(0, 100) : 'tecnologia e inteligência artificial' };
  } catch { return { greeting: true, autoNews: false, readNews: false, topic: 'tecnologia e inteligência artificial' }; }
}
export function personalGreeting(memories: PersonalMemory[], date: Date) {
  const { name, address } = personalProfile(memories);
  const hour = date.getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  return `${greeting}${address || name ? `, ${address || name}` : ''}. Estou por aqui. Por onde começamos?`;
}
export const newsDay = (date: Date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
