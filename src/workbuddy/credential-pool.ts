import { CredentialError, stripBearer, type WorkBuddyCredential, type CredentialSource } from './auth.js';
import type { CredentialStore, CredentialStoreSnapshot } from './credential-store.js';

export type PoolStrategy = 'round-robin' | 'random';
export type PoolAccount = { label: string; credential: WorkBuddyCredential; note?: string };
type AccountState = {
  account: PoolAccount;
  failures: number;
  quarantinedUntil: number;
  reauthRequired: boolean;
  refresh?: Promise<WorkBuddyCredential>;
};
type Refresher = (credential: WorkBuddyCredential) => Promise<WorkBuddyCredential>;

export class CredentialPool {
  private states: AccountState[] = [];
  private cursor = 0;
  private nextLabel = 1;
  private refresher?: Refresher;
  strategy: PoolStrategy;
  private contextWindow?: number;
  private contextWindows = new Map<string, number>();
  private readonly cooldownMs: number;
  private readonly store?: CredentialStore;

  constructor(opts: { strategy?: PoolStrategy; cooldownMs?: number; store?: CredentialStore } = {}) {
    this.strategy = opts.strategy ?? 'round-robin';
    this.cooldownMs = opts.cooldownMs ?? 60_000;
    this.store = opts.store;
  }

  restore(snapshot: CredentialStoreSnapshot): void {
    this.strategy = snapshot.strategy;
    this.contextWindow = snapshot.contextWindow;
    this.contextWindows = new Map(Object.entries(snapshot.contextWindows ?? {}));
    this.nextLabel = snapshot.nextLabel;
    this.cursor = 0;
    this.states = snapshot.accounts.map((account) => ({
      account: {
        ...account,
        credential: {
          ...account.credential,
          accessToken: stripBearer(account.credential.accessToken),
        },
      },
      failures: 0,
      quarantinedUntil: 0,
      reauthRequired: false,
    }));
  }

  setRefresher(refresh: Refresher): void { this.refresher = refresh; }

  private snapshot(): CredentialStoreSnapshot {
    return {
      version: 1,
      strategy: this.strategy,
      ...(this.contextWindow !== undefined ? { contextWindow: this.contextWindow } : {}),
      ...(this.contextWindows.size ? { contextWindows: Object.fromEntries(this.contextWindows) } : {}),
      nextLabel: this.nextLabel,
      accounts: this.states.map(({ account }) => ({
        label: account.label,
        ...(account.note !== undefined ? { note: account.note } : {}),
        credential: { ...account.credential },
      })),
    };
  }

  private async persist(): Promise<void> {
    if (this.store) await this.store.save(this.snapshot());
  }

  get contextWindowLength(): number | undefined { return this.contextWindow; }
  get contextWindowSettings(): Record<string, number> { return Object.fromEntries(this.contextWindows); }
  getContextWindow(modelId: string): number | undefined { return this.contextWindows.get(modelId) ?? this.contextWindow; }

  async setContextWindow(modelId: string, length: number | undefined): Promise<void> {
    const previous = this.contextWindows.get(modelId);
    if (length === undefined) this.contextWindows.delete(modelId);
    else this.contextWindows.set(modelId, length);
    try { await this.persist(); } catch (error) {
      if (previous === undefined) this.contextWindows.delete(modelId);
      else this.contextWindows.set(modelId, previous);
      throw error;
    }
  }

  async add(credential: WorkBuddyCredential, note?: string): Promise<PoolAccount> {
    const before = this.snapshot();
    const normalized = { ...credential, accessToken: stripBearer(credential.accessToken) };
    const existing = this.states.find((s) => s.account.credential.domain === normalized.domain && s.account.credential.userId === normalized.userId);
    let account: PoolAccount;
    if (existing) {
      existing.account.credential = normalized;
      if (note !== undefined) existing.account.note = note;
      existing.failures = 0;
      existing.quarantinedUntil = 0;
      existing.reauthRequired = false;
      account = existing.account;
    } else {
      account = { label: `#${this.nextLabel++}`, credential: normalized, note };
      this.states.push({ account, failures: 0, quarantinedUntil: 0, reauthRequired: false });
    }
    try {
      await this.persist();
      return account;
    } catch (error) {
      this.restore(before);
      throw error;
    }
  }

