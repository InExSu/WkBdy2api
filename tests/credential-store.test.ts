import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { CredentialStore } from '../src/workbuddy/credential-store.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'wkbdy2api-store-'));
  dirs.push(dir);
  const storePath = join(dir, 'accounts.enc');
  const keyPath = join(dir, 'accounts.key');
  await writeFile(keyPath, randomBytes(32));
  const store = await CredentialStore.fromKeyFile(storePath, keyPath);
  return { dir, storePath, keyPath, store };
}

const snapshot = {
  version: 1 as const,
  strategy: 'round-robin' as const,
  nextLabel: 2,
  accounts: [{
    label: '#1',
    note: 'primary',
    credential: {
      accessToken: 'secret-access-token',
      refreshToken: 'secret-refresh-token',
      userId: 'user-1',
      domain: 'www.workbuddy.ai',
      tokenType: 'Bearer' as const,
      oauthOrigin: 'https://www.workbuddy.ai',
      expiresAt: Date.now() + 60_000,
    },
  }],
};

describe('CredentialStore', () => {
  it('encrypts and restores the complete account snapshot', async () => {
    const { store, storePath } = await setup();
    await store.save(snapshot);

    const raw = await readFile(storePath, 'utf8');
    expect(raw).not.toContain('secret-access-token');
    expect(raw).not.toContain('secret-refresh-token');
    expect(await store.load()).toEqual(snapshot);
  });

  it('uses a fresh IV for every save', async () => {
    const { store, storePath } = await setup();
    await store.save(snapshot);
    const first = JSON.parse(await readFile(storePath, 'utf8'));
    await store.save(snapshot);
    const second = JSON.parse(await readFile(storePath, 'utf8'));

    expect(second.iv).not.toBe(first.iv);
    expect(second.ciphertext).not.toBe(first.ciphertext);
  });

  it('rejects an incorrect key without modifying the store', async () => {
    const { dir, store, storePath } = await setup();
    await store.save(snapshot);
    const before = await readFile(storePath);
    const wrongKeyPath = join(dir, 'wrong.key');
    await writeFile(wrongKeyPath, randomBytes(32));

    const wrongStore = await CredentialStore.fromKeyFile(storePath, wrongKeyPath);
    await expect(wrongStore.load()).rejects.toThrow('invalid or cannot be decrypted');
    expect(await readFile(storePath)).toEqual(before);
  });

  it('rejects tampered ciphertext', async () => {
    const { store, storePath } = await setup();
    await store.save(snapshot);
    const envelope = JSON.parse(await readFile(storePath, 'utf8'));
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    ciphertext[0] = ciphertext[0]! ^ 1;
    envelope.ciphertext = ciphertext.toString('base64');
    await writeFile(storePath, JSON.stringify(envelope));

    await expect(store.load()).rejects.toThrow('invalid or cannot be decrypted');
  });

  it('serializes concurrent writes and leaves the last snapshot readable', async () => {
    const { store } = await setup();
    const second = { ...snapshot, strategy: 'random' as const, nextLabel: 3 };
    const third = { ...snapshot, strategy: 'round-robin' as const, nextLabel: 4 };

    await Promise.all([store.save(snapshot), store.save(second), store.save(third)]);
    expect(await store.load()).toEqual(third);
  });

  it('accepts a base64-encoded 32-byte key and rejects invalid key lengths', async () => {
    const { dir, storePath } = await setup();
    const base64KeyPath = join(dir, 'base64.key');
    await writeFile(base64KeyPath, randomBytes(32).toString('base64'));
    await expect(CredentialStore.fromKeyFile(storePath, base64KeyPath)).resolves.toBeInstanceOf(CredentialStore);

    const shortKeyPath = join(dir, 'short.key');
    await writeFile(shortKeyPath, randomBytes(16));
    await expect(CredentialStore.fromKeyFile(storePath, shortKeyPath)).rejects.toThrow('exactly 32 bytes');
  });
});
