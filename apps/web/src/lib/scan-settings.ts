export const DEFAULT_SCAN_INTERVAL_MINUTES = 30;
export const MIN_SCAN_INTERVAL_MINUTES = 5;
export const MAX_SCAN_INTERVAL_MINUTES = 10080; // 7 días

export interface ScanSettingsInput {
  intervalMinutes: number;
  autoScanEnabled: boolean;
}

interface StoredScanSettings {
  scanIntervalMinutes: number;
  autoScanEnabled: number;
  updatedAt: string;
}

type ParseResult =
  | { ok: true; value: ScanSettingsInput }
  | { ok: false; error: string };

const allowedFields = new Set(['intervalMinutes', 'autoScanEnabled']);

export function parseScanSettingsInput(input: unknown): ParseResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Expected a settings object' };
  }

  const record = input as Record<string, unknown>;
  const unknownField = Object.keys(record).find((field) => !allowedFields.has(field));
  if (unknownField) return { ok: false, error: `Unknown field: ${unknownField}` };

  const interval = record.intervalMinutes;
  if (
    typeof interval !== 'number' ||
    !Number.isInteger(interval) ||
    interval < MIN_SCAN_INTERVAL_MINUTES ||
    interval > MAX_SCAN_INTERVAL_MINUTES
  ) {
    return {
      ok: false,
      error: `Interval must be an integer between ${MIN_SCAN_INTERVAL_MINUTES} and ${MAX_SCAN_INTERVAL_MINUTES} minutes`,
    };
  }

  if (record.autoScanEnabled !== undefined && typeof record.autoScanEnabled !== 'boolean') {
    return { ok: false, error: 'autoScanEnabled must be a boolean' };
  }

  return {
    ok: true,
    value: {
      intervalMinutes: interval,
      autoScanEnabled: record.autoScanEnabled !== false,
    },
  };
}

export function toScanSettingsDto(row: StoredScanSettings | null) {
  if (!row) {
    return {
      intervalMinutes: DEFAULT_SCAN_INTERVAL_MINUTES,
      autoScanEnabled: true,
      updatedAt: null,
    };
  }
  return {
    intervalMinutes: row.scanIntervalMinutes,
    autoScanEnabled: row.autoScanEnabled === 1,
    updatedAt: row.updatedAt,
  };
}
