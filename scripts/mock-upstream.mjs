// Mock upstream recorder for T4 prompt-mutation capture.
// Logs every request (headers minus auth + raw body) to /captured/<ts>-<n>.json and returns a
// minimal valid OpenAI chat-completions response (SSE when the request asks for stream:true).
// Node stdlib only — no deps. Runs in node:22-alpine (see docker-compose upstream-recorder).
import http from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';

const PORT = 8089;
const OUT = '/captured';
try { mkdirSync(OUT, { recursive: true }); } catch {}
let n = 0;

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    n += 1;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const headers = { ...req.headers };
    delete headers['authorization'];
    delete headers['x-api-key'];
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch {}
    const record = { seq: n, time: stamp, method: req.method, url: req.url, headers, rawBody: raw, jsonBody: parsed };
    try { writeFileSync(`${OUT}/${stamp}-${String(n).padStart(3, '0')}.json`, JSON.stringify(record, null, 2)); } catch (e) { console.error('write failed', e); }

    const wantsStream = !!(parsed && parsed.stream);
    if (wantsStream) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const id = 'chatcmpl-mock';
      const created = 0; // deterministic (no wall clock in body)
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: 'mock', choices: [{ index: 0, delta: { role: 'assistant', content: 'MOCK_OK' }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: 'mock', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      const payload = {
        id: 'chatcmpl-mock', object: 'chat.completion', created: 0, model: 'mock',
        choices: [{ index: 0, message: { role: 'assistant', content: 'MOCK_OK' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 2, total_tokens: 2 },
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    }
    console.log(`recorded #${n} ${req.method} ${req.url} (${raw.length} bytes, stream=${wantsStream})`);
  });
});

server.listen(PORT, () => console.log(`mock-upstream recorder on :${PORT}, writing to ${OUT}`));
