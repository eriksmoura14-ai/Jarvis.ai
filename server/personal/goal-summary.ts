import { normalizeKnowledge, type KnowledgeSource } from '../../shared/knowledge.js';

// This is an extractive alternative to a blanket refusal, not an inference of
// goals from unrelated notes. Only broad overview requests and explicit tables
// qualify; priorities, dates and achievements are never guessed.
export function recordedGoalsFallback(question: string, answer: string, sources: KnowledgeSource[]): string | undefined {
  const refusal = normalizeKnowledge(answer).trim();
  if (answer.length > 600 || /\[N\d+\]|\b(?:mas|porem|contudo)\b/i.test(refusal)
    || !/^nao (?:tenho|possuo|encontrei|ha)\b/.test(refusal) || !/\b(?:detalhes|informacoes|dados|objetivos|metas)\b/.test(refusal)) return;
  return recordedGoalsAnswer(question, sources);
}

// An explicit overview of recorded goals is an extraction task. Resolve it
// before inference so a model cannot deny existing evidence or spend quota.
export function recordedGoalsAnswer(question: string, sources: KnowledgeSource[]): string | undefined {
  const query = normalizeKnowledge(question).trim().replace(/^(?:oi[,!]?\s+)?jarvis[,.:!]?\s+/, '').replace(/[.!?]+$/, '').replace(/\s+/g, ' ').trim();
  if (!/^(?:(?:quais(?: sao| seriam)?|liste|listar|mostre|resuma|me (?:diga|lembre|mostre)) )?(?:(?:os|as) )?(?:meus|minhas) (?:(?:futuros|futuras|atuais) )?(?:objetivos|metas|planos)(?: (?:futuros|futuras|atuais|para o futuro))?$/.test(query)) return;
  // Extracting rows alone cannot reconcile a later correction. Send both
  // passages to the model instead of presenting an obsolete status as current.
  if (sources.some(source => /\b(?:atualizacao|correcao|retificacao)\b/.test(normalizeKnowledge(source.heading))
    && /\b(?:superad[ao]|substituid[ao]|corrigid[ao]|retificad[ao])\b/.test(normalizeKnowledge(source.excerpt)))) return;
  const rows: string[] = []; const seen = new Set<string>(); let budget = 3800;
  const cells = (line: string) => line.trim().startsWith('|') && line.trim().endsWith('|')
    ? line.trim().slice(1, -1).split('|').map(cell => cell.trim()) : [];
  const header = (cell: string) => normalizeKnowledge(cell).replace(/[*_`]/g, '').trim();
  for (const source of sources) {
    // A table about public/organizational goals is not evidence of personal
    // goals merely because it happens to be stored inside the owner's vault.
    const scope = normalizeKnowledge(source.title + ' ' + source.heading);
    if (!/\b(?:metas pessoais|objetivos pessoais|minhas metas|meus objetivos|metas registradas|metas e cronograma)\b/.test(scope)) continue;
    const lines = source.excerpt.split('\n'); let fenced = false;
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^\s*(?:```|~~~)/.test(lines[i])) { fenced = !fenced; continue; }
      if (fenced) continue;
      const columns = cells(lines[i]).map(header); const separator = cells(lines[i + 1]);
      const goal = columns.findIndex(cell => /^(?:meta|objetivo)$/.test(cell));
      if (goal < 0 || separator.length !== columns.length || !separator.every(cell => /^:?-{3,}:?$/.test(cell))) continue;
      const horizon = columns.findIndex(cell => /^(?:horizonte|prazo|data)\b/.test(cell));
      const status = columns.findIndex(cell => /^(?:situacao|status|estado)\b/.test(cell));
      for (let j = i + 2; j < lines.length; j++) {
        const row = cells(lines[j]);
        // An excerpt may end halfway through a row: do not fabricate its status.
        if (row.length !== columns.length) break;
        if (row.every(cell => /^:?-{3,}:?$/.test(cell)) || row.every((cell, column) => header(cell) === columns[column])) break;
        if (!row[goal] || /^(?:[-—–]+|a definir|nenhum|nenhuma|n\/?a|tbd)$/.test(header(row[goal]))
          || (status >= 0 && /^(?:concluido|concluida|realizado|realizada|atingido|atingida|finalizado|finalizada|cancelado|cancelada)[.!]?$/.test(header(row[status])))) continue;
        const details = row[goal] + (horizon >= 0 && row[horizon] ? ` — Horizonte registrado: ${row[horizon]}` : '')
          + (status >= 0 && row[status] ? `. Situação registrada: ${row[status]}` : '');
        if (seen.has(details)) continue;
        const entry = `• ${details} [${source.reference}]`;
        if (entry.length > budget || rows.length >= 10) continue;
        rows.push(entry); seen.add(details); budget -= entry.length + 2;
      }
    }
  }
  if (!rows.length) return;
  return 'Nos trechos disponíveis das suas notas, há estas metas registradas:\n\n' + rows.join('\n\n')
    + '\n\nEsta é uma leitura dos registros disponíveis, não uma confirmação de que essas metas já foram realizadas nem uma lista completa de todos os seus objetivos.';
}
