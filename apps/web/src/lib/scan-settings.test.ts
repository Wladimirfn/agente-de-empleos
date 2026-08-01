import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCAN_INTERVAL_MINUTES,
  MAX_SCAN_INTERVAL_MINUTES,
  MIN_SCAN_INTERVAL_MINUTES,
  parseScanSettingsInput,
  toScanSettingsDto,
} from './scan-settings.js';

describe('scan settings parsing', () => {
  it('accepts a valid interval and defaults enabled to true', () => {
    expect(parseScanSettingsInput({ intervalMinutes: 60 })).toEqual({
      ok: true,
      value: { intervalMinutes: 60, autoScanEnabled: true },
    });
  });

  it('accepts disabling the auto scan', () => {
    expect(parseScanSettingsInput({ intervalMinutes: 30, autoScanEnabled: false })).toEqual({
      ok: true,
      value: { intervalMinutes: 30, autoScanEnabled: false },
    });
  });

  it('rejects intervals outside the allowed bounds', () => {
    const expected = `Interval must be an integer between ${MIN_SCAN_INTERVAL_MINUTES} and ${MAX_SCAN_INTERVAL_MINUTES} minutes`;
    expect(parseScanSettingsInput({ intervalMinutes: 1 })).toEqual({ ok: false, error: expected });
    expect(parseScanSettingsInput({ intervalMinutes: 20000 })).toEqual({ ok: false, error: expected });
    expect(parseScanSettingsInput({ intervalMinutes: 30.5 })).toEqual({ ok: false, error: expected });
    expect(parseScanSettingsInput({ intervalMinutes: '30' })).toEqual({ ok: false, error: expected });
  });

  it('rejects unknown fields instead of ignoring them', () => {
    expect(parseScanSettingsInput({ intervalMinutes: 30, cronExpr: '* * * * *' })).toEqual({
      ok: false,
      error: 'Unknown field: cronExpr',
    });
  });

  it('rejects a non-boolean autoScanEnabled', () => {
    expect(parseScanSettingsInput({ intervalMinutes: 30, autoScanEnabled: 'yes' })).toEqual({
      ok: false,
      error: 'autoScanEnabled must be a boolean',
    });
  });

  it('reports defaults honestly when no row is stored', () => {
    expect(toScanSettingsDto(null)).toEqual({
      intervalMinutes: DEFAULT_SCAN_INTERVAL_MINUTES,
      autoScanEnabled: true,
      updatedAt: null,
    });
  });

  it('maps a stored row to boolean enabled flag', () => {
    expect(toScanSettingsDto({
      scanIntervalMinutes: 120,
      autoScanEnabled: 0,
      updatedAt: '2026-08-01 10:00:00',
    })).toEqual({
      intervalMinutes: 120,
      autoScanEnabled: false,
      updatedAt: '2026-08-01 10:00:00',
    });
  });
});
