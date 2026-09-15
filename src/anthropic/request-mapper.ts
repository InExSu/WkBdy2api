import { z } from 'zod';
import {
  DEFAULT_SYSTEM_PROMPT,
  mapThinkingToReasoningEffort,
  reasoningEffortSchema,
  thinkingSchema,
  type UpstreamChatRequest,
} from '../workbuddy/request-mapper.js';

const cacheControl = z.object({ type: z.literal('ephemeral'), ttl: z.enum(['5m', '1h']).optional() }).strict();
const UNDEFINED_SENTINEL = '[undefined]';
const anthropicOptionalKeys = [
  'temperature', 'top_k', 'top_p', 'stop_sequences', 'thinking', 'output_config',
  'system', 'tools', 'tool_choice', 'stream', 'cache_control', 'metadata',
] as const;

export function normalizeAnthropicRequestBody(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const out = { ...(body as Record<string, unknown>) };
  for (const key of anthropicOptionalKeys) if (out[key] === UNDEFINED_SENTINEL) delete out[key];
  if (isRecord(out.output_config) && out.output_config.effort === UNDEFINED_SENTINEL) {
    const outputConfig = { ...out.output_config };
    delete outputConfig.effort;
    out.output_config = outputConfig;
  }
  out.messages = normalizeTextBlockContainers(out.messages);
  out.system = normalizeTextBlockContainers(out.system);
  return out;
}

