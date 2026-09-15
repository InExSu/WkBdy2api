import { describe, expect, it } from 'vitest';
import { redact } from '../src/security/redact.js';

describe('redact', () => {
  it('redacts sensitive keys case-insensitively at any depth', () => {
    const input = {
      authorization: 'Bearer eyJreal',
      AUTHORIZATION: 'Bearer eyJreal',
      nested: { accessToken: 'abc', safe: 'ok' },
      arr: [{ api_key: 'k' }, { token: 't' }],
    };
    const out = redact(input) as any;
    expect(out.authorization).toBe('[REDACTED]');
    expect(out.AUTHORIZATION).toBe('[REDACTED]');
    expect(out.nested.accessToken).toBe('[REDACTED]');
    expect(out.nested.safe).toBe('ok');
    expect(out.arr[0].api_key).toBe('[REDACTED]');
    expect(out.arr[1].token).toBe('[REDACTED]');
  });

  it('redacts x-user-id and cookie', () => {
    const out = redact({ 'x-user-id': 'u1', Cookie: 'c' }) as any;
    expect(out['x-user-id']).toBe('[REDACTED]');
    expect(out.Cookie).toBe('[REDACTED]');
  });

  it('handles cycles without crashing', () => {
    const a: any = { name: 'x' };
    a.self = a;
    const out = redact(a) as any;
    expect(out.self).toBe('[CYCLE]');
  });

  it('passes through primitives and non-sensitive fields', () => {
    expect(redact('plain')).toBe('plain');
    expect(redact(42)).toBe(42);
    expect(redact({ model: 'fast-model' })).toEqual({ model: 'fast-model' });
  });
});
