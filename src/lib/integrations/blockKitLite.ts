// SPDX-License-Identifier: AGPL-3.0-or-later
export type BlockKitLiteSendAction = {
  type: 'send';
  target: string;
  value: string;
};

export type BlockKitLiteSelectNotifyAction = {
  type: 'select-notify';
  target: string;
  value: string | null;
};

export type BlockKitLiteAction = BlockKitLiteSendAction | BlockKitLiteSelectNotifyAction;

export type PreparedBlockKitAction = {
  target: string;
  text: string;
};

export type BlockKitLiteButton = {
  label: string;
  url: string | null;
  value: string | null;
  action: BlockKitLiteAction | null;
};

export type BlockKitLiteSelect = {
  label: string;
  options: Array<{ label: string; value: string }>;
  action: BlockKitLiteAction | null;
};

export type BlockKitLiteField = {
  label: string;
  value: string;
};

type BlockKitLiteBaseBlock = {
  title: string | null;
  text: string | null;
  buttons: BlockKitLiteButton[];
  selects: BlockKitLiteSelect[];
  fields: BlockKitLiteField[];
};

export type BlockKitLiteMessageBlock = BlockKitLiteBaseBlock & {
  type: 'message';
};

export type BlockKitLiteModalBlock = BlockKitLiteBaseBlock & {
  type: 'modal';
  title: string;
  triggerLabel: string;
};

export type BlockKitLiteBlock = BlockKitLiteMessageBlock | BlockKitLiteModalBlock;

export type BlockKitLiteExtraction = {
  text: string;
  blocks: BlockKitLiteBlock[];
};

const MARKER = '[onyx:block]';
const MAX_TEXT = 180;
const MAX_BUTTONS = 4;
const MAX_SELECTS = 2;
const MAX_OPTIONS = 8;
const MAX_FIELDS = 6;
const MAX_ACTION_VALUE = 240;
const MAX_TARGET = 80;

function trimText(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function safeUrl(value: unknown): string | null {
  const raw = trimText(value, 500);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function safeTarget(value: unknown): string | null {
  const target = trimText(value, MAX_TARGET);
  if (!target || /[\s,\x00\r\n]/.test(target)) return null;
  if (target.startsWith('#') || target.startsWith('&')) return target;
  return /^[A-Za-z0-9_[\]\\`^{}|][A-Za-z0-9_[\]\\`^{}|.:-]*$/.test(target) ? target : null;
}

function safeActionValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  // Inspect the complete input before bounding it. Truncating first could hide a
  // CRLF payload placed just beyond MAX_ACTION_VALUE from the confirmation-time
  // revalidation pass.
  if (/[\r\n]/.test(normalized) || normalized.startsWith('/')) return null;
  const text = normalized.slice(0, MAX_ACTION_VALUE);
  if (!text) return null;
  return text;
}

/**
 * Revalidate and normalize an attacker-authored action into the exact plaintext
 * a confirmation dialog may preview. Call this once when staging and again at
 * confirmation; only an identical second result is safe to dispatch.
 */
export function prepareBlockKitAction(
  action: BlockKitLiteAction,
  origin: string,
  selectedValue?: string,
): PreparedBlockKitAction | null {
  const normalizedOrigin = safeTarget(origin);
  const normalizedTarget = safeTarget(action.target);
  // The trusted render origin must already be canonical. Never let trimming or
  // normalization turn an otherwise mismatched attacker target into a match.
  if (!normalizedOrigin || normalizedOrigin !== origin || normalizedTarget !== normalizedOrigin) return null;

  let text: string | null;
  if (action.type === 'send') {
    text = safeActionValue(action.value);
  } else if (action.type === 'select-notify') {
    const selected = safeActionValue(selectedValue);
    if (!selected) return null;
    if (action.value === null) {
      text = selected;
    } else {
      const prefix = safeActionValue(action.value);
      if (!prefix) return null;
      text = safeActionValue(`${prefix}: ${selected}`);
    }
  } else {
    return null;
  }

  return text ? { target: normalizedOrigin, text } : null;
}

function readAction(raw: unknown): BlockKitLiteAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const target = safeTarget(source.target);
  if (!target) return null;

  if (source.type === 'send') {
    const value = safeActionValue(source.value);
    return value ? { type: 'send', target, value } : null;
  }

  if (source.type === 'select-notify') {
    return {
      type: 'select-notify',
      target,
      value: safeActionValue(source.value),
    };
  }

  return null;
}

