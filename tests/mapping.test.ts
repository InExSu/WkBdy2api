import { describe, expect, it } from 'vitest';
import {
  chatRequestSchema,
  toUpstreamRequest,
  normalizeMessages,
  DEFAULT_SYSTEM_PROMPT,
  mapThinkingToReasoningEffort,
  normalizeOpenAiRequestBody,
} from '../src/workbuddy/request-mapper.js';
import { CompletionAggregator, toOpenAiChunk } from '../src/openai/response-builder.js';
import type { UpstreamChunk } from '../src/workbuddy/client.js';

describe('request-mapper', () => {
  it('forces stream:true (upstream rejects stream:false)', () => {
    const req = chatRequestSchema.parse({
      model: 'default-model',
      messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }],
      stream: false,
    });
    const out = toUpstreamRequest(req);
    expect(out.stream).toBe(true);
  });

  it('injects a default system message when messages[0] is not system', () => {
    const req = chatRequestSchema.parse({
      model: 'default-model',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const out = toUpstreamRequest(req);
    expect(out.messages[0]).toEqual({ role: 'system', content: DEFAULT_SYSTEM_PROMPT });
    expect(out.messages[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('keeps an existing system message first', () => {
    const req = chatRequestSchema.parse({
      model: 'default-model',
      messages: [{ role: 'system', content: 'custom' }, { role: 'user', content: 'hi' }],
    });
    const out = toUpstreamRequest(req);
    expect(out.messages).toHaveLength(2);
    expect(out.messages[0]).toEqual({ role: 'system', content: 'custom' });
  });

  it('maps developer role to system', () => {
    const msgs = chatRequestSchema.parse({
      model: 'default-model',
      messages: [{ role: 'developer', content: 'd' }, { role: 'user', content: 'u' }],
    }).messages;
    const out = normalizeMessages(msgs);
    expect(out[0]!.role).toBe('system');
  });

  it('maps max_completion_tokens into upstream max_tokens', () => {
    const req = chatRequestSchema.parse({
      model: 'default-model',
      messages: [{ role: 'user', content: 'hi' }],
      max_completion_tokens: 123,
    });
    expect(toUpstreamRequest(req).max_tokens).toBe(123);
  });

  it('passes tools and tool_choice through unchanged', () => {
    const tools = [
      {
        type: 'function' as const,
        function: { name: 'get_weather', description: 'w', parameters: { type: 'object' } },
      },
    ];
    const req = chatRequestSchema.parse({
      model: 'default-model',
      messages: [{ role: 'user', content: 'hi' }],
      tools,
      tool_choice: 'auto',
    });
    const out = toUpstreamRequest(req);
    expect(out.tools).toEqual(tools);
    expect(out.tool_choice).toBe('auto');
  });

  it('maps common thinking forms to upstream reasoning_effort', () => {
    expect(mapThinkingToReasoningEffort('minimal')).toBe('minimal');
    expect(mapThinkingToReasoningEffort({ effort: 'max' })).toBe('max');
    expect(mapThinkingToReasoningEffort({ type: 'disabled' })).toBe('none');
    expect(mapThinkingToReasoningEffort({ type: 'adaptive' })).toBe('high');
    expect(mapThinkingToReasoningEffort({ type: 'enabled', budget_tokens: 1024 })).toBe('low');
    expect(mapThinkingToReasoningEffort({ type: 'enabled', budget_tokens: 2048 })).toBe('medium');
    expect(mapThinkingToReasoningEffort({ type: 'enabled', budget_tokens: 8192 })).toBe('high');
    expect(mapThinkingToReasoningEffort({ type: 'enabled', budget_tokens: 32768 })).toBe('xhigh');
  });

  it('accepts enabled thinking without a budget and inherits reasoning_effort', () => {
    const req = chatRequestSchema.parse({
      model: 'default-model',
      messages: [{ role: 'user', content: 'hi' }],
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
    });
    expect(toUpstreamRequest(req).reasoning_effort).toBe('high');
  });

  it('keeps the literal undefined sentinel out of optional OpenAI fields only', () => {
    const body = normalizeOpenAiRequestBody({
      model: 'default-model',
      temperature: '[undefined]',
      messages: [{ role: 'user', content: '[undefined]' }],
    }) as Record<string, unknown>;
    expect(body.temperature).toBeUndefined();
    expect((body.messages as Array<Record<string, unknown>>)[0]?.content).toBe('[undefined]');
  });

  it('rejects empty messages', () => {
    expect(chatRequestSchema.safeParse({ model: 'm', messages: [] }).success).toBe(false);
  });
});

describe('response-builder', () => {
  const meta = { id: 'chatcmpl-x', created: 123, model: 'default-model' };

  it('converts upstream finish_reason "" to null in chunks', () => {
    const chunk = fakeChunk({ content: 'O', finish: '' });
    const out = toOpenAiChunk(chunk, meta)!;
    expect(out.choices[0]!.finish_reason).toBeNull();
    expect(out.choices[0]!.delta).toEqual({ content: 'O' });
  });

  it('filters shell fields (refusal/function_call/extra_fields never appear)', () => {
    const chunk = fakeChunk({ content: 'O', finish: 'stop' });
    const out = toOpenAiChunk(chunk, meta)!;
    expect(JSON.stringify(out)).not.toContain('refusal');
    expect(JSON.stringify(out)).not.toContain('function_call');
    expect(JSON.stringify(out)).not.toContain('extra_fields');
    expect(out.choices[0]!.finish_reason).toBe('stop');
  });

  it('passes reasoning_content through when non-empty, drops it when empty', () => {
    const r = toOpenAiChunk(fakeChunk({ content: '', reasoning: 'think', finish: '' }), meta)!;
    expect(r.choices[0]!.delta).toEqual({ reasoning_content: 'think' });
    const none = toOpenAiChunk(fakeChunk({ content: 'x', reasoning: '', finish: '' }), meta)!;
    expect(none.choices[0]!.delta).not.toHaveProperty('reasoning_content');
  });

  it('emits a role-only first chunk', () => {
    const out = toOpenAiChunk(fakeChunk({ content: '', role: 'assistant', finish: '' }), meta)!;
    expect(out.choices[0]!.delta).toEqual({ role: 'assistant' });
  });

  it('returns null for fully-empty shells', () => {
    expect(toOpenAiChunk(fakeChunk({ content: '', finish: '' }), meta)).toBeNull();
  });

  it('aggregates non-stream completion: content, tool_calls, usage, finish', () => {
    const agg = new CompletionAggregator();
    agg.push(fakeChunk({ role: 'assistant', finish: '' }));
    agg.push(fakeChunk({ content: 'I', finish: '' }));
    agg.push(fakeChunk({ content: "'ll", finish: '' }));
    agg.push(
      fakeChunk({
        toolCall: { index: 0, id: 'call_00_X', name: 'get_weather', args: '' },
        finish: '',
      }),
    );
    agg.push(
      fakeChunk({ toolCall: { index: 0, name: '', args: '{"city":"Tokyo"}' }, finish: '' }),
    );
    agg.push(
      fakeChunk({
        finish: 'tool_calls',
        usage: { prompt_tokens: 291, completion_tokens: 47, total_tokens: 338 },
      }),
    );
    const out = agg.build('default-model');
    expect(out.object).toBe('chat.completion');
    expect(out.choices[0]!.message.content).toBe("I'll");
    expect(out.choices[0]!.message.tool_calls).toEqual([
      {
        id: 'call_00_X',
        type: 'function',
        function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' },
        index: 0,
      },
    ]);
    expect(out.choices[0]!.finish_reason).toBe('tool_calls');
    expect(out.usage).toEqual({ prompt_tokens: 291, completion_tokens: 47, total_tokens: 338 });
    expect(out.id).toMatch(/^chatcmpl-/);
  });

  it('throws when stream produced nothing', () => {
    const agg = new CompletionAggregator();
    expect(() => agg.build('m')).toThrow(/without producing/);
  });

  it('falls back to finish stop when upstream never sent finish_reason', () => {
    const agg = new CompletionAggregator();
    agg.push(fakeChunk({ content: 'hi', finish: '' }));
    expect(agg.build('m').choices[0]!.finish_reason).toBe('stop');
  });
});

function fakeChunk(input: {
  content?: string;
  role?: string;
  reasoning?: string;
  finish?: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  toolCall?: { index?: number; id?: string; name?: string; args?: string };
}): UpstreamChunk {
  return {
    delta: {
      ...(input.role ? { role: input.role } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.reasoning !== undefined ? { reasoning_content: input.reasoning } : {}),
      ...(input.toolCall
        ? {
            tool_calls: [
              {
                ...(input.toolCall.id ? { id: input.toolCall.id } : {}),
                function: { name: input.toolCall.name ?? '', arguments: input.toolCall.args ?? '' },
                ...(input.toolCall.index !== undefined ? { index: input.toolCall.index } : {}),
              },
            ],
          }
        : {}),
    },
    finish_reason: input.finish && input.finish !== '' ? input.finish : null,
    usage: input.usage ?? null,
  };
}
