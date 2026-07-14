/**
 * Minimal Server-Sent-Events reader: parse a Fetch `ReadableStream` body into the
 * JSON object carried by each `data:` line. Shared by the providers (model token
 * streaming) and the client (event streaming). Web-standard streams only.
 */
export async function* sseJSON(body: ReadableStream<Uint8Array>): AsyncIterable<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith("data:")) continue;
      const payload = l.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        yield JSON.parse(payload);
      } catch {
        // keep-alive / non-JSON line - ignore
      }
    }
  }
}
