import { describe, it, expect } from 'vitest';
import { PATHS } from '../src/paths.js';

describe('PATHS', () => {
  it('resolves absolute paths from cwd', () => {
    expect(PATHS.DATA_DIR).toMatch(/data$/);
    expect(PATHS.STORAGE_DIR).toMatch(/storage$/);
    expect(PATHS.DB_PATH).toMatch(/employment-agent\.db$/);
  });

  it('has expected subdirectories', () => {
    expect(PATHS.CURRICULUM_DIR).toContain('curriculum');
    expect(PATHS.GENERATED_DIR).toContain('generated');
    expect(PATHS.LOGS_DIR).toContain('logs');
  });
});
