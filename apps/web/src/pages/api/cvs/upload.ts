import type { APIRoute } from 'astro';
import { CvParseError, parseCv, type ParsedCv } from '../../../lib/cv-parser.js';
import { MAX_CV_BYTES, saveCurriculum } from '../../../lib/storage.js';
import { getActiveAgent } from '../../../lib/agent.js';

export const prerender = false;

interface ParsedHints {
  email: string | null;
  phone: string | null;
  name: string | null;
}

interface ExtractedExperience {
  role: string;
  company: string;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
}

interface ExtractedSkill {
  name: string;
  years: number | null;
}

interface UploadSuccess {
  ok: true;
  storedFilename: string;
  parsed: {
    filename: string;
    mime: ParsedCv['mime'];
    charCount: number;
    truncated: boolean;
    hints: ParsedHints;
    location: string | null;
    summary: string | null;
    experiences: ExtractedExperience[];
    skills: ExtractedSkill[];
    aiAnalyzed: boolean;
    fullText: string;
  };
}

interface UploadFailure {
  ok: false;
  error: string;
}

interface AiExtractionResult {
  name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  summary: string | null;
  experiences: ExtractedExperience[];
  skills: ExtractedSkill[];
}

/**
 * Ask the active LLM provider to extract structured CV data.
 * Returns only what the model found in the text; never fabricates.
 */
async function aiExtractProfile(text: string, provider: { chat: (message: string) => Promise<string> }): Promise<AiExtractionResult> {
  const prompt = `You are a CV parser. Read the following CV text and extract ONLY facts that appear in it.
Return a JSON object. If a field is not present, use null or empty array. Never invent information.

IMPORTANT: All text values (summary, descriptions) MUST be in the SAME LANGUAGE as the CV text.

{
  "name": "Full name (NOT the document title)",
  "email": "Email or null",
  "phone": "Phone number (NOT an ID/RUT number) or null",
  "location": "City and country or null",
  "summary": "1-2 sentence professional summary in the CV's language",
  "experiences": [
    {"role":"Job title","company":"Company name","startDate":"YYYY or null","endDate":"YYYY or null","description":"Brief description in CV's language or null"}
  ],
  "skills": [
    {"name":"Skill name","years":0}
  ]
}

IMPORTANT: Years in skills must be a JSON number, not a string. Use 0 if unknown.

Extract ALL experiences and skills mentioned. Be thorough.

CV text:
---
${text.slice(0, 8000)}
---

Return ONLY the JSON object, no other text.`;

  const raw = await provider.chat(prompt);
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in response');

  const data = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

  const experiencesRaw = Array.isArray(data.experiences) ? data.experiences : [];
  const skillsRaw = Array.isArray(data.skills) ? data.skills : [];

  return {
    name: str(data.name),
    email: str(data.email),
    phone: str(data.phone),
    location: str(data.location),
    summary: str(data.summary),
    experiences: experiencesRaw.map((e: unknown) => {
      const exp = e as Record<string, unknown>;
      return {
        role: typeof exp.role === 'string' ? exp.role : '',
        company: typeof exp.company === 'string' ? exp.company : '',
        startDate: typeof exp.startDate === 'string' ? exp.startDate : null,
        endDate: typeof exp.endDate === 'string' ? exp.endDate : null,
        description: typeof exp.description === 'string' ? exp.description : null,
      };
    }).filter((e: ExtractedExperience) => e.role && e.company),
    skills: skillsRaw.map((s: unknown) => {
      const skill = s as Record<string, unknown>;
      return {
        name: typeof skill.name === 'string' ? skill.name : '',
        years: typeof skill.years === 'number' ? skill.years : null,
      };
    }).filter((s: ExtractedSkill) => s.name),
  };
}

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

  // Try AI extraction for better structured data (name, summary, location).
  // Falls back to regex hints if AI is not active or fails.
  const { provider, status } = await getActiveAgent();
  let aiHints: AiExtractionResult = {
    name: parsed.hints.name,
    email: parsed.hints.email,
    phone: parsed.hints.phone,
    location: null,
    summary: null,
    experiences: [],
    skills: [],
  };
  let aiAnalyzed = false;

  if (status.active) {
    try {
      aiHints = await aiExtractProfile(parsed.fullText, provider);
      aiAnalyzed = true;
    } catch (err) {
      console.error('[cvs/upload] AI extraction failed, using regex hints:', errMessage(err));
    }
  }

  const body: UploadSuccess = {
    ok: true,
    storedFilename: stored.storedFilename,
    parsed: {
      filename: parsed.filename,
      mime: parsed.mime,
      charCount: parsed.charCount,
      truncated: parsed.truncated,
      hints: {
        email: aiHints.email,
        phone: aiHints.phone,
        name: aiHints.name,
      },
      location: aiHints.location,
      summary: aiHints.summary,
      experiences: aiHints.experiences,
      skills: aiHints.skills,
      aiAnalyzed,
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
