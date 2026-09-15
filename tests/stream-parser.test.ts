import { describe, expect, it } from 'vitest';
import { SseParser } from '../src/workbuddy/stream-parser.js';

function framesOf(chunks: string[]) {
  const p = new SseParser();
  return chunks.flatMap((c) => p.push(c));
}

describe('SseParser', () => {
  it('parses a complete frame in one chunk', () => {
    const f = framesOf(['data: {"a":1}\n\n']);
    expect(f).toHaveLength(1);
    expect(f[0]).toEqual({ kind: 'data', json: '{"a":1}' });
  });

  it('parses multiple frames in a single chunk', () => {
    const f = framesOf(['data: {"a":1}\n\ndata: {"b":2}\n\n']);
    expect(f).toHaveLength(2);
    expect(f[1]).toEqual({ kind: 'data', json: '{"b":2}' });
  });

  it('reassembles a frame split across network chunks', () => {
    const f = framesOf(['data: {"a"', ':1}\n', '\n']);
    expect(f).toHaveLength(1);
    expect(f[0]).toEqual({ kind: 'data', json: '{"a":1}' });
  });

  it('reassembles a multi-byte UTF-8 char split across chunks', () => {
    // '好' = E5 A5 BD. Split the middle byte across chunks.
    const whole = 'data: {"c":"好"}\n\n';
    const buf = Buffer.from(whole, 'utf8');
    const cut = 11; // inside the 3-byte sequence
    const p = new SseParser();
    const dec = new TextDecoder();
    const fs: unknown[] = [];
    fs.push(...p.push(dec.decode(buf.subarray(0, cut), { stream: true })));
    fs.push(...p.push(dec.decode(buf.subarray(cut), { stream: true })));
    fs.push(...p.flush());
    const data = fs.find((f) => (f as { kind: string }).kind === 'data') as { json: string };
    expect(JSON.parse(data.json)).toEqual({ c: '好' });
  });

  it('detects [DONE] terminal frame', () => {
    const f = framesOf(['data: [DONE]\n\n']);
    expect(f).toEqual([{ kind: 'done' }]);
  });

  it('tolerates CRLF framing', () => {
    const f = framesOf(['data: {"a":1}\r\n\r\n']);
    expect(f).toEqual([{ kind: 'data', json: '{"a":1}' }]);
  });

  it('skips comment lines', () => {
    const f = framesOf([': keep-alive\n\ndata: {"a":1}\n\n']);
    expect(f[0]).toEqual({ kind: 'comment', text: ' keep-alive' });
    expect(f[1]).toEqual({ kind: 'data', json: '{"a":1}' });
  });

  it('joins multi-line data fields per SSE spec', () => {
    const f = framesOf(['data: {"a":\ndata: 1}\n\n']);
    expect(f).toEqual([{ kind: 'data', json: '{"a":\n1}' }]);
  });

  it('flushes a trailing frame at EOF without final blank line', () => {
    const p = new SseParser();
    p.push('data: {"a":1}\n');
    expect(p.flush()).toEqual([{ kind: 'data', json: '{"a":1}' }]);
    expect(p.flush()).toEqual([]);
  });
});
