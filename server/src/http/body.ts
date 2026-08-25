/**
 * Reads the request body, or returns `null` if it exceeds `maxBytes`.
 *
 * `Content-Length` is the fast path and is deliberately not trusted as the
 * only one: it is absent from a chunked request and can simply be wrong, so
 * the stream is counted as it arrives and abandoned the moment it crosses the
 * cap. That is what makes this a cap rather than a request to be polite.
 */
export async function readCappedBody(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;

  const stream = request.body;
  if (stream === null) return '';

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
}
