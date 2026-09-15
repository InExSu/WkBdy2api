import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { WorkBuddyCredential } from './auth.js';
import type { PoolStrategy } from './credential-pool.js';

const credentialSchema = z.object({
  accessToken: z.string().min(1),
  userId: z.string().min(1),
  domain: z.string().min(1),
  oauthOrigin: z.string().url().optional(),
  tokenType: z.literal('Bearer').optional(),
  refreshToken: z.string().min(1).optional(),
  expiresAt: z.number().positive().optional(),
  refreshExpiresAt: z.number().positive().optional(),
}).strict();

const snapshotSchema = z.object({
  version: z.literal(1),
  strategy: z.enum(['round-robin', 'random']),
  contextWindow: z.number().int().positive().optional(),
  contextWindows: z.record(z.number().int().positive()).optional(),
  nextLabel: z.number().int().positive(),
  accounts: z.array(z.object({
    label: z.string().min(1),
    note: z.string().optional(),
    credential: credentialSchema,
  }).strict()),
}).strict();

const envelopeSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal('aes-256-gcm'),
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
  tag: z.string().min(1),
}).strict();

export type CredentialStoreSnapshot = {
  version: 1;
  strategy: PoolStrategy;
  contextWindow?: number;
  contextWindows?: Record<string, number>;
  nextLabel: number;
  accounts: Array<{ label: string; note?: string; credential: WorkBuddyCredential }>;
};

export class CredentialStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CredentialStoreError';
  }
}

export class CredentialStore {
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly path: string,
    private readonly key: Buffer,
  ) {}

  static async fromKeyFile(path: string, keyFile: string): Promise<CredentialStore> {
    let raw: Buffer;
    try {
      raw = await readFile(keyFile);
    } catch (cause) {
      throw new CredentialStoreError('Cannot read the account-store encryption key file.', { cause });
    }

    const trimmed = raw.toString('utf8').trim();
    let key: Buffer;
    if (raw.length === 32) key = raw;
    else {
      try {
        key = Buffer.from(trimmed, 'base64');
      } catch (cause) {
        throw new CredentialStoreError('The account-store encryption key is invalid.', { cause });
      }
    }
    if (key.length !== 32) throw new CredentialStoreError('The account-store encryption key must be exactly 32 bytes.');
    return new CredentialStore(path, key);
  }

  async load(): Promise<CredentialStoreSnapshot | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new CredentialStoreError('Cannot read the encrypted account store.', { cause });
    }

    try {
      const envelope = envelopeSchema.parse(JSON.parse(raw));
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final(),
      ]);
      return snapshotSchema.parse(JSON.parse(plaintext.toString('utf8')));
    } catch (cause) {
      throw new CredentialStoreError('The encrypted account store is invalid or cannot be decrypted.', { cause });
    }
  }

  save(snapshot: CredentialStoreSnapshot): Promise<void> {
    const validated = snapshotSchema.parse(snapshot);
    const operation = this.writeQueue.then(() => this.write(validated));
    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  private async write(snapshot: CredentialStoreSnapshot): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(snapshot), 'utf8'),
      cipher.final(),
    ]);
    const envelope = JSON.stringify({
      version: 1,
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    }) + '\n';

    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(envelope, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, this.path);
    } catch (cause) {
      await rm(temporary, { force: true }).catch(() => {});
      throw new CredentialStoreError('Cannot persist the encrypted account store.', { cause });
    }
  }
}