function normalizeTextBlockContainers(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((entry) => {
    if (!isRecord(entry)) return entry;
    const copy = { ...entry };
    if (Array.isArray(copy.content)) {
      copy.content = copy.content.map((block) => {
        if (!isRecord(block) || block.cache_control !== UNDEFINED_SENTINEL) return block;
        const normalized = { ...block };
        delete normalized.cache_control;
        return normalized;
      });
    } else if (copy.cache_control === UNDEFINED_SENTINEL) {
      delete copy.cache_control;
    }
    return copy;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}


const textBlock = z.object({ type: z.literal('text'), text: z.string(), citations: z.array(z.never()).nullable().optional(), cache_control: cacheControl.optional() }).strict();
const imageBlock = z.object({
  type: z.literal('image'),
  source: z.discriminatedUnion('type', [
    z.object({ type: z.literal('base64'), media_type: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']), data: z.string().min(1).regex(/^[A-Za-z0-9+/\r\n]+={0,2}$/) }).strict(),
    z.object({ type: z.literal('url'), url: z.string().url().refine((url) => ['https:', 'http:'].includes(new URL(url).protocol)) }).strict(),
  ]),
  cache_control: cacheControl.optional(),
}).strict();
const toolUseBlock = z.object({ type: z.literal('tool_use'), id: z.string().min(1), name: z.string().min(1), input: z.record(z.unknown()), caller: z.object({ type: z.literal('direct') }).strict().optional(), cache_control: cacheControl.optional() }).strict();
const toolResultBlock = z.object({
  type: z.literal('tool_result'), tool_use_id: z.string().min(1),
  content: z.union([z.string(), z.array(textBlock)]).optional(),
  is_error: z.boolean().optional(), cache_control: cacheControl.optional(),
}).strict();
const block = z.discriminatedUnion('type', [textBlock, imageBlock, toolUseBlock, toolResultBlock]);
const tool = z.object({
  name: z.string().min(1), description: z.string().optional(),
  input_schema: z.object({ type: z.literal('object') }).passthrough(),
  cache_control: cacheControl.optional(),
}).strict();
export const messagesSchema = z.object({
  model: z.string().min(1), max_tokens: z.number().int().positive(),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.union([z.string(), z.array(block).min(1)]) }).strict()).min(1),
  system: z.union([z.string(), z.array(textBlock)]).optional(),
  stream: z.boolean().default(false),
  temperature: z.number().min(0).max(1).optional(), top_p: z.number().min(0).max(1).optional(),
  tools: z.array(tool).optional(),
  tool_choice: z.discriminatedUnion('type', [
    z.object({ type: z.literal('auto'), disable_parallel_tool_use: z.boolean().optional() }).strict(),
    z.object({ type: z.literal('any'), disable_parallel_tool_use: z.boolean().optional() }).strict(),
    z.object({ type: z.literal('tool'), name: z.string().min(1), disable_parallel_tool_use: z.boolean().optional() }).strict(),
    z.object({ type: z.literal('none') }).strict(),
  ]).optional(),
  // These hints do not request a distinct generation behavior; no cache metrics are claimed.
  cache_control: cacheControl.optional(), metadata: z.object({ user_id: z.string().nullable().optional() }).strict().optional(),
  // Accept Claude and common object-form thinking controls and map them to WorkBuddy's top-level reasoning_effort.
  thinking: thinkingSchema.optional(),
  output_config: z.object({ effort: reasoningEffortSchema.optional() }).strict().optional(),
  context_window: z.number().int().positive().optional(),
  stop_sequences: z.array(z.string()).max(0, 'stop_sequences is not supported by this adapter').optional(),
}).strict();
export type MessagesRequest = z.infer<typeof messagesSchema>;
export class MessagesInputError extends Error {}

type ChatMessage = UpstreamChatRequest['messages'][number] & {
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
};

export function toWorkBuddyMessageRequest(request: MessagesRequest, model: string): UpstreamChatRequest {
  if (request.messages[0]?.role !== 'user') throw new MessagesInputError('The first message must have role user.');
  if (request.messages.at(-1)?.role !== 'user') throw new MessagesInputError('Assistant prefill is not supported.');
  const messages: ChatMessage[] = [{ role: 'system', content: typeof request.system === 'string' ? request.system : request.system?.map((b) => b.text).join('\n\n') ?? DEFAULT_SYSTEM_PROMPT }];
  const knownTools = new Set<string>();
  const pendingTools = new Set<string>();
  const toolNames = new Set(request.tools?.map((t) => t.name));
  if (toolNames.size !== (request.tools?.length ?? 0)) throw new MessagesInputError('Tool names must be unique.');
  if (request.tool_choice && request.tool_choice.type !== 'none' && !toolNames.size) throw new MessagesInputError('tool_choice requires tools.');
  if (request.tool_choice?.type === 'tool' && !toolNames.has(request.tool_choice.name)) throw new MessagesInputError('tool_choice must name a defined tool.');

  for (const message of request.messages) {
    const parts = typeof message.content === 'string' ? [{ type: 'text' as const, text: message.content }] : message.content;
    const results = parts.filter((b) => b.type === 'tool_result');
    if (results.length && message.role !== 'user') throw new MessagesInputError('tool_result belongs in a user message.');
    if (pendingTools.size && (message.role !== 'user' || results.length !== pendingTools.size)) throw new MessagesInputError('Return all pending tool results in the next user message.');
    let sawOther = false;
    for (const part of parts) {
      if (part.type !== 'tool_result') { sawOther = true; continue; }
      if (sawOther) throw new MessagesInputError('tool_result blocks must precede other user content.');
      if (!pendingTools.delete(part.tool_use_id)) throw new MessagesInputError('Unknown or duplicate tool_use_id.');
      const content = typeof part.content === 'string' ? part.content : part.content?.map((b) => b.text).join('\n') ?? '';
      messages.push({ role: 'tool', tool_call_id: part.tool_use_id, content: part.is_error ? `Tool error: ${content}` : content });
    }
    const content: Array<Record<string, unknown>> = [];
    const toolCalls: NonNullable<ChatMessage['tool_calls']> = [];
    for (const part of parts) {
      if (part.type === 'text') content.push({ type: 'text', text: part.text });
      else if (part.type === 'image') {
        if (message.role !== 'user') throw new MessagesInputError('Images are only supported in user messages.');
        const source = part.source;
        content.push({ type: 'image_url', image_url: { url: source.type === 'url' ? source.url : `data:${source.media_type};base64,${source.data.replace(/[\r\n]/g, '')}` } });
      } else if (part.type === 'tool_use') {
        if (message.role !== 'assistant') throw new MessagesInputError('tool_use belongs in an assistant message.');
        if (knownTools.has(part.id)) throw new MessagesInputError('tool_use IDs must be unique.');
        knownTools.add(part.id); pendingTools.add(part.id);
        toolCalls.push({ id: part.id, type: 'function', function: { name: part.name, arguments: JSON.stringify(part.input) } });
      }
    }
    if (content.length || toolCalls.length) {
      messages.push({ role: message.role, content: content.length ? (content.every((b) => b.type === 'text') ? content.map((b) => b.text).join('\n') : content) : null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
    }
  }
  if (pendingTools.size) throw new MessagesInputError('Missing tool_result blocks.');
  return {
    model, messages, stream: true, max_tokens: request.max_tokens,
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.top_p !== undefined ? { top_p: request.top_p } : {}),
    ...(request.context_window !== undefined ? { context_window: request.context_window } : {}),
    ...(request.tools ? { tools: request.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })) } : {}),
    ...(request.tool_choice ? { tool_choice: request.tool_choice.type === 'tool' ? { type: 'function', function: { name: request.tool_choice.name } } : request.tool_choice.type === 'any' ? 'required' : request.tool_choice.type } : {}),
    ...(request.tool_choice && 'disable_parallel_tool_use' in request.tool_choice && request.tool_choice.disable_parallel_tool_use !== undefined ? { parallel_tool_calls: !request.tool_choice.disable_parallel_tool_use } : {}),
    ...(request.thinking
      ? { reasoning_effort: mapThinkingToReasoningEffort(request.thinking, request.output_config?.effort) }
      : request.output_config?.effort !== undefined
        ? { reasoning_effort: request.output_config.effort }
        : {}),
  };
}
