/**
 * In-memory request metrics for the admin panel. Not a time-series DB:
 * bounded ring buffers + per-model/per-status counters. Resets on restart,
 * which is fine for an ops dashboard of a local gateway.
 */

export type RequestLogEntry = {
  time: number;
  method: string;
  path: string;
  status: number;
  model?: string;
  stream: boolean;
  duration_ms: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  error_code?: string;
};

const MAX_LOG = 200;

export class MetricsCollector {
  private requests: RequestLogEntry[] = [];
  private totalRequests = 0;
  private totalErrors = 0;
  private totalTokens = { prompt: 0, completion: 0 };
  private startedAt = Date.now();

  /** Per-model counters keyed by model id. */
  private perModel = new Map<string, { count: number; tokens: number }>();

  record(entry: Omit<RequestLogEntry, 'time'>): void {
    this.totalRequests += 1;
    if (entry.status >= 400) this.totalErrors += 1;
    if (entry.prompt_tokens) this.totalTokens.prompt += entry.prompt_tokens;
    if (entry.completion_tokens) this.totalTokens.completion += entry.completion_tokens;
    if (entry.model) {
      const agg = this.perModel.get(entry.model) ?? { count: 0, tokens: 0 };
      agg.count += 1;
      agg.tokens += (entry.prompt_tokens ?? 0) + (entry.completion_tokens ?? 0);
      this.perModel.set(entry.model, agg);
    }
    this.requests.push({ ...entry, time: Date.now() });
    if (this.requests.length > MAX_LOG) this.requests.shift();
  }

  snapshot(): {
    started_at: number;
    uptime_ms: number;
    total_requests: number;
    total_errors: number;
    error_rate: number;
    tokens: { prompt: number; completion: number };
    per_model: Array<{ model: string; count: number; tokens: number }>;
    recent: RequestLogEntry[];
    p95_ms: number | null;
  } {
    const durations = this.requests.map((r) => r.duration_ms).sort((a, b) => a - b);
    const p95: number | null =
      durations.length >= 1 ? (durations[Math.max(0, Math.floor(durations.length * 0.95) - 1)] ?? null) : null;
    return {
      started_at: this.startedAt,
      uptime_ms: Date.now() - this.startedAt,
      total_requests: this.totalRequests,
      total_errors: this.totalErrors,
      error_rate: this.totalRequests === 0 ? 0 : this.totalErrors / this.totalRequests,
      tokens: { ...this.totalTokens },
      per_model: [...this.perModel.entries()]
        .map(([model, agg]) => ({ model, ...agg }))
        .sort((a, b) => b.count - a.count),
      recent: [...this.requests].reverse(),
      p95_ms: p95,
    };
  }
}

export function createMetrics(): MetricsCollector {
  return new MetricsCollector();
}
