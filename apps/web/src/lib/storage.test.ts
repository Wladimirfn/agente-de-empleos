import { describe, expect, it } from 'vitest';
import { sanitizeFilename, MAX_CV_BYTES } from './storage.js';

describe('sanitizeFilename', () => {
  it('strips directory traversal', () => {
    expect(sanitizeFilename('../../../etc/passwd')).toBe('passwd');
  });

  it('replaces unsafe characters with underscore', () => {
    expect(sanitizeFilename('curriclum (1) [final].pdf')).toBe('curriclum__1___final_.pdf');
  });

  it('preserves extension and base name', () => {
    expect(sanitizeFilename('CV.Juan.Pérez.docx')).toBe('CV.Juan.P_rez.docx');
  });

  it('handles empty or whitespace input', () => {
    expect(sanitizeFilename('')).toBe('unnamed');
    expect(sanitizeFilename('   ')).toBe('___');
  });

  it('truncates very long names to 200 chars', () => {
    const long = 'a'.repeat(500) + '.pdf';
    expect(sanitizeFilename(long).length).toBeLessThanOrEqual(200);
  });
});

describe('MAX_CV_BYTES', () => {
  it('is 10 MB', () => {
    expect(MAX_CV_BYTES).toBe(10 * 1024 * 1024);
  });
});