import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { CandidateProfile } from '@employment-agent/domain';
import { assertNoFabrication, safeProfileForResume } from '@employment-agent/domain';

const PAGE_MARGIN = 50;
const LINE_HEIGHT = 16;
const TITLE_FONT_SIZE = 18;
const HEADING_FONT_SIZE = 14;
const BODY_FONT_SIZE = 11;

/**
 * Generate a PDF resume from a candidate profile.
 *
 * Invariants:
 * - Empty fields are OMITTED entirely. No placeholder text.
 * - Never fabricates data: only uses what's in the profile.
 */
export async function generatePdf(profile: CandidateProfile): Promise<Uint8Array> {
  assertNoFabrication(profile);
  const safe = safeProfileForResume(profile);

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage();
  let y = page.getHeight() - PAGE_MARGIN;

  const drawText = (text: string, options: { font?: typeof font; size?: number; color?: ReturnType<typeof rgb> } = {}) => {
    const fontToUse = options.font ?? font;
    const size = options.size ?? BODY_FONT_SIZE;
    page.drawText(text, {
      x: PAGE_MARGIN,
      y,
      size,
      font: fontToUse,
      color: options.color ?? rgb(0, 0, 0),
    });
    y -= LINE_HEIGHT * (size / BODY_FONT_SIZE);
  };

  const ensureSpace = (needed: number) => {
    if (y - needed < PAGE_MARGIN) {
      page = pdfDoc.addPage();
      y = page.getHeight() - PAGE_MARGIN;
    }
  };

  // Header: name + contact
  if (safe.fullName) {
    drawText(safe.fullName, { font: boldFont, size: TITLE_FONT_SIZE });
    y -= 4;
  }

  const contactParts: string[] = [];
  if (safe.email) contactParts.push(safe.email);
  if (safe.phone) contactParts.push(safe.phone);
  if (safe.location) contactParts.push(safe.location);
  if (contactParts.length > 0) {
    drawText(contactParts.join('  ·  '));
    y -= 8;
  }

  // Summary
  if (safe.summary) {
    ensureSpace(LINE_HEIGHT * 2);
    drawText('Summary', { font: boldFont, size: HEADING_FONT_SIZE });
    drawText(safe.summary);
    y -= 8;
  }

  // Experiences
  if (safe.experiences && safe.experiences.length > 0) {
    ensureSpace(LINE_HEIGHT * 2);
    drawText('Experience', { font: boldFont, size: HEADING_FONT_SIZE });
    for (const exp of safe.experiences) {
      ensureSpace(LINE_HEIGHT * 3);
      const dateRange = [exp.startDate, exp.endDate].filter(Boolean).join(' – ') || 'Dates not specified';
      drawText(`${exp.role} — ${exp.company}`, { font: boldFont });
      drawText(dateRange, { size: 10, color: rgb(0.4, 0.4, 0.4) });
      if (exp.description) {
        const lines = wrapText(exp.description, 90);
        for (const line of lines) {
          ensureSpace(LINE_HEIGHT);
          drawText(line);
        }
      }
      y -= 6;
    }
    y -= 4;
  }

  // Skills
  if (safe.skills && safe.skills.length > 0) {
    ensureSpace(LINE_HEIGHT * 2);
    drawText('Skills', { font: boldFont, size: HEADING_FONT_SIZE });
    const skillText = safe.skills.map((s) => s.name).join(', ');
    const skillLines = wrapText(skillText, 90);
    for (const line of skillLines) {
      ensureSpace(LINE_HEIGHT);
      drawText(line);
    }
    y -= 4;
  }

  // Education
  if (safe.education && safe.education.length > 0) {
    ensureSpace(LINE_HEIGHT * 2);
    drawText('Education', { font: boldFont, size: HEADING_FONT_SIZE });
    for (const edu of safe.education) {
      ensureSpace(LINE_HEIGHT);
      const dateRange = [edu.startDate, edu.endDate].filter(Boolean).join(' – ');
      const text = dateRange ? `${edu.institution} (${dateRange})` : edu.institution;
      drawText(text);
    }
  }

  return pdfDoc.save();
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = current ? current + ' ' + word : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
