import { mkdir, writeFile } from 'node:fs/promises';
import { ModelProvider, readAIConfig } from '../server/providers/model.ts';
import { modelCases } from '../server/quality/model-cases.ts';

const folder = 'artifacts/quality';
await mkdir(folder, { recursive: true });
if (!process.argv.includes('--live')) {
  console.log('Nenhuma chamada executada. Para avaliar o modelo real: npm run evaluate:model -- --live. Use somente credenciais nas variáveis do backend.');
  process.exit(0);
}
if (!process.env.GROQ_API_KEY || !process.env.AI_MODEL || process.env.AI_PROVIDER !== 'groq') {
  const blocked = { mode: 'live-model-probe', status: 'blocked', inferenceCalls: 0, reason: 'Configure GROQ_API_KEY, AI_PROVIDER=groq e AI_MODEL no ambiente seguro. Não envie valores no chat.' };
  await writeFile(folder + '/model-live.json', JSON.stringify(blocked, null, 2));
  console.log(JSON.stringify(blocked)); process.exit(2);
}
let calls = 0; let lastCall = 0; let stopped = false;
const usage = { promptTokens: 0, completionTokens: 0 };
const transport = async (url, options) => {
  if (stopped || calls >= 6) throw new Error('Evaluation budget reached.');
  if (url !== 'https://api.groq.com/openai/v1/chat/completions') throw new Error('Unexpected destination.');
  const delay = Math.max(0, 11_000 - (Date.now() - lastCall));
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  lastCall = Date.now(); calls++;
  const response = await fetch(url, options);
  if (!response.ok) { stopped = true; return response; }
  try {
    const data = await response.clone().json();
    usage.promptTokens += Number(data.usage?.prompt_tokens ?? 0);
    usage.completionTokens += Number(data.usage?.completion_tokens ?? 0);
  } catch { /* Safe provider parsing remains the application's responsibility. */ }
  return response;
};
const provider = new ModelProvider(readAIConfig(process.env), transport, 30_000);
const results = [];
for (const test of modelCases) {
  if (stopped) break;
  const started = Date.now();
  try {
    // Actual model code; no mocked inference, tools, retries or voice calls.
    const response = await provider.respond(test.input, undefined, undefined, test.research);
    const checks = [...test.required.map(pattern => ({ pattern: pattern.source, passed: pattern.test(response.message) })), ...test.forbidden.map(pattern => ({ forbidden: pattern.source, passed: !pattern.test(response.message) }))];
    results.push({ id: test.id, response: response.message, provider: response.provider, checks, passed: checks.every(check => check.passed), elapsedMs: Date.now() - started });
  } catch (error) {
    results.push({ id: test.id, passed: false, error: error.name === 'ModelError' ? error.message : 'Avaliação interrompida. Confira a conectividade segura do ambiente.', elapsedMs: Date.now() - started });
    stopped = true; // No quota/network-error retry loop.
  }
  console.log(JSON.stringify({ id: test.id, passed: results.at(-1).passed, inferenceCalls: calls }));
}
const report = { mode: 'live-model-probe', status: stopped ? 'interrupted' : 'completed', model: provider.config.model, inferenceCalls: calls, usage, fixtureSources: true, manualReviewRequired: true, expectedCases: modelCases.length, completedCases: results.length, results };
await writeFile(folder + '/model-live.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ status: report.status, completedCases: results.length, passedChecks: results.filter(result => result.passed).length, inferenceCalls: calls, manualReviewRequired: true }));
process.exitCode = !stopped && results.length === modelCases.length && results.every(result => result.passed) ? 0 : 1;
