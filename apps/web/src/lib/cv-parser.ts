/**
 * Parser de CVs: PDF, DOCX y texto plano.
 *
 * Responsabilidad: convertir bytes en texto extraído + hints básicos
 * (email, teléfono, nombre tentativo).
 *
 * NO estructura el CV completo. El usuario revisa y corrige en el form.
 * Esto respeta el invariante no-fabrication: cualquier dato que vaya a
 * candidate_profiles debe ser confirmado por el humano.
 */

import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

export type SupportedMime = 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' | 'text/plain';

export interface ParsedCv {
  fullText: string;
  filename: string;
  mime: SupportedMime;
  hints: {
    email: string | null;
    phone: string | null;
    name: string | null;
  };
  /** Métrica: caracteres extraídos. Útil para detectar parseos fallidos. */
  charCount: number;
  /** Truncado aplicado (si el texto crudo superaba el máximo). */
  truncated: boolean;
}

const MAX_CHARS = 50_000;

export class CvParseError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = 'CvParseError';
  }
}

function detectMime(filename: string, declaredMime?: string): SupportedMime {
  if (declaredMime === 'application/pdf') return 'application/pdf';
  if (declaredMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (declaredMime === 'text/plain') return 'text/plain';
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === 'txt' || ext === 'md') return 'text/plain';
  throw new CvParseError(`Formato no soportado: ${filename} (mime=${declaredMime ?? 'desconocido'})`);
}

async function extractFromPdf(buffer: Buffer): Promise<string> {
  // pdf-parse 2.x expone la clase PDFParse con getText() para extracción.
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function extractFromDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function extractFromText(buffer: Buffer): Promise<string> {
  // El CV puede estar en UTF-8 o Latin-1. Probamos UTF-8 primero y caemos.
  try {
    const asUtf8 = buffer.toString('utf-8');
    // Heurística barata: si tiene caracteres de reemplazo o secuencias inválidas,
    // probablemente no es UTF-8 puro. Probamos Latin-1 como fallback.
    if (asUtf8.includes('\uFFFD')) {
      return buffer.toString('latin1');
    }
    return asUtf8;
  } catch {
    return buffer.toString('latin1');
  }
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(\+?\d{1,3}[\s.-]?)?(\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}/g;

function extractHints(text: string): { email: string | null; phone: string | null; name: string | null } {
  const emailMatch = text.match(EMAIL_RE);
  const phoneCandidate = text.match(PHONE_RE);
  let phone: string | null = null;
  if (phoneCandidate) {
    // Tomamos el primer match que tenga al menos 8 dígitos.
    for (const m of phoneCandidate) {
      const digits = m.replace(/\D/g, '');
      if (digits.length >= 8 && digits.length <= 15) {
        phone = m.trim();
        break;
      }
    }
  }

  // El nombre suele estar en las primeras líneas no vacías, en mayúsculas o
  // como título. Tomamos la primera línea con 2-5 palabras que no sea email/tel.
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 10);
  let name: string | null = null;
  for (const line of lines) {
    if (line.length > 60) continue;
    const words = line.split(/\s+/);
    if (words.length < 2 || words.length > 5) continue;
    if (EMAIL_RE.test(line) || /\d{4,}/.test(line)) continue;
    if (/[@:/\\]/.test(line)) continue;
    // OK candidato.
    EMAIL_RE.lastIndex = 0;
    name = line;
    break;
  }

  return {
    email: emailMatch?.[0] ?? null,
    phone,
    name,
  };
}

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_CHARS) + '\n\n[... truncado a ' + MAX_CHARS + ' caracteres ...]', truncated: true };
}

export async function parseCv(filename: string, buffer: Buffer, declaredMime?: string): Promise<ParsedCv> {
  const mime = detectMime(filename, declaredMime);
  let raw: string;
  try {
    switch (mime) {
      case 'application/pdf':
        raw = await extractFromPdf(buffer);
        break;
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        raw = await extractFromDocx(buffer);
        break;
      case 'text/plain':
        raw = await extractFromText(buffer);
        break;
    }
  } catch (err) {
    throw new CvParseError(`Falló el parsing de ${filename} (${mime})`, err);
  }

  const normalized = raw.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
  const { text: fullText, truncated } = truncate(normalized);
  const hints = extractHints(fullText);

  return {
    fullText,
    filename,
    mime,
    hints,
    charCount: fullText.length,
    truncated,
  };
}