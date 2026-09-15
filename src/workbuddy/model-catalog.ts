import { z } from 'zod';

const reasoningEffortSchema = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

const reasoningSchema = z.object({
  canDisableThinking: z.boolean().optional(),
  defaultEffort: reasoningEffortSchema.optional(),
  effort: reasoningEffortSchema.optional(),
  summary: z.string().optional(),
  supportedEfforts: z.array(reasoningEffortSchema).optional(),
});

const contextWindowSchema = z.object({
  defaultLength: z.number().int().positive(),
  supportedLengths: z.array(z.number().int().positive()).min(1),
});

const modelSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  descriptionEn: z.string().optional(),
  descriptionZh: z.string().optional(),
  credits: z.string().optional(),
  isDefault: z.boolean().optional(),
  maxInputTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  maxAllowedSize: z.number().optional(),
  supportsImages: z.boolean().optional(),
  supportsToolCall: z.boolean().optional(),
  supportsReasoning: z.boolean().optional(),
  onlyReasoning: z.boolean().optional(),
  reasoning: reasoningSchema.optional(),
  contextWindow: contextWindowSchema.optional(),
  temperature: z.number().optional(),
  vendor: z.string().optional(),
});

const agentSchema = z.object({
  name: z.string(),
  models: z.array(z.string()),
  modelTags: z.array(z.string()).optional(),
});

export const productConfigSchema = z.object({
  data: z.object({
    models: z.array(modelSchema).min(1),
    agents: z.array(agentSchema).min(1),
    endpoint: z.string().optional(),
  }),
});

export type WbModel = z.infer<typeof modelSchema>;
export type ProductConfig = z.infer<typeof productConfigSchema>;

export class ConfigParseError extends Error {}

/** Parse and validate the WorkBuddy /v3/config payload. */
export function parseProductConfig(raw: unknown): ProductConfig {
  const parsed = productConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigParseError(
      `invalid product config: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  const seen = new Set<string>();
  for (const m of parsed.data.data.models) {
    if (seen.has(m.id)) throw new ConfigParseError(`duplicate model id: ${m.id}`);
    seen.add(m.id);
  }
  return parsed.data;
}

export type ExposedModel = {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  /** WorkBuddy-specific metadata, namespaced so standard clients ignore it. */
  x_workbuddy: {
    name?: string;
    description?: string;
    is_default: boolean;
    max_input_tokens?: number;
    max_output_tokens?: number;
    supports_images?: boolean;
    supports_tool_call?: boolean;
    supports_reasoning?: boolean;
    only_reasoning?: boolean;
    reasoning?: WbModel['reasoning'];
    context_window?: WbModel['contextWindow'];
    credits?: string;
    temperature?: number;
  };
};

/**
 * Build the externally visible catalog: the intersection of configured models
 * and the CLI agent whitelist (first agent named 'cli'). Config order is kept;
 * the default model is surfaced first as a convenience.
 */
export function buildCatalog(config: ProductConfig, agentName = 'cli'): ExposedModel[] {
  const agent = config.data.agents.find((a) => a.name === agentName);
  if (!agent) throw new ConfigParseError(`agent '${agentName}' not found in config`);
  const whitelist = new Set(agent.models);
  const byId = new Map(config.data.models.map((m) => [m.id, m]));
  const exposed: ExposedModel[] = [];
  const seen = new Set<string>();
  for (const id of agent.models) {
    const m = byId.get(id);
    if (!m) continue;
    seen.add(id);
    exposed.push(toExposed(m));
  }
  // configured models outside the whitelist are intentionally not exposed
  void [...config.data.models].filter((m) => !seen.has(m.id));
  return exposed;
}

function toExposed(m: WbModel): ExposedModel {
  return {
    id: m.id,
    object: 'model',
    created: 0,
    owned_by: 'workbuddy',
    x_workbuddy: {
      name: m.name,
      description: m.descriptionEn ?? m.descriptionZh,
      is_default: m.isDefault ?? false,
      max_input_tokens: m.maxInputTokens,
      max_output_tokens: m.maxOutputTokens,
      supports_images: m.supportsImages,
      supports_tool_call: m.supportsToolCall,
      supports_reasoning: m.supportsReasoning,
      only_reasoning: m.onlyReasoning,
      reasoning: m.reasoning,
      context_window: m.contextWindow,
      credits: m.credits,
      temperature: m.temperature,
    },
  };
}
