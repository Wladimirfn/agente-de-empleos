import { defineMiddleware } from 'astro:middleware';
import { runMigrations } from '@employment-agent/database';

/**
 * Astro middleware que corre migrations en el primer request.
 * Drizzle migrator es idempotente: las migrations ya aplicadas se saltean.
 */
let migrationsApplied = false;

export const onRequest = defineMiddleware(async (_context, next) => {
  if (!migrationsApplied) {
    try {
      await runMigrations();
      migrationsApplied = true;
    } catch (err) {
      console.error('[middleware] migrations failed:', err);
      // No bloqueamos la request: las rutas que no usan DB siguen funcionando.
    }
  }
  return next();
});