import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
} from 'docx';
import type { CandidateProfile } from '@employment-agent/domain';
import { assertNoFabrication, safeProfileForResume } from '@employment-agent/domain';

/**
 * Generate a DOCX resume from a candidate profile.
 *
 * Same invariants as generatePdf: empty fields omitted, no fabrication.
 */
export async function generateDocx(profile: CandidateProfile): Promise<Buffer> {
  assertNoFabrication(profile);
  const safe = safeProfileForResume(profile);

  const children: Paragraph[] = [];

  // Header
  if (safe.fullName) {
    children.push(
      new Paragraph({
        text: safe.fullName,
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.LEFT,
      })
    );
  }

  const contactParts: string[] = [];
  if (safe.email) contactParts.push(safe.email);
  if (safe.phone) contactParts.push(safe.phone);
  if (safe.location) contactParts.push(safe.location);
  if (contactParts.length > 0) {
    children.push(new Paragraph({ children: [new TextRun(contactParts.join('  ·  '))] }));
  }

  // Summary
  if (safe.summary) {
    children.push(new Paragraph({ text: 'Summary', heading: HeadingLevel.HEADING_1 }));
    children.push(new Paragraph({ children: [new TextRun(safe.summary)] }));
  }

  // Experiences
  if (safe.experiences && safe.experiences.length > 0) {
    children.push(new Paragraph({ text: 'Experience', heading: HeadingLevel.HEADING_1 }));
    for (const exp of safe.experiences) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `${exp.role} — ${exp.company}`, bold: true })],
        })
      );
      const dateRange = [exp.startDate, exp.endDate].filter(Boolean).join(' – ') || 'Dates not specified';
      children.push(new Paragraph({ children: [new TextRun({ text: dateRange, italics: true })] }));
      if (exp.description) {
        children.push(new Paragraph({ children: [new TextRun(exp.description)] }));
      }
    }
  }

  // Skills
  if (safe.skills && safe.skills.length > 0) {
    children.push(new Paragraph({ text: 'Skills', heading: HeadingLevel.HEADING_1 }));
    children.push(
      new Paragraph({
        children: [new TextRun(safe.skills.map((s) => s.name).join(', '))],
      })
    );
  }

  // Education
  if (safe.education && safe.education.length > 0) {
    children.push(new Paragraph({ text: 'Education', heading: HeadingLevel.HEADING_1 }));
    for (const edu of safe.education) {
      const dateRange = [edu.startDate, edu.endDate].filter(Boolean).join(' – ');
      const text = dateRange ? `${edu.institution} (${dateRange})` : edu.institution;
      children.push(new Paragraph({ children: [new TextRun(text)] }));
    }
  }

  const doc = new Document({
    sections: [{ children }],
  });

  return await Packer.toBuffer(doc);
}