function readButtons(raw: unknown): BlockKitLiteButton[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_BUTTONS).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const source = item as Record<string, unknown>;
    const label = trimText(source.label, 40);
    if (!label) return [];
    return [{
      label,
      url: safeUrl(source.url),
      value: trimText(source.value, 80),
      action: readAction(source.action),
    }];
  });
}

function readSelects(raw: unknown): BlockKitLiteSelect[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_SELECTS).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const source = item as Record<string, unknown>;
    const label = trimText(source.label, 48);
    const optionsRaw = source.options;
    if (!label || !Array.isArray(optionsRaw)) return [];
    const options = optionsRaw.slice(0, MAX_OPTIONS).flatMap((option) => {
      if (!option || typeof option !== 'object') return [];
      const optionSource = option as Record<string, unknown>;
      const optionLabel = trimText(optionSource.label, 48);
      if (!optionLabel) return [];
      // The selected option's value is emitted verbatim as message text on a
      // select-notify, so it must clear the same guard as a send value (no CRLF
      // smuggling, no leading-slash command) — trimText alone did not. Fall back
      // to the label (also guarded), and drop the option if neither is safe.
      const optionValue = safeActionValue(optionSource.value) ?? safeActionValue(optionLabel);
      if (!optionValue) return [];
      return [{ label: optionLabel, value: optionValue }];
    });
    return options.length > 0 ? [{ label, options, action: readAction(source.action) }] : [];
  });
}

function readFields(raw: unknown): BlockKitLiteField[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_FIELDS).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const source = item as Record<string, unknown>;
    const label = trimText(source.label, 48);
    if (!label) return [];
    return [{ label, value: trimText(source.value, 120) ?? '' }];
  });
}

export function parseBlockKitLitePayload(raw: string): BlockKitLiteBlock | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.type !== undefined && parsed.type !== 'message' && parsed.type !== 'modal') return null;
    const type = parsed.type === 'modal' ? 'modal' : 'message';
    const title = trimText(parsed.title, 80);
    const text = trimText(parsed.text);
    const buttons = readButtons(parsed.buttons);
    const selects = readSelects(parsed.selects);
    const fields = readFields(parsed.fields);
    if (!title && !text && buttons.length === 0 && selects.length === 0 && fields.length === 0) {
      return null;
    }
    if (type === 'modal') {
      const modalTitle = title ?? 'Details';
      return {
        type,
        title: modalTitle,
        text,
        buttons,
        selects,
        fields,
        triggerLabel: trimText(parsed.triggerLabel, 48)
          ?? trimText(parsed.trigger_label, 48)
          ?? `Open ${modalTitle}`,
      };
    }
    const block = {
      type,
      title: trimText(parsed.title, 80),
      text,
      buttons,
      selects,
      fields,
    } satisfies BlockKitLiteMessageBlock;
    return block;
  } catch {
    return null;
  }
}

export function extractBlockKitLite(text: string): BlockKitLiteExtraction {
  const blocks: BlockKitLiteBlock[] = [];
  const lines: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith(MARKER)) {
      const parsed = parseBlockKitLitePayload(trimmed.slice(MARKER.length).trim());
      if (parsed) {
        blocks.push(parsed);
        continue;
      }
    }
    lines.push(line);
  }

  return {
    text: lines.join('\n').trimEnd(),
    blocks,
  };
}
