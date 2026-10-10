import type { PersonalMemory } from './contracts.js';

export type MemorySlot = 'name' | 'address';
const NAME = /^(?:meu nome [ée]|me chamo)\s+([^\n]{1,80})$/i;
const ADDRESS = /^(?:me chame de|prefiro ser chamad[oa] de|quero ser chamad[oa] de)\s+([^\n]{1,80})$/i;

export function memorySlot(content: string): MemorySlot | undefined {
  if (NAME.test(content.trim())) return 'name';
  if (ADDRESS.test(content.trim())) return 'address';
}

export function personalProfile(memories: PersonalMemory[]) {
  let name = ''; let address = '';
  // Legacy documents may already have duplicates: the latest explicit value wins.
  for (const memory of memories) {
    const content = memory.content.trim();
    const named = content.match(NAME); const addressed = content.match(ADDRESS);
    if (named) name = named[1].replace(/[.!]+$/g, '').trim();
    if (addressed) address = addressed[1].replace(/[.!]+$/g, '').trim();
  }
  return { name, address };
}

export function sameMemory(first: string, second: string) {
  return first.trim().normalize('NFC').toLocaleLowerCase('pt-BR') === second.trim().normalize('NFC').toLocaleLowerCase('pt-BR');
}
