import { readFile } from 'node:fs/promises';
import { z } from 'zod';

/**
 * Credential file schema (CodeBuddyExtension auth store). Only the fields the
 * gateway needs are declared; everything else is ignored. The file is read
 * read-only and never written.
 */
const credentialFileSchema = z.object({
  auth: z.object({
    accessToken: z.string().min(1),
    tokenType: z.string().default('Bearer'),
    domain: z.string().optional(),
  }),
  account: z.object({
    uid: z.string().min(1),
  }),
});

export type WorkBuddyCredential = {
  /** Bearer token for upstream Authorization header. Never logged. */
  accessToken: string;
  /** X-User-Id header value. Never logged. */
  userId: string;
  domain: string;
  /** OAuth metadata: memory-only, never included in panel responses or logs. */
  oauthOrigin?: string;
  tokenType?: 'Bearer';
  refreshToken?: string;
  expiresAt?: number;
  refreshExpiresAt?: number;
};

export class CredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialError';
  }
}

export type CredentialSource =
  /** Token provided directly (e.g. WKB2API_UPSTREAM_TOKEN). */
  | { kind: 'env'; token: string; userId: string; domain: string }
  /** Token file (e.g. WKB2API_UPSTREAM_TOKEN_FILE) containing the raw token. */
  | { kind: 'token-file'; path: string; userId: string; domain: string }
  /** CodeBuddy auth store (default on Windows). */
  | { kind: 'auth-store'; path: string };

/**
 * Resolves upstream credentials. Priority: runtime override (set from the
 * admin panel, live) > env token > token file > auth store. The auth store is
 * re-read on demand so upstream 401s can pick up a re-login without
 * restarting the gateway. Values stay in memory only — the runtime override
 * is NOT persisted to disk (a gateway restart falls back to the auth store
 * or env/file sources).
 */
export class CredentialProvider {
  private runtimeOverride?: WorkBuddyCredential;

  constructor(private source: CredentialSource) {}

  static fromEnv(env: NodeJS.ProcessEnv): CredentialProvider {
    const domain = env.WKB2API_UPSTREAM_DOMAIN ?? 'www.workbuddy.ai';
    if (env.WKB2API_UPSTREAM_TOKEN) {
      if (!env.WKB2API_UPSTREAM_USER_ID) {
        throw new CredentialError(
          'WKB2API_UPSTREAM_TOKEN is set but WKB2API_UPSTREAM_USER_ID is missing; both are required for env-based credentials.',
        );
      }
      return new CredentialProvider({
        kind: 'env',
        token: env.WKB2API_UPSTREAM_TOKEN,
        userId: env.WKB2API_UPSTREAM_USER_ID,
        domain,
      });
    }
    if (env.WKB2API_UPSTREAM_TOKEN_FILE) {
      if (!env.WKB2API_UPSTREAM_USER_ID) {
        throw new CredentialError(
          'WKB2API_UPSTREAM_TOKEN_FILE is set but WKB2API_UPSTREAM_USER_ID is missing; both are required for token-file credentials.',
        );
      }
      return new CredentialProvider({
        kind: 'token-file',
        path: env.WKB2API_UPSTREAM_TOKEN_FILE,
        userId: env.WKB2API_UPSTREAM_USER_ID,
        domain,
      });
    }
    const storePath =
      env.WKB2API_CREDENTIALS_PATH ??
      authStoreDefaultPath();
    return new CredentialProvider({ kind: 'auth-store', path: storePath });
  }

  describe(): string {
    if (this.runtimeOverride) return 'admin panel login (runtime override)';
    switch (this.source.kind) {
      case 'env':
        return 'env (WKB2API_UPSTREAM_TOKEN)';
      case 'token-file':
        return 'token file (WKB2API_UPSTREAM_TOKEN_FILE)';
      case 'auth-store':
        return 'workbuddy auth store';
    }
  }

  /** Live-switch credentials from the admin panel. No restart, no disk write. */
  setRuntimeOverride(cred: WorkBuddyCredential): void {
    this.runtimeOverride = { ...cred, accessToken: stripBearer(cred.accessToken) };
    this.cached = undefined;
  }

  /** Drop the panel-set override, falling back to env/file/auth-store. */
  clearRuntimeOverride(): void {
    this.runtimeOverride = undefined;
    this.cached = undefined;
  }

  /** Force re-read on the next get. */
  invalidate(): void {
    this.cached = undefined;
  }

  private cached?: WorkBuddyCredential;

  async getCredential(): Promise<WorkBuddyCredential> {
    if (this.runtimeOverride) return this.runtimeOverride;
    if (this.cached) return this.cached;
    const cred =
      this.source.kind === 'env'
        ? await this.readEnv()
        : this.source.kind === 'token-file'
          ? await this.readTokenFile()
          : await this.readAuthStore();
    this.cached = cred;
    return cred;
  }

  private async readEnv(): Promise<WorkBuddyCredential> {
    const src = this.source as Extract<CredentialSource, { kind: 'env' }>;
    return { accessToken: stripBearer(src.token), userId: src.userId, domain: src.domain };
  }

  private async readTokenFile(): Promise<WorkBuddyCredential> {
    const src = this.source as Extract<CredentialSource, { kind: 'token-file' }>;
    const raw = (await readFile(src.path, 'utf8')).trim();
    if (!raw) throw new CredentialError(`token file is empty: ${src.path}`);
    return { accessToken: stripBearer(raw), userId: src.userId, domain: src.domain };
  }

  private async readAuthStore(): Promise<WorkBuddyCredential> {
    const src = this.source as Extract<CredentialSource, { kind: 'auth-store' }>;
    let raw: string;
    try {
      raw = await readFile(src.path, 'utf8');
    } catch (err) {
      throw new CredentialError(
        `cannot read WorkBuddy credentials at ${src.path} — log in via the WorkBuddy desktop app first, ` +
          `or set WKB2API_UPSTREAM_TOKEN / WKB2API_UPSTREAM_TOKEN_FILE instead ` +
          `(${err instanceof Error ? err.message : String(err)})`,
      );
    }
    const parsed = credentialFileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new CredentialError(
        `credentials at ${src.path} do not have the expected structure (missing auth.accessToken / account.uid); ` +
          `try re-logging in to the WorkBuddy app`,
      );
    }
    return {
      accessToken: stripBearer(parsed.data.auth.accessToken),
      userId: parsed.data.account.uid,
      domain: parsed.data.auth.domain ?? 'www.workbuddy.ai',
    };
  }
}

/** Strip an optional "Bearer " prefix so the gateway can add its own. */
export function stripBearer(token: string): string {
  const t = token.trim();
  return t.startsWith('Bearer ') ? t.slice(7).trim() : t;
}

function authStoreDefaultPath(): string {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return `${process.env.LOCALAPPDATA}\\CodeBuddyExtension\\Data\\Public\\auth\\workbuddy-desktop-ai.info`;
  }
  if (process.env.XDG_DATA_HOME) {
    return `${process.env.XDG_DATA_HOME}/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop-ai.info`;
  }
  if (process.env.HOME) {
    return `${process.env.HOME}/.local/share/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop-ai.info`;
  }
  throw new CredentialError(
    'cannot locate the WorkBuddy auth store: no LOCALAPPDATA/HOME; set WKB2API_UPSTREAM_TOKEN or WKB2API_UPSTREAM_TOKEN_FILE',
  );
}
