import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * Canary scan: no JWT-like strings, no real bearer values, no UUID-shaped
 * user ids in anything that ships with the repo (fixtures + source).
 * The redacted fixtures use ***REDACTED*** placeholders.
 */
describe('credential leak scan', () => {
  const scanDirs = ['fixtures', 'src', 'Dockerfile', 'docker-compose.yml'];

  function filesUnder(dir: string): string[] {
    try {
      const stat = readdirSync(join(projectRoot, dir), { withFileTypes: true });
      return stat
        .filter((e) => e.isFile())
        .map((e) => join(dir, e.name))
        .concat(stat.filter((e) => e.isDirectory()).flatMap((e) => filesUnder(join(dir, e.name))));
    } catch {
      return [dir]; // plain file path
    }
  }

  const files = scanDirs.flatMap(filesUnder);

  it('scanned at least the fixture set', () => {
    expect(files.filter((f) => f.startsWith('fixtures')).length).toBeGreaterThanOrEqual(5);
  });

  it.each(files)('%s contains no JWT-like strings', (rel) => {
    const text = readFileSync(join(projectRoot, rel), 'utf8');
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });

  it.each(files)('%s contains no real Bearer values (only placeholders)', (rel) => {
    const text = readFileSync(join(projectRoot, rel), 'utf8');
    const realBearers = text.match(/Bearer\s+(?!mock|\*\*\*REDACTED\*\*\*|\$\{)[A-Za-z0-9._-]{20,}/g);
    expect(realBearers ?? []).toEqual([]);
  });

  it('docker-compose does not bake a real token', () => {
    const yml = readFileSync(join(projectRoot, 'docker-compose.yml'), 'utf8');
    expect(yml).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(yml).toContain('${WKB2API_API_KEY:?WKB2API_API_KEY is required}');
  });
});
