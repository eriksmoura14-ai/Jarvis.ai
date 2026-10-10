// Both provider and browser streams are bounded, including a peer that never sends a newline.
export async function* streamLines(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = ''; let bytes = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const part = await reader.read();
      signal?.throwIfAborted();
      if (part.done) { pending += decoder.decode(); break; }
      bytes += part.value.byteLength;
      if (bytes > 1_000_000) throw new Error('Stream exceeds limit');
      pending += decoder.decode(part.value, { stream: true });
      let boundary: number;
      while ((boundary = pending.indexOf('\n')) >= 0) {
        if (boundary > 128_000) throw new Error('Stream line exceeds limit');
        yield pending.slice(0, boundary).replace(/\r$/, '');
        pending = pending.slice(boundary + 1);
      }
      if (pending.length > 128_000) throw new Error('Stream line exceeds limit');
    }
    if (pending) yield pending.replace(/\r$/, '');
  } finally {
    signal?.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
