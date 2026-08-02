import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { APIRoute } from 'astro';
import { db } from '@employment-agent/database';
import { candidateDocuments, candidateProfiles, candidateExperiences, candidateSkills } from '@employment-agent/database/schema';
import { eq } from 'drizzle-orm';
import { storagePath } from '../../../lib/storage.js';

export const prerender = false;

interface ConfirmExperience {
  role: string;
  company: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

interface ConfirmSkill {
  name: string;
  years?: number | string;
}

interface ConfirmBody {
  storedFilename: string;
  fullName: string;
  email: string;
  phone: string;
  location: string;
  summary: string;
  experiences?: ConfirmExperience[];
  skills?: ConfirmSkill[];
}

/**
 * POST /api/cvs/confirm (application/json)
 *
 * Recibe el nombre de archivo guardado en /api/cvs/upload + los campos
 * confirmados por el usuario. Crea (o reusa) un candidate_profiles y registra
 * el documento en candidate_documents.
 *
 * Si el archivo guardado ya está registrado (mismo fileHash + kind), es
 * idempotente: no duplica.
 */
export const POST: APIRoute = async ({ request }) => {
  let body: ConfirmBody;
  try {
    body = (await request.json()) as ConfirmBody;
  } catch {
    return fail(400, 'Body inválido: se esperaba JSON.');
  }

  if (!body.storedFilename || typeof body.storedFilename !== 'string') {
    return fail(400, 'Falta storedFilename.');
  }
  // Anti-path-traversal: storedFilename es generado por el server (uuid-prefix),
  // pero validamos igual para no escribir fuera de storage/.
  if (body.storedFilename.includes('..') || body.storedFilename.includes('/')) {
    return fail(400, 'storedFilename inválido.');
  }

  const absolutePath = path.join(storagePath('curriculum'), body.storedFilename);
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(absolutePath);
  } catch {
    return fail(404, `Archivo no encontrado: ${body.storedFilename}`);
  }

  const kind = kindFromFilename(body.storedFilename);
  if (!kind) {
    return fail(415, 'Tipo de archivo no soportado para registro.');
  }

  const fileHash = createHash('sha256').update(buffer).digest('hex');

  // Idempotencia: si ya existe un doc con este hash + kind, no duplicamos.
  const existing = await db
    .select({ id: candidateDocuments.id, profileId: candidateDocuments.profileId })
    .from(candidateDocuments)
    .where(eq(candidateDocuments.fileHash, fileHash))
    .limit(1);

  let profileId: number;
  if (existing.length > 0) {
    return new Response(
      JSON.stringify({ ok: true, documentId: existing[0]!.id, profileId: existing[0]!.profileId, deduped: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Get-or-create primer perfil (single-profile MVP).
  const profiles = await db.select({ id: candidateProfiles.id }).from(candidateProfiles).limit(1);
  if (profiles.length > 0) {
    profileId = profiles[0]!.id;
  } else {
    const inserted = await db
      .insert(candidateProfiles)
      .values({
        fullName: body.fullName || null,
        email: body.email || null,
        phone: body.phone || null,
        location: body.location || null,
        summary: body.summary || null,
      })
      .returning({ id: candidateProfiles.id });
    if (!inserted[0]) return fail(500, 'No se pudo crear el perfil.');
    profileId = inserted[0].id;
  }

  // Si el perfil ya existía pero el user está actualizando campos, los pisamos
  // solo si el user envió un valor. Esto es consistente con "el humano confirma".
  const updateSet: Record<string, string> = {};
  if (body.fullName) updateSet.full_name = body.fullName;
  if (body.email) updateSet.email = body.email;
  if (body.phone) updateSet.phone = body.phone;
  if (body.location) updateSet.location = body.location;
  if (body.summary) updateSet.summary = body.summary;
  if (Object.keys(updateSet).length > 0) {
    await db.update(candidateProfiles).set(updateSet).where(eq(candidateProfiles.id, profileId));
  }

  // Replace experiences: delete old, insert new if provided.
  if (Array.isArray(body.experiences)) {
    await db.delete(candidateExperiences).where(eq(candidateExperiences.profileId, profileId));
    for (const exp of body.experiences) {
      if (exp.role && exp.company) {
        await db.insert(candidateExperiences).values({
          profileId,
          role: exp.role,
          company: exp.company,
          startDate: exp.startDate || null,
          endDate: exp.endDate || null,
          description: exp.description || null,
          source: 'cv-corrected',
        });
      }
    }
  }

  // Replace skills: delete old, insert new if provided.
  if (Array.isArray(body.skills)) {
    await db.delete(candidateSkills).where(eq(candidateSkills.profileId, profileId));
    for (const skill of body.skills) {
      if (skill.name && typeof skill.name === 'string' && skill.name.trim() !== '') {
        const rawYears = skill.years;
        let years: number | null = null;
        if (typeof rawYears === 'number' && Number.isFinite(rawYears)) {
          years = rawYears;
        } else if (typeof rawYears === 'string' && rawYears.trim() !== '') {
          const parsed = Number(rawYears.replace(/[^0-9.]/g, ''));
          if (Number.isFinite(parsed)) years = parsed;
        }
        await db.insert(candidateSkills).values({
          profileId,
          name: skill.name.trim(),
          years,
        });
      }
    }
  }

  const insertedDoc = await db
    .insert(candidateDocuments)
    .values({
      profileId,
      kind,
      fileHash,
      storagePath: absolutePath,
      mimeType: mimeFromKind(kind),
      sizeBytes: buffer.length,
    })
    .returning({ id: candidateDocuments.id });

  if (!insertedDoc[0]) return fail(500, 'No se pudo registrar el documento.');

  return new Response(
    JSON.stringify({ ok: true, documentId: insertedDoc[0].id, profileId }),
    { status: 201, headers: { 'Content-Type': 'application/json' } },
  );
};

function fail(status: number, message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function kindFromFilename(filename: string): 'cv_pdf' | 'cv_docx' | null {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'pdf') return 'cv_pdf';
  if (ext === 'docx') return 'cv_docx';
  return null;
}

function mimeFromKind(kind: 'cv_pdf' | 'cv_docx'): string {
  if (kind === 'cv_pdf') return 'application/pdf';
  return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}