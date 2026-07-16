// SPDX-License-Identifier: AGPL-3.0-or-later

const MIB = 1024 * 1024;

/** Multi-file DiscordChatExporter / Slack JSON selection limits. */
export const GENERIC_JSON_MAX_FILES = 256;
export const GENERIC_JSON_MAX_FILE_BYTES = 64 * MIB;
export const GENERIC_JSON_MAX_AGGREGATE_BYTES = 192 * MIB;

/** A portable Onyx vault is one JSON document. */
export const PORTABLE_JSON_MAX_FILES = 1;
export const PORTABLE_JSON_MAX_FILE_BYTES = 64 * MIB;
export const PORTABLE_JSON_MAX_AGGREGATE_BYTES = 64 * MIB;

/** Plain-text logs can be larger than one parsed JSON channel, but remain single-file. */
export const IRC_LOG_MAX_FILES = 1;
export const IRC_LOG_MAX_FILE_BYTES = 128 * MIB;
export const IRC_LOG_MAX_AGGREGATE_BYTES = 128 * MIB;

/** Official packages contain many small files and a bounded set of large channel exports. */
export const DISCORD_PACKAGE_MAX_SELECTED_FILES = 4096;
export const DISCORD_PACKAGE_MAX_FILE_BYTES = 128 * MIB;
export const DISCORD_PACKAGE_MAX_AGGREGATE_BYTES = 256 * MIB;

export type ImportFileLimits = {
  maxFiles: number;
  maxFileBytes: number;
  maxAggregateBytes: number;
};

export type ImportFileLimitFailure =
  | { kind: 'count'; maxFiles: number }
  | { kind: 'file'; fileName: string; maxFileBytes: number }
  | { kind: 'aggregate'; maxAggregateBytes: number };

type SizedFile = Pick<File, 'name' | 'size'>;

/**
 * Validate browser File metadata before any `text()` call. Equality is allowed;
 * callers reject rather than truncate only when a ceiling is exceeded.
 */
export function validateImportFileSelection(
  files: readonly SizedFile[],
  limits: ImportFileLimits,
): ImportFileLimitFailure | null {
  if (files.length > limits.maxFiles) {
    return { kind: 'count', maxFiles: limits.maxFiles };
  }

  let aggregateBytes = 0;
  for (const file of files) {
    // Browser File.size is always a finite non-negative integer. Fail closed for
    // a malformed/polyfilled object instead of letting NaN bypass both bounds.
    const size = Number.isFinite(file.size) && file.size >= 0
      ? file.size
      : limits.maxFileBytes + 1;
    if (size > limits.maxFileBytes) {
      return { kind: 'file', fileName: file.name, maxFileBytes: limits.maxFileBytes };
    }
    aggregateBytes += size;
    if (aggregateBytes > limits.maxAggregateBytes) {
      return { kind: 'aggregate', maxAggregateBytes: limits.maxAggregateBytes };
    }
  }

  return null;
}

export function formatImportMib(bytes: number): string {
  return `${Math.floor(bytes / MIB)} MiB`;
}
