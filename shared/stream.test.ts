import { describe, expect, it } from 'vitest';
import { streamLines } from './stream.js';

const consume = async (body: ReadableStream<Uint8Array>, signal?: AbortSignal) => {
  const lines: string[] = []; for await (const line of streamLines(body, signal)) lines.push(line); return lines;
};
describe('leitura limitada de streams', () => {
  it('preserva Unicode entre bytes, CRLF e a última linha sem quebra', async () => {
    const bytes = new TextEncoder().encode('Olá\r\n🌎\nfinal');
    expect(await consume(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } }))).toEqual(['Olá', '🌎', 'final']);
  });
  it('limita linhas sem fim e bytes totais, cancelando o produtor', async () => {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(128_001))); }, cancel() { canceled = true; } });
    await expect(consume(body)).rejects.toThrow('line exceeds'); expect(canceled).toBe(true);
    const many = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(('x\n').repeat(500_001))); } });
    await expect(consume(many)).rejects.toThrow('exceeds limit');
  });
  it('cancelar durante a espera libera o leitor sem aceitar um fim falso', async () => {
    let cancel = () => {}; let canceled = false;
    const ready = new Promise<void>(resolve => { cancel = resolve; });
    const body = new ReadableStream<Uint8Array>({ pull() { cancel(); }, cancel() { canceled = true; } });
    const controller = new AbortController(); const pending = consume(body, controller.signal);
    await ready; controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(canceled).toBe(true);
  });
});
