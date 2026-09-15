import { describe, expect, it, vi } from 'vitest';
import { WorkBuddyClient } from '../src/workbuddy/client.js';

const body = { model: 'default-model', messages: [{ role: 'system', content: 'Test' }], stream: true as const };
const account = (token: string) => ({ accessToken: token, userId: token + '-user', domain: 'www.workbuddy.ai' });

describe('request-local credential selection', () => {
  it('attributes concurrent failures to their own account, not the last global token', async () => {
    let resolveFirst!: (response: Response) => void;
    let calls = 0;
    const reportFailure = vi.fn();
    const getCredential = vi.fn().mockResolvedValueOnce(account('first')).mockResolvedValueOnce(account('second'));
    const client = new WorkBuddyClient({
      credentials: { getCredential, reportFailure, invalidate: vi.fn(), describe: () => 'mock' },
      upstreamUrl: 'https://mock.invalid/chat', userAgent: 'test/1',
      fetchFn: (async () => ++calls === 1
        ? new Promise<Response>((resolve) => { resolveFirst = resolve; })
        : new Response(JSON.stringify({ code: 403 }), { status: 403 })) as typeof fetch,
    });
    const first = client.streamChatCompletion(body, new AbortController().signal, false);
    const firstResult = expect(first).rejects.toMatchObject({ status: 401 });
    await vi.waitFor(() => expect(calls).toBe(1));
    await expect(client.streamChatCompletion(body, new AbortController().signal, false)).rejects.toMatchObject({ status: 403 });
    resolveFirst(new Response(JSON.stringify({ code: 401 }), { status: 401 }));
    await firstResult;
    expect(reportFailure.mock.calls).toEqual([['second'], ['first']]);
  });

  it('refreshes the selected credential once on 401 without selecting another account', async () => {
    const getCredential = vi.fn(async () => account('first'));
    const refreshRejectedCredential = vi.fn(async () => account('first-refreshed'));
    const fetchFn = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('data: [DONE]\n\n', { status: 200 }));
    const client = new WorkBuddyClient({
      credentials: { getCredential, refreshRejectedCredential, invalidate: vi.fn(), describe: () => 'mock' },
      upstreamUrl: 'https://mock.invalid/chat', userAgent: 'test/1', fetchFn,
    });
    const result = await client.streamChatCompletion(body, new AbortController().signal);
    for await (const _chunk of result) { /* drain */ }
    expect(getCredential).toHaveBeenCalledTimes(1);
    expect(refreshRejectedCredential).toHaveBeenCalledWith(account('first'));
    expect(fetchFn.mock.calls[1]?.[1].headers.Authorization).toBe('Bearer first-refreshed');
  });
});
