import { mkdir, writeFile } from 'node:fs/promises';
import { routingCases } from '../server/quality/routing-cases.ts';
import { resolveConversation } from '../server/conversation.ts';
import { automaticSearchQuery } from '../shared/search.ts';

const results = routingCases.map(test => {
  const resolution = resolveConversation(test.context ?? [], test.message, test.fromKnowledge);
  const query = resolution.clarification ? undefined : resolution.publicQuery ?? (!resolution.privateOnly ? automaticSearchQuery(test.message) : undefined);
  const actual = { search: !!query?.trim(), clarification: !!resolution.clarification, personal: resolution.privateOnly, subject: resolution.subject ?? '' };
  const errors = Object.entries(test.expected).flatMap(([key, expected]) => key === 'subject'
    ? actual.subject.toLowerCase().includes(expected) ? [] : ['lost_subject']
    : actual[key] === expected ? [] : [key]);
  return { id: test.id, passed: !errors.length, actual, errors };
});
const report = { mode: 'routing-regression-without-model', inferenceCalls: 0, total: results.length, passed: results.filter(result => result.passed).length, results };
await mkdir('artifacts/quality', { recursive: true });
const label = process.argv[2] ?? 'routing';
if (!/^[a-z-]+$/.test(label)) throw new Error('Use um nome simples para o relatório.');
await writeFile(`artifacts/quality/${label}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ mode: report.mode, passed: report.passed, total: report.total, inferenceCalls: 0, failures: results.filter(result => !result.passed).map(result => result.id) }));
process.exitCode = report.passed === report.total ? 0 : 1;
