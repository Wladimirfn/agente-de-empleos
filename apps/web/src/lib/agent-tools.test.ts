import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { coarseLocation, deriveSlug, executeTool, parseToolCall, TOOL_NAMES, TOOLS_PROMPT } from './agent-tools.js';

describe('deriveSlug', () => {
  it('derives slugs from typical job portal URLs', () => {
    expect(deriveSlug('https://www.chiletrabajos.cl/empleos')).toBe('chiletrabajos');
    expect(deriveSlug('https://cl.indeed.com')).toBe('indeed');
    expect(deriveSlug('https://www.trabajando.cl')).toBe('trabajando');
  });

  it('returns null for invalid URLs', () => {
    expect(deriveSlug('not-a-url')).toBeNull();
  });
});

describe('parseToolCall', () => {
  it('returns none for normal prose', () => {
    expect(parseToolCall('Hola, mirá, estas son las mejores ofertas…')).toEqual({ kind: 'none' });
  });

  it('returns none when HERRAMIENTA appears mid-text (not a pure call)', () => {
    expect(parseToolCall('Podés usar HERRAMIENTA: para consultar')).toEqual({ kind: 'none' });
  });

  it('parses a valid call with args', () => {
    expect(parseToolCall('HERRAMIENTA: {"tool": "list_jobs", "args": {"platform": "computrabajo", "limit": 5}}')).toEqual({
      kind: 'call',
      call: { tool: 'list_jobs', args: { platform: 'computrabajo', limit: 5 } },
      proseBefore: '',
    });
  });

  it('parses a valid call without args', () => {
    expect(parseToolCall('  HERRAMIENTA: {"tool": "list_platforms"}  ')).toEqual({
      kind: 'call',
      call: { tool: 'list_platforms', args: {} },
      proseBefore: '',
    });
  });

  it('parses a call that comes after prose and keeps the prose', () => {
    const result = parseToolCall('Voy a revisar tus postulaciones.\n\nHERRAMIENTA: {"tool": "list_applications", "args": {}}');
    expect(result).toEqual({
      kind: 'call',
      call: { tool: 'list_applications', args: {} },
      proseBefore: 'Voy a revisar tus postulaciones.',
    });
  });

  it('treats a broken JSON after prose as prose, not an error', () => {
    expect(parseToolCall('Mirá, con HERRAMIENTA: {cosas} no funciona así')).toEqual({ kind: 'none' });
  });

  it('rejects invalid JSON with a corrective error for the model', () => {
    const result = parseToolCall('HERRAMIENTA: {tool: list_jobs}');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.error).toContain('HERRAMIENTA:');
  });

  it('rejects unknown tools listing the valid ones', () => {
    const result = parseToolCall('HERRAMIENTA: {"tool": "delete_jobs"}');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.error).toContain('delete_jobs');
      expect(result.error).toContain('list_jobs');
    }
  });

  it('rejects non-object args', () => {
    const result = parseToolCall('HERRAMIENTA: {"tool": "list_jobs", "args": [1, 2]}');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.error).toContain('"args"');
  });

  it('rejects malformed and undeclared read arguments', () => {
    expect(parseToolCall('HERRAMIENTA: {"tool":"list_activity","args":{"limit":"all"}}').kind).toBe('error');
    expect(parseToolCall('HERRAMIENTA: {"tool":"get_profile_summary","args":{"raw":true}}').kind).toBe('error');
  });
});

describe('TOOLS_PROMPT', () => {
  it('documents every tool the parser accepts', () => {
    for (const tool of TOOL_NAMES) {
      expect(TOOLS_PROMPT).toContain(tool);
    }
  });
});

describe('bounded read tools', () => {
  const reads = ['get_profile_summary', 'list_cv_documents', 'list_jobs', 'list_applications', 'list_platforms', 'list_platform_skills', 'list_activity', 'get_errors'] as const;

  it.each(reads)('%s dispatches through the bounded recursive redaction envelope', async (tool) => {
    const secret = `<b>Senior Engineer ACME Santiago</b> sk-live-abcdef123456 github_pat_${'x'.repeat(24)} Bearer abc.def eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature {"password":"hunter2","apiKey":"live-key"} https://user:pass@example.com/jobs?token=x#secret C:/Users/jane/cv.pdf \\\\server\\share\\cv.pdf /opt/app/key /srv/data/key failure at async run (/tmp/app.ts:1:2)`;
    const args = tool === 'get_profile_summary' ? {} : { limit: 50 };
    const malicious = { token: 'visible', secret: 'hidden', 'https://example.com/path?one=1': 'first', 'https://example.com/path#two': 'last', message: secret };
    const result = await executeTool({ tool, args }, { readSources: { [tool]: async () => Array.from({ length: 60 }, (_, index) => index ? { index, message: 'safe' } : malicious) } });
    const parsed = JSON.parse(result);
    expect(parsed).toMatchObject({ tool, count: tool === 'get_profile_summary' ? 10 : 50, limit: tool === 'get_profile_summary' ? 10 : 50 });
    expect(result).not.toMatch(/sk-live|github_pat|Bearer|eyJhbGci|password|apiKey|hunter2|live-key|user:pass|token=x|#secret|Users|server|opt\/app|srv\/data|app\.ts|"token"|"secret"/i);
    expect(parsed.items[0]).toMatchObject({ '[redacted key]': '[redacted]', 'https://example.com/path': 'last' });
    expect(result).toContain('Senior Engineer ACME Santiago');
    expect(result.length).toBeLessThanOrEqual(4000);
  });

  it.each([['Santiago, Chile', 'Santiago, Chile'], ['123 Main St, Santiago, Chile', 'Santiago, Chile'], ['Av. Providencia 1234, Providencia, Región Metropolitana, Chile', 'Providencia, Región Metropolitana, Chile'], ['(-33.45, -70.66), Valparaíso, Chile', 'Valparaíso, Chile'], ['742 Evergreen Terrace', null]])('coarsens location %s', (input, expected) => {
    expect(coarseLocation(input)).toBe(expected);
  });

  it('uses unique ID tie-breakers for capped tied scores, priorities, and timestamps', () => {
    const source = readFileSync(new URL('./agent-tools.ts', import.meta.url), 'utf8');
    for (const ordering of ['desc(candidateExperiences.createdAt), desc(candidateExperiences.id)', 'asc(candidateTargetRoles.priority), asc(candidateTargetRoles.id)', 'desc(candidateDocuments.createdAt), desc(candidateDocuments.id)', 'desc(jobMatches.score), desc(jobs.firstSeenAt), desc(jobs.id)', 'desc(applications.createdAt), desc(applications.id)', 'asc(platformSkills.skillSlug), asc(platformSkills.id)', 'desc(skillHealthchecks.checkedAt), desc(skillHealthchecks.id)', 'desc(agentRuns.startedAt), desc(agentRuns.id)', 'desc(skillFailures.occurredAt), desc(skillFailures.id)']) expect(source).toContain(ordering);
    expect(source.match(/from\(candidateProfiles\)\.orderBy\(desc\(candidateProfiles\.id\)\)\.limit\(1\)/g)).toHaveLength(3);
  });
});
