export type BlockKitLiteButton = {
  label: string;
  url: string | null;
  value: string | null;
};

export type BlockKitLiteSelect = {
  label: string;
  options: Array<{ label: string; value: string }>;
};

export type BlockKitLiteField = {
  label: string;
  value: string;
};

export type BlockKitLiteBlock = {
  title: string | null;
  text: string | null;
  buttons: BlockKitLiteButton[];
  selects: BlockKitLiteSelect[];
  fields: BlockKitLiteField[];
};

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
      return [{ label: optionLabel, value: trimText(optionSource.value, 80) ?? optionLabel }];
    });
    return options.length > 0 ? [{ label, options }] : [];
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
    const block = {
      title: trimText(parsed.title, 80),
      text: trimText(parsed.text),
      buttons: readButtons(parsed.buttons),
      selects: readSelects(parsed.selects),
      fields: readFields(parsed.fields),
    };
    if (!block.title && !block.text && block.buttons.length === 0 && block.selects.length === 0 && block.fields.length === 0) {
      return null;
    }
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