  async remove(label: string): Promise<boolean> {
    const index = this.states.findIndex((s) => s.account.label === label);
    if (index < 0) return false;
    const before = this.snapshot();
    this.states.splice(index, 1);
    if (this.cursor > index) this.cursor--;
    if (this.cursor >= this.states.length) this.cursor = 0;
    try {
      await this.persist();
      return true;
    } catch (error) {
      this.restore(before);
      throw error;
    }
  }

  list() {
    const now = Date.now();
    return this.states.map((s) => ({
      label: s.account.label, note: s.account.note,
      ok: !s.reauthRequired && s.quarantinedUntil <= now,
      detail: s.reauthRequired ? '需要重新网页登录' : s.account.credential.oauthOrigin ? '网页登录 · 仅保存在服务内存中' : '已导入凭据',
      reauth_required: s.reauthRequired,
      ...(s.quarantinedUntil > now ? { quarantined_until: s.quarantinedUntil } : {}),
    }));
  }

  get size(): number { return this.states.length; }
  get strategyName(): PoolStrategy { return this.strategy; }

  async setStrategy(strategy: PoolStrategy): Promise<void> {
    const previous = this.strategy;
    this.strategy = strategy;
    try {
      await this.persist();
    } catch (error) {
      this.strategy = previous;
      throw error;
    }
  }

  reportFailure(token: string): void {
    const s = this.states.find((x) => x.account.credential.accessToken === token);
    if (!s) return;
    s.failures++;
    s.quarantinedUntil = Date.now() + Math.min(this.cooldownMs * 2 ** Math.min(s.failures - 1, 10), 30 * 60_000);
  }

  async getCredential(): Promise<WorkBuddyCredential> {
    if (!this.states.length) throw new CredentialError('No accounts configured; sign in through the admin panel.');
    const now = Date.now();
    const available = this.states.filter((s) => !s.reauthRequired && s.quarantinedUntil <= now);
    if (!available.length) throw new CredentialError('No available account; wait for cooldown or sign in again.');
    let picked: AccountState;
    if (this.strategy === 'random') picked = available[Math.floor(Math.random() * available.length)]!;
    else {
      const first = this.cursor;
      picked = available[0]!;
      for (let i = 0; i < this.states.length; i++) {
        const index = (first + i) % this.states.length;
        const s = this.states[index]!;
        if (!s.reauthRequired && s.quarantinedUntil <= now) {
          picked = s;
          this.cursor = (index + 1) % this.states.length;
          break;
        }
      }
    }
    const credential = picked.account.credential;
    if (credential.expiresAt !== undefined && credential.expiresAt <= now + 60_000) return this.refreshAccount(picked);
    return credential;
  }

  async refreshRejectedCredential(credential: WorkBuddyCredential): Promise<WorkBuddyCredential> {
    const state = this.states.find((s) => s.account.credential.accessToken === credential.accessToken);
    if (!state) throw new CredentialError('Account changed or was removed; retry with the current session.');
    return this.refreshAccount(state);
  }

  private async refreshAccount(state: AccountState): Promise<WorkBuddyCredential> {
    if (state.refresh) return state.refresh;
    const before = state.account.credential;
    if (!before.refreshToken || !this.refresher) {
      state.reauthRequired = true;
      throw new CredentialError('Account needs a new web login.');
    }
    const refresh = this.refresher;
    state.refresh = (async () => {
      try {
        const credential = await refresh(before);
        if (!this.states.includes(state)) throw new CredentialError('Account was removed while refreshing.');
        if (state.account.credential !== before) return state.account.credential;
        if (credential.userId !== before.userId || credential.domain !== before.domain) throw new CredentialError('Account identity changed during refresh.');
        state.account.credential = credential;
        try {
          await this.persist();
          return credential;
        } catch (error) {
          if (this.states.includes(state) && state.account.credential === credential) {
            state.account.credential = before;
          }
          throw error;
        }
      } catch (err) {
        if (this.states.includes(state) && state.account.credential === before) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 401 || code === 403 || err instanceof CredentialError) state.reauthRequired = true;
          else this.reportFailure(before.accessToken);
        }
        throw new CredentialError('Account refresh failed; retry later or sign in again.');
      } finally { state.refresh = undefined; }
    })();
    return state.refresh;
  }

  invalidate(): void {}
  describe(): string {
    return `account pool (${this.states.length} accounts)`;
  }
}

export type { WorkBuddyCredential, CredentialSource };
