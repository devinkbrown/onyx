// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  DISCORD_PACKAGE_MAX_AGGREGATE_BYTES,
  DISCORD_PACKAGE_MAX_FILE_BYTES,
  DISCORD_PACKAGE_MAX_SELECTED_FILES,
  GENERIC_JSON_MAX_AGGREGATE_BYTES,
  GENERIC_JSON_MAX_FILE_BYTES,
  GENERIC_JSON_MAX_FILES,
  IRC_LOG_MAX_AGGREGATE_BYTES,
  IRC_LOG_MAX_FILE_BYTES,
  IRC_LOG_MAX_FILES,
  PORTABLE_JSON_MAX_AGGREGATE_BYTES,
  PORTABLE_JSON_MAX_FILE_BYTES,
  PORTABLE_JSON_MAX_FILES,
  validateImportFileSelection,
  type ImportFileLimits,
} from './importFileLimits';

const sized = (name: string, size: number): Pick<File, 'name' | 'size'> => ({ name, size });

function expectAccepted(files: Array<Pick<File, 'name' | 'size'>>, limits: ImportFileLimits): void {
  expect(validateImportFileSelection(files, limits)).toBeNull();
}

describe('import file memory limits', () => {
  it('accepts exact per-file, aggregate, and selected-count boundaries', () => {
    expectAccepted(
      ['a.json', 'b.json', 'c.json'].map(name => sized(name, GENERIC_JSON_MAX_FILE_BYTES)),
      {
        maxFiles: GENERIC_JSON_MAX_FILES,
        maxFileBytes: GENERIC_JSON_MAX_FILE_BYTES,
        maxAggregateBytes: GENERIC_JSON_MAX_AGGREGATE_BYTES,
      },
    );
    expectAccepted([sized('portable.json', PORTABLE_JSON_MAX_FILE_BYTES)], {
      maxFiles: PORTABLE_JSON_MAX_FILES,
      maxFileBytes: PORTABLE_JSON_MAX_FILE_BYTES,
      maxAggregateBytes: PORTABLE_JSON_MAX_AGGREGATE_BYTES,
    });
    expectAccepted([sized('irc.log', IRC_LOG_MAX_FILE_BYTES)], {
      maxFiles: IRC_LOG_MAX_FILES,
      maxFileBytes: IRC_LOG_MAX_FILE_BYTES,
      maxAggregateBytes: IRC_LOG_MAX_AGGREGATE_BYTES,
    });
    expectAccepted(
      [sized('messages-a.json', DISCORD_PACKAGE_MAX_FILE_BYTES), sized('messages-b.json', DISCORD_PACKAGE_MAX_FILE_BYTES)],
      {
        maxFiles: DISCORD_PACKAGE_MAX_SELECTED_FILES,
        maxFileBytes: DISCORD_PACKAGE_MAX_FILE_BYTES,
        maxAggregateBytes: DISCORD_PACKAGE_MAX_AGGREGATE_BYTES,
      },
    );
    expectAccepted(
      Array.from({ length: DISCORD_PACKAGE_MAX_SELECTED_FILES }, (_, index) => sized(`${index}.ignored`, 0)),
      {
        maxFiles: DISCORD_PACKAGE_MAX_SELECTED_FILES,
        maxFileBytes: DISCORD_PACKAGE_MAX_FILE_BYTES,
        maxAggregateBytes: DISCORD_PACKAGE_MAX_AGGREGATE_BYTES,
      },
    );
  });

  it('rejects one byte or one file beyond each configured boundary', () => {
    const limits = { maxFiles: 2, maxFileBytes: 10, maxAggregateBytes: 20 };
    expect(validateImportFileSelection([sized('a', 1), sized('b', 1), sized('c', 1)], limits)).toEqual({
      kind: 'count',
      maxFiles: 2,
    });
    expect(validateImportFileSelection([sized('large', 11)], limits)).toEqual({
      kind: 'file',
      fileName: 'large',
      maxFileBytes: 10,
    });
    expect(validateImportFileSelection([sized('a', 10), sized('b', 10), sized('c', 1)], { ...limits, maxFiles: 3 })).toEqual({
      kind: 'aggregate',
      maxAggregateBytes: 20,
    });
  });
});
