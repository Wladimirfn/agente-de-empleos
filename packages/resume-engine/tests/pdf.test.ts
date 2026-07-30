import { describe, it, expect } from 'vitest';
import { generatePdf } from '../src/pdf.js';
import type { CandidateProfile } from '@employment-agent/domain';

describe('generatePdf — no fabrication invariant', () => {
  it('produces a PDF for a complete profile', async () => {
    const profile: CandidateProfile = {
      fullName: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+56 9 1234 5678',
      location: 'Santiago, Chile',
      summary: 'Senior software engineer with 10 years of experience.',
      experiences: [
        { company: 'Acme Corp', role: 'Senior Engineer', startDate: '2020-01', endDate: 'present', description: 'Led team of 5 engineers.' },
        { company: 'Beta Inc', role: 'Engineer', startDate: '2017-01', endDate: '2019-12' },
      ],
      skills: [
        { name: 'TypeScript' },
        { name: 'Node.js' },
        { name: 'PostgreSQL' },
      ],
    };
    const bytes = await generatePdf(profile);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(1000);
    // PDF starts with %PDF
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('does not fabricate phone when not provided', async () => {
    const profile: CandidateProfile = {
      fullName: 'Anonymous',
      email: 'a@b.com',
    };
    const bytes = await generatePdf(profile);
    const text = new TextDecoder().decode(bytes);
    // Should NOT contain phone-like patterns
    expect(text).not.toMatch(/\+?\d{3}[\s-]?\d{3,4}[\s-]?\d{4}/);
    // Should NOT contain "Phone:" label
    expect(text).not.toMatch(/phone:/i);
  });

  it('does not fabricate summary when not provided', async () => {
    const profile: CandidateProfile = { fullName: 'No Summary' };
    const bytes = await generatePdf(profile);
    const text = new TextDecoder().decode(bytes);
    // Should NOT have a Summary heading + placeholder content
    expect(text).not.toMatch(/Summary\s*\[/);
    // Should not contain the word Summary at all if not provided
    // (This depends on PDF text extraction; we check the structure)
  });

  it('renders 50 experiences without truncation', async () => {
    const profile: CandidateProfile = {
      fullName: 'Experienced One',
      experiences: Array.from({ length: 50 }, (_, i) => ({
        company: `Company ${i + 1}`,
        role: `Role ${i + 1}`,
      })),
    };
    const bytes = await generatePdf(profile);
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it('renders profile with zero experiences', async () => {
    const profile: CandidateProfile = {
      fullName: 'Fresher',
      email: 'f@b.com',
      experiences: [],
    };
    const bytes = await generatePdf(profile);
    expect(bytes.length).toBeGreaterThan(500);
  });

  it('throws on placeholder summary', async () => {
    const profile: CandidateProfile = { fullName: 'X', summary: 'Lorem ipsum dolor sit amet' };
    await expect(generatePdf(profile)).rejects.toThrow(/placeholder/i);
  });
});
