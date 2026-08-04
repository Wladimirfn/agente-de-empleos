import { describe, expect, it } from 'vitest';
import { sanitizeUrlsInText } from '../src/browser-tools.js';

describe('sanitizer Ray ID redaction', () => {
  it('redacts Cloudflare Ray ID in the canonical header form', () => {
    expect(sanitizeUrlsInText('cf-ray: a25a1771da83cf87-MAD'))
      .toBe('cf-ray: <cf-ray>');
  });

  it('redacts Ray ID mentioned in plain text (Indeed trace case)', () => {
    expect(sanitizeUrlsInText('Challenge with Ray ID a25a1771da83cf87 still showing'))
      .toBe('Challenge with Ray ID <cf-ray> still showing');
  });

  it('redacts cf-mitigated label', () => {
    expect(sanitizeUrlsInText('cf-mitigated: a25a1771da83cf87'))
      .toBe('cf-mitigated: <cf-ray>');
  });

  it('redacts "Cloudflare Ray ID" label', () => {
    expect(sanitizeUrlsInText('Cloudflare Ray ID 8a1234bc56de7890FRO'))
      .toBe('Cloudflare Ray ID <cf-ray>');
  });

  it('does NOT redact short hex strings that look like commit hashes', () => {
    expect(sanitizeUrlsInText('Build abc1234 succeeded'))
      .toBe('Build abc1234 succeeded');
  });

  it('does NOT redact 16-char hex inside larger identifiers', () => {
    // Hash of a JobPosting JSON-LD card — must remain identifiable
    expect(sanitizeUrlsInText('payload=abcdef0123456789abcdef0123456789abcdef'))
      .toBe('payload=abcdef0123456789abcdef0123456789abcdef');
  });
});
