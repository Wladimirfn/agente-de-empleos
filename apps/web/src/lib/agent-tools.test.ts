import { describe, expect, it } from 'vitest';
import { deriveSlug, parseToolCall, TOOLS_PROMPT } from './agent-tools.js';

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
});

describe('TOOLS_PROMPT', () => {
  it('documents every tool the parser accepts', () => {
    for (const tool of ['list_jobs', 'list_applications', 'list_platforms', 'get_errors', 'trigger_scan', 'set_auto_scan', 'add_platform']) {
      expect(TOOLS_PROMPT).toContain(tool);
    }
  });
});
