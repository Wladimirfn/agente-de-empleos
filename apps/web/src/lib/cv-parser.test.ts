import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { Document, Packer, Paragraph } from 'docx';
import { parseCv, CvParseError } from './cv-parser.js';

async function makePdf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage();
  let y = page.getHeight() - 50;
  for (const line of lines) {
    page.drawText(line, { x: 50, y, size: 11, font });
    y -= 16;
  }
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

async function makeDocx(lines: string[]): Promise<Buffer> {
  const doc = new Document({
    sections: [{ children: lines.map((l) => new Paragraph(l)) }],
  });
  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}

describe('parseCv', () => {
  describe('text/plain', () => {
    it('extracts text and detects mime from .txt extension', async () => {
      const buf = Buffer.from('Juan Pérez\njuan@example.com\n+54 11 5555-1234\n\nExperiencia\nAcme Corp', 'utf-8');
      const result = await parseCv('cv.txt', buf);
      expect(result.mime).toBe('text/plain');
      expect(result.fullText).toContain('Juan Pérez');
      expect(result.hints.email).toBe('juan@example.com');
      expect(result.hints.phone).toBe('+54 11 5555-1234');
      expect(result.hints.name).toBe('Juan Pérez');
    });

    it('respects declared text/plain mime', async () => {
      const buf = Buffer.from('Maria Lopez\nmaria@test.org');
      const result = await parseCv('cv.unknown', buf, 'text/plain');
      expect(result.mime).toBe('text/plain');
      expect(result.hints.email).toBe('maria@test.org');
    });
  });

  describe('application/pdf', () => {
    it('extracts text from a generated PDF', async () => {
      const buf = await makePdf(['Carlos Gomez', 'carlos@example.com', '+1 555 123 4567', '', 'Senior engineer at Foo Inc']);
      const result = await parseCv('cv.pdf', buf);
      expect(result.mime).toBe('application/pdf');
      expect(result.fullText).toContain('Carlos Gomez');
      expect(result.fullText).toContain('carlos@example.com');
      expect(result.hints.email).toBe('carlos@example.com');
      expect(result.hints.phone).toBeTruthy();
      expect(result.hints.name).toBe('Carlos Gomez');
    });

    it('respects declared application/pdf mime', async () => {
      const buf = await makePdf(['Test Person', 'test@example.com']);
      const result = await parseCv('cv.unknown', buf, 'application/pdf');
      expect(result.mime).toBe('application/pdf');
    });
  });

  describe('application/vnd.openxmlformats-officedocument.wordprocessingml.document', () => {
    it('extracts text from a generated DOCX', async () => {
      const buf = await makeDocx(['Ana Torres', 'ana@example.com', '+34 600 123 456', '', 'Frontend developer']);
      const result = await parseCv('cv.docx', buf);
      expect(result.mime).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(result.fullText).toContain('Ana Torres');
      expect(result.hints.email).toBe('ana@example.com');
      expect(result.hints.phone).toBeTruthy();
      expect(result.hints.name).toBe('Ana Torres');
    });
  });

  describe('error handling', () => {
    it('throws CvParseError on unsupported extension', async () => {
      await expect(parseCv('cv.xyz', Buffer.from('hi'))).rejects.toBeInstanceOf(CvParseError);
    });

    it('throws CvParseError when PDF buffer is invalid', async () => {
      await expect(parseCv('cv.pdf', Buffer.from('not a pdf'))).rejects.toBeInstanceOf(CvParseError);
    });
  });

  describe('truncation', () => {
    it('truncates text larger than MAX_CHARS', async () => {
      const huge = 'X'.repeat(60_000);
      const buf = Buffer.from(huge, 'utf-8');
      const result = await parseCv('cv.txt', buf);
      expect(result.truncated).toBe(true);
      expect(result.charCount).toBeLessThanOrEqual(51_000);
    });

    it('does not truncate small files', async () => {
      const buf = Buffer.from('short cv', 'utf-8');
      const result = await parseCv('cv.txt', buf);
      expect(result.truncated).toBe(false);
      expect(result.charCount).toBe('short cv'.length);
    });
  });
});