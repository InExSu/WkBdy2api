import { Window, type HTMLInputElement, type HTMLButtonElement } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminPanelHtml } from '../src/routes/admin-html.js';

const windows: Window[] = [];
afterEach(async () => { await Promise.all(windows.splice(0).map((w) => w.happyDOM.close())); });

// Same string the backend puts into pool.list() detail for an OAuth account.
const POOL_DETAIL = '网页登录 · 仅保存在服务内存中';

const overview = {
  version: 'test',
  credential: { ok: true, source: 'pool', detail: POOL_DETAIL },
  upstream: { url: 'https://www.workbuddy.ai/v2/chat/completions', user_agent: 'WorkBuddy/2.137.1' },
  models: [],
  pool: {
    size: 1,
    strategy: 'round-robin',
    context_window: null,
    accounts: [{ label: '#1', note: '', ok: true, detail: POOL_DETAIL }],
  },
  stats: { uptime_ms: 0, total_requests: 0, total_errors: 0, error_rate: 0, p95_ms: null, per_model: [], tokens: { prompt: 0, completion: 0 } },
};

const CJK = /[㐀-䶿一-鿿豈-﫿]/;

async function openUpstreamView(savedLang?: string) {
  const w = new Window({ url: 'http://127.0.0.1:8787/admin' });
  windows.push(w);
  if (savedLang) w.localStorage.setItem('wkb2api-lang', savedLang);
  const fetchFn = vi.fn(async (path: string) => {
    if (!path.endsWith('/overview')) throw new Error('unexpected local request: ' + path);
    return { ok: true, status: 200, json: async () => overview } as Response;
  });
  w.fetch = fetchFn as never;
  w.document.write(adminPanelHtml());
  // Script tags are inert in this test; evaluate only the page's own trusted code.
  w.eval(w.document.querySelector('script')!.textContent!);
  const input = w.document.querySelector('#key-input') as unknown as HTMLInputElement;
  input.value = 'test-only-admin-key';
  (w.document.querySelector('#key-submit') as unknown as HTMLButtonElement).click();
  await vi.waitFor(() => expect(w.document.querySelector('#main .section')).not.toBeNull());
  (w.document.querySelector('[data-view="upstream"]') as unknown as HTMLButtonElement).click();
  await vi.waitFor(() => expect(w.document.querySelector('.footer-note')).not.toBeNull());
  return { w };
}

describe('admin panel i18n', () => {
  it('defaults to English and leaves no Chinese in the upstream view', async () => {
    const { w } = await openUpstreamView();
    expect(w.document.documentElement.lang).toBe('en');
    const text = w.document.querySelector('#main')!.textContent!;
    expect(text).not.toMatch(CJK);
    expect(text).toContain('Web sign-in · kept in service memory only');
  });

  it('separates the pool strategy from the scheduler note', async () => {
    const { w } = await openUpstreamView();
    const note = w.document.querySelector('.footer-note')!.textContent!;
    expect(note).not.toMatch(CJK);
    expect(note).toContain('Round-robin · 401 accounts cool down and retry');
  });

  it('translates the same account detail in Russian', async () => {
    const { w } = await openUpstreamView('ru');
    expect(w.document.documentElement.lang).toBe('ru');
    const text = w.document.querySelector('#main')!.textContent!;
    expect(text).toContain('Вход через сайт · только в памяти сервиса');
    expect(text).toContain('По очереди · аккаунты с 401 остывают и повторяются');
  });
});
