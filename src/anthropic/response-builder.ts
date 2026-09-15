import { randomBytes } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { UpstreamProtocolError, type UpstreamChunk } from '../workbuddy/client.js';

type Block = Anthropic.TextBlock | Anthropic.ToolUseBlock;
type ToolState = { id: string; name: string; args: string; blockIndex?: number };

export class MessagesResponseBuilder {
  private readonly id = 'msg_' + randomBytes(12).toString('hex');
  private blocks: Block[] = [];
  private tools = new Map<number, ToolState>();
  private textIndex?: number;
  private finished = false;
  private started = false;
  private reason: Anthropic.StopReason | null = null;
  private tokens?: { input_tokens: number; output_tokens: number };

  constructor(private readonly model: string) {}

  start(): Anthropic.RawMessageStreamEvent {
    this.started = true;
    return { type: 'message_start', message: this.message([], null) };
  }

  push(chunk: UpstreamChunk): Anthropic.RawMessageStreamEvent[] {
    if (this.finished) throw new UpstreamProtocolError('Unexpected data after message completion.');
    const events: Anthropic.RawMessageStreamEvent[] = [];
    if (!this.started) events.push(this.start());
    if (chunk.usage) {
      const { prompt_tokens: input, completion_tokens: output } = chunk.usage;
      if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input! < 0 || output! < 0) throw new UpstreamProtocolError('Upstream token usage is invalid.');
      this.tokens = { input_tokens: input!, output_tokens: output! };
    }
    if (chunk.delta.content) {
      if (this.reason) throw new UpstreamProtocolError('Content arrived after a stop reason.');
      if (this.textIndex === undefined) {
        this.textIndex = this.blocks.length;
        const block: Anthropic.TextBlock = { type: 'text', text: '', citations: null };
        this.blocks.push(block);
        events.push({ type: 'content_block_start', index: this.textIndex, content_block: { ...block } });
      }
      const block = this.blocks[this.textIndex] as Anthropic.TextBlock;
      block.text += chunk.delta.content;
      events.push({ type: 'content_block_delta', index: this.textIndex, delta: { type: 'text_delta', text: chunk.delta.content } });
    }
    for (const incoming of chunk.delta.tool_calls ?? []) {
      const index = incoming.index ?? 0;
      if (!Number.isSafeInteger(index) || index < 0 || index > 1024) throw new UpstreamProtocolError('Invalid upstream tool index.');
      if (!incoming.id && !incoming.function?.name && !incoming.function?.arguments) continue;
      const tool = this.tools.get(index) ?? { id: '', name: '', args: '' };
      if (incoming.id) {
        if (tool.id && tool.id !== incoming.id) throw new UpstreamProtocolError('Upstream tool ID changed mid-stream.');
        tool.id = incoming.id;
      }
      if (incoming.function?.name) {
        if (tool.blockIndex !== undefined && incoming.function.name !== tool.name) throw new UpstreamProtocolError('Upstream tool name changed mid-stream.');
        if (tool.blockIndex === undefined) tool.name += incoming.function.name;
      }
      const delta = incoming.function?.arguments ?? '';
      tool.args += delta;
      this.tools.set(index, tool);
      // Start once metadata is known and arguments arrive; never invent IDs or signatures.
      if (tool.blockIndex === undefined && tool.id && tool.name && delta) {
        tool.blockIndex = this.blocks.length;
        const block: Anthropic.ToolUseBlock = { type: 'tool_use', id: tool.id, name: tool.name, input: {}, caller: { type: 'direct' } };
        this.blocks.push(block);
        events.push({ type: 'content_block_start', index: tool.blockIndex, content_block: { ...block } });
        events.push({ type: 'content_block_delta', index: tool.blockIndex, delta: { type: 'input_json_delta', partial_json: tool.args } });
      } else if (tool.blockIndex !== undefined && delta) {
        events.push({ type: 'content_block_delta', index: tool.blockIndex, delta: { type: 'input_json_delta', partial_json: delta } });
      }
    }
    if (chunk.finish_reason) {
      switch (chunk.finish_reason) {
        case 'stop': this.reason = 'end_turn'; break;
        case 'length': this.reason = 'max_tokens'; break;
        case 'tool_calls': this.reason = 'tool_use'; break;
        case 'content_filter': this.reason = 'refusal'; break;
        default: throw new UpstreamProtocolError('Unsupported upstream stop reason.');
      }
    }
    return events;
  }

  finish(): Anthropic.RawMessageStreamEvent[] {
    if (this.finished || !this.reason) throw new UpstreamProtocolError('Upstream stream ended without a valid stop reason.');
    if (!this.tokens) throw new UpstreamProtocolError('Upstream stream did not provide token usage.');
    if (this.reason === 'tool_use' && !this.tools.size) throw new UpstreamProtocolError('Upstream tool response is empty.');
    const events: Anthropic.RawMessageStreamEvent[] = [];
    const ids = new Set<string>();
    for (const tool of this.tools.values()) {
      if (!tool.id || !tool.name || ids.has(tool.id)) throw new UpstreamProtocolError('Upstream tool metadata is incomplete or duplicated.');
      ids.add(tool.id);
      let input: unknown;
      try { input = JSON.parse(tool.args || '{}'); } catch { throw new UpstreamProtocolError('Upstream tool arguments are not valid JSON.'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new UpstreamProtocolError('Upstream tool input is not an object.');
      if (tool.blockIndex === undefined) {
        tool.blockIndex = this.blocks.length;
        const block: Anthropic.ToolUseBlock = { type: 'tool_use', id: tool.id, name: tool.name, input: {}, caller: { type: 'direct' } };
        this.blocks.push(block);
        events.push({ type: 'content_block_start', index: tool.blockIndex, content_block: { ...block } });
        events.push({ type: 'content_block_delta', index: tool.blockIndex, delta: { type: 'input_json_delta', partial_json: tool.args || '{}' } });
      }
      (this.blocks[tool.blockIndex] as Anthropic.ToolUseBlock).input = input;
    }
    for (let index = 0; index < this.blocks.length; index++) events.push({ type: 'content_block_stop', index });
    events.push({ type: 'message_delta', delta: { stop_reason: this.reason, stop_sequence: null, stop_details: null, container: null }, usage: { ...this.tokens, cache_creation_input_tokens: null, cache_read_input_tokens: null, output_tokens_details: null, server_tool_use: null } });
    events.push({ type: 'message_stop' });
    this.finished = true;
    return events;
  }

  build(): Anthropic.Message {
    if (!this.finished) throw new UpstreamProtocolError('Message aggregation is incomplete.');
    return this.message(this.blocks, this.reason);
  }

  get usage(): { input_tokens: number; output_tokens: number } | undefined { return this.tokens; }

  private message(content: Block[], stop: Anthropic.StopReason | null): Anthropic.Message {
    return {
      id: this.id, type: 'message', role: 'assistant', model: this.model, content,
      stop_reason: stop, stop_sequence: null, stop_details: null, container: null,
      usage: { input_tokens: this.tokens?.input_tokens ?? 0, output_tokens: this.tokens?.output_tokens ?? 0,
        cache_creation_input_tokens: null, cache_read_input_tokens: null, cache_creation: null,
        inference_geo: null, output_tokens_details: null, server_tool_use: null, service_tier: null },
    };
  }
}
