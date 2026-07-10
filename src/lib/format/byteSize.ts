export interface ByteSizeFormatOptions {
  binary?: boolean;
  precision?: number;
}

const INVALID_BYTE_SIZE = '—';
const DEFAULT_PRECISION = 1;
const MAX_PRECISION = 6;

const DECIMAL_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'] as const;
const BINARY_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'] as const;

function normalizePrecision(precision: number | undefined): number {
  if (precision === undefined || !Number.isFinite(precision)) {
    return DEFAULT_PRECISION;
  }

  return Math.min(MAX_PRECISION, Math.max(0, Math.floor(precision)));
}

function roundToPrecision(value: number, precision: number): number {
  const scale = 10 ** precision;

  return Math.round(value * scale) / scale;
}

function formatRoundedValue(value: number, precision: number): string {
  if (precision === 0) {
    return String(Math.round(value));
  }

  return value.toFixed(precision).replace(/\.?0+$/, '');
}

export function formatBytes(bytes: number, options: ByteSizeFormatOptions = {}): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return INVALID_BYTE_SIZE;
  }

  if (bytes === 0) {
    return '0 B';
  }

  const binary = options.binary === true;
  const base = binary ? 1024 : 1000;
  const units = binary ? BINARY_UNITS : DECIMAL_UNITS;
  const precision = normalizePrecision(options.precision);
  let value = bytes;
  let unitIndex = 0;

  while (value >= base && unitIndex < units.length - 1) {
    value /= base;
    unitIndex += 1;
  }

  let roundedValue = unitIndex === 0 ? Math.round(value) : roundToPrecision(value, precision);

  while (roundedValue >= base && unitIndex < units.length - 1) {
    value = roundedValue / base;
    unitIndex += 1;
    roundedValue = roundToPrecision(value, precision);
  }

  const unit = units[unitIndex]!;
  const formattedValue = unitIndex === 0
    ? String(roundedValue)
    : formatRoundedValue(roundedValue, precision);

  return `${formattedValue} ${unit}`;
}
