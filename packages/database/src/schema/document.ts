import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { candidateProfiles } from './candidate.js';

export const candidateDocuments = sqliteTable('candidate_documents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  profileId: integer('profile_id').notNull().references(() => candidateProfiles.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['cv_pdf', 'cv_docx', 'generated_pdf', 'generated_docx'] }).notNull(),
  fileHash: text('file_hash').notNull(),
  storagePath: text('storage_path').notNull(),
  mimeType: text('mime_type'),
  sizeBytes: integer('size_bytes'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  hashKindUnique: uniqueIndex('documents_hash_kind_unique').on(t.fileHash, t.kind),
}));
