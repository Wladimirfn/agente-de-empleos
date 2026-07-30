import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

/**
 * Resuelve la carpeta storage/ en la raíz del monorepo y garantiza que exista.
 * El path es relativo a process.cwd() para que funcione tanto en dev (raíz) como
 * desde apps/web (cuando Astro corre desde la raíz del workspace).
 */
export function storagePath(...segments: string[]): string {
  const root = process.env.STORAGE_PATH ?? path.resolve(process.cwd(), 'storage');
  return path.join(root, ...segments);
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Persiste un archivo en storage/curriculum con un nombre único.
 * Devuelve el path absoluto y el nombre público (con prefijo uuid para evitar
 * colisiones y escapes de path traversal).
 */
export async function saveCurriculum(
  originalFilename: string,
  buffer: Buffer,
): Promise<{ absolutePath: string; storedFilename: string }> {
  const safeName = sanitizeFilename(originalFilename);
  const storedFilename = `${randomUUID()}-${safeName}`;
  const dir = storagePath('curriculum');
  await ensureDir(dir);
  const absolutePath = path.join(dir, storedFilename);
  await fs.writeFile(absolutePath, buffer);
  return { absolutePath, storedFilename };
}

/**
 * Quita caracteres peligrosos del nombre de archivo y limita la longitud.
 * No rechaza archivos sin extensión — eso lo hace el parser.
 */
export function sanitizeFilename(name: string): string {
  const basename = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
  return basename.length > 200 ? basename.slice(-200) : basename || 'unnamed';
}

export const MAX_CV_BYTES = 10 * 1024 * 1024; // 10 MB