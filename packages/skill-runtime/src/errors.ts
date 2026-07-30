export type AppErrorKind = 'validation' | 'not_found' | 'human_intervention' | 'transient' | 'fatal_skill';

export class AppError extends Error {
  readonly kind: AppErrorKind;
  readonly code: string;
  readonly cause?: unknown;

  constructor(message: string, options: { kind: AppErrorKind; code: string; cause?: unknown }) {
    super(message);
    this.name = 'AppError';
    this.kind = options.kind;
    this.code = options.code;
    this.cause = options.cause;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, code = 'VALIDATION_FAILED') {
    super(message, { kind: 'validation', code });
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string | number) {
    super(`${resource}${id !== undefined ? ` ${id}` : ''} not found`, { kind: 'not_found', code: 'NOT_FOUND' });
    this.name = 'NotFoundError';
  }
}

export class HumanInterventionRequired extends AppError {
  constructor(message: string, code = 'HUMAN_INTERVENTION_REQUIRED') {
    super(message, { kind: 'human_intervention', code });
    this.name = 'HumanInterventionRequired';
  }
}

export class TransientSkillError extends AppError {
  constructor(message: string, code = 'TRANSIENT_SKILL_ERROR', cause?: unknown) {
    super(message, { kind: 'transient', code, cause });
    this.name = 'TransientSkillError';
  }
}

export class FatalSkillError extends AppError {
  constructor(message: string, code = 'FATAL_SKILL_ERROR', cause?: unknown) {
    super(message, { kind: 'fatal_skill', code, cause });
    this.name = 'FatalSkillError';
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
