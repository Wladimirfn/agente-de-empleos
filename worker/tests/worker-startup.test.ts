import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('../src/index.ts', import.meta.url)), 'utf8');
const skillInitSource = readFileSync(fileURLToPath(new URL('../src/skill-init.ts', import.meta.url)), 'utf8');

describe('worker startup database lifecycle', () => {
  it('waits for migrations before starting database consumers', () => {
    expect(source).toContain('await runMigrations();');
    expect(source.indexOf('await runMigrations();')).toBeLessThan(source.indexOf('startHeartbeat();'));
    expect(source.indexOf('await runMigrations();')).toBeLessThan(source.indexOf('void startTaskRunner();'));
  });

  it('waits for database shutdown during graceful termination', () => {
    expect(source).toContain('await closeDb();');
  });
});

describe('production skill registration', () => {
  it('does not import the example platform fixture', () => {
    expect(skillInitSource).not.toContain('example-platform');
    expect(skillInitSource).not.toContain('examplePlatformSkill');
  });

  it('only exposes real platform skills for production registration', async () => {
    const { productionSkills } = await import('../src/skill-init.js');
    expect(productionSkills.map((skill) => skill.slug)).toEqual(['laborum', 'computrabajo', 'indeed', 'chiletrabajos']);
    expect(productionSkills.some((skill) => skill.slug === 'example-platform')).toBe(false);
  });

  it('imports the chiletrabajos skill into the production registry source', () => {
    expect(skillInitSource).toContain("from '../../skills/chiletrabajos/index.js'");
    expect(skillInitSource).toMatch(/chiletrabajosSkill/);
  });
});
