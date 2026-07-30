import type { APIRoute } from 'astro';
import { CvParseError, parseCv, type ParsedCv } from '../../../lib/cv-parser';
import { MAX_CV_BYTES, saveCurriculum } from '../../../lib/storage';

export const prerender = false;

interface UploadSuccess {
  ok: true;
  storedFilename: string;
  parsed: {
    filename: string;
    mime: ParsedCv['mime'];
    charCount: number;
    truncated: boolean;
    hints: ParsedCv['hints'];
    fullText: string;
  };
}

interface UploadFailure {
  ok: false;
  error: string;
}

/**
 * POST /api/cvs/upload (multipart/form-data, campo "file")
 *
 * Persiste el archivo en storage/curriculum/ y devuelve el texto extraído
 * junto con hints básicos (email, phone, name). NO escribe en candidate_profiles
 * ni candidate_documents — el usuario debe revisar y confirmar primero.
 */
export const POST: APIRoute = async ({ request }) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, 'Body inválido: se esperaba multipart/form-data.');
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return fail(400, 'Falta el archivo en el campo "file".');
  }
  if (file.size === 0) {
    return fail(400, 'El archivo está vacío.');
  }
  if (file.size > MAX_CV_BYTES) {
    return fail(413, `Archivo demasiado grande (${file.size} bytes, máx ${MAX_CV_BYTES}).`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const declaredMime = file.type || undefined;

  let stored;
  try {
    stored = await saveCurriculum(file.name, buffer);
  } catch (err) {
    return fail(500, `No se pudo guardar el archivo: ${errMessage(err)}`);
  }

  let parsed;
  try {
    parsed = await parseCv(file.name, buffer, declaredMime);
  } catch (err) {
    if (err instanceof CvParseError) return fail(415, err.message);
    return fail(500, `Falló el parsing: ${errMessage(err)}`);
  }

  const body: UploadSuccess = {
    ok: true,
    storedFilename: stored.storedFilename,
    parsed: {
      filename: parsed.filename,
      mime: parsed.mime,
      charCount: parsed.charCount,
      truncated: parsed.truncated,
      hints: parsed.hints,
      fullText: parsed.fullText,
    },
  };
  return new Response(JSON.stringify(body), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};

function fail(status: number, message: string): Response {
  const body: UploadFailure = { ok: false, error: message };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}