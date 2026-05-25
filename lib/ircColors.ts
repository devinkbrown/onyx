// mIRC color and formatting code parser

export interface TextSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  monospace?: boolean;
  fg?: string; // CSS color
  bg?: string; // CSS color
}

// mIRC 16-color palette (0–15) plus extended colors 16–98
const MIRC_COLORS: Record<number, string> = {
  0:  '#ffffff',
  1:  '#000000',
  2:  '#00007f',
  3:  '#009300',
  4:  '#ff0000',
  5:  '#7f0000',
  6:  '#9c009c',
  7:  '#fc7f00',
  8:  '#ffff00',
  9:  '#00fc00',
  10: '#009393',
  11: '#00ffff',
  12: '#0000fc',
  13: '#ff00ff',
  14: '#7f7f7f',
  15: '#d2d2d2',
  // Extended mIRC colors 16–98 (the 16-color "cube" + grays)
  16: '#470000', 17: '#472100', 18: '#474700', 19: '#324700',
  20: '#004700', 21: '#00472c', 22: '#004747', 23: '#002747',
  24: '#000047', 25: '#2e0047', 26: '#470047', 27: '#47002a',
  28: '#740000', 29: '#743a00', 30: '#747400', 31: '#517400',
  32: '#007400', 33: '#007449', 34: '#007474', 35: '#004074',
  36: '#000074', 37: '#4b0074', 38: '#740074', 39: '#740045',
  40: '#b50000', 41: '#b56300', 42: '#b5b500', 43: '#7db500',
  44: '#00b500', 45: '#00b571', 46: '#00b5b5', 47: '#0063b5',
  48: '#0000b5', 49: '#7500b5', 50: '#b500b5', 51: '#b5006b',
  52: '#ff0000', 53: '#ff8c00', 54: '#ffff00', 55: '#b2ff00',
  56: '#00ff00', 57: '#00ffa0', 58: '#00ffff', 59: '#008cff',
  60: '#0000ff', 61: '#a500ff', 62: '#ff00ff', 63: '#ff0098',
  64: '#ff5959', 65: '#ffb459', 66: '#ffff71', 67: '#cfff60',
  68: '#6fff6f', 69: '#65ffc9', 70: '#6dffff', 71: '#59b4ff',
  72: '#5959ff', 73: '#c459ff', 74: '#ff66ff', 75: '#ff59bc',
  76: '#ff9c9c', 77: '#ffd39c', 78: '#ffff9c', 79: '#e2ff9c',
  80: '#9cff9c', 81: '#9cffdb', 82: '#9cffff', 83: '#9cd3ff',
  84: '#9c9cff', 85: '#dc9cff', 86: '#ff9cff', 87: '#ff94d3',
  88: '#000000', 89: '#131313', 90: '#282828', 91: '#363636',
  92: '#4d4d4d', 93: '#656565', 94: '#818181', 95: '#9f9f9f',
  96: '#bcbcbc', 97: '#e2e2e2', 98: '#ffffff',
};

function mircColor(index: number): string | undefined {
  return MIRC_COLORS[index];
}

interface FormatState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  monospace: boolean;
  fg: string | undefined;
  bg: string | undefined;
}

function cloneState(s: FormatState): FormatState {
  return { ...s };
}

function resetState(): FormatState {
  return {
    bold: false, italic: false, underline: false,
    strike: false, monospace: false,
    fg: undefined, bg: undefined,
  };
}

function stateToSpanProps(s: FormatState): Omit<TextSpan, 'text'> {
  return {
    bold: s.bold || undefined,
    italic: s.italic || undefined,
    underline: s.underline || undefined,
    strike: s.strike || undefined,
    monospace: s.monospace || undefined,
    fg: s.fg,
    bg: s.bg,
  };
}

/**
 * Parse a raw IRC-formatted string into an array of TextSpans.
 * Handles: \x02 bold, \x1D italic, \x1F underline, \x1E strikethrough,
 *          \x11 monospace, \x16 reverse, \x0F reset,
 *          \x03[fg][,bg] mIRC color, \x04RRGGBB hex color.
 */
export function parseIrcFormatting(raw: string): TextSpan[] {
  const spans: TextSpan[] = [];
  let state = resetState();
  let buf = '';
  let i = 0;

  const flush = () => {
    if (buf.length > 0) {
      spans.push({ text: buf, ...stateToSpanProps(state) });
      buf = '';
    }
  };

  while (i < raw.length) {
    const ch = raw[i];
    const code = raw.charCodeAt(i);

    switch (code) {
      case 0x02: { // Bold
        flush();
        state = cloneState(state);
        state.bold = !state.bold;
        i++;
        break;
      }
      case 0x1D: { // Italic
        flush();
        state = cloneState(state);
        state.italic = !state.italic;
        i++;
        break;
      }
      case 0x1F: { // Underline
        flush();
        state = cloneState(state);
        state.underline = !state.underline;
        i++;
        break;
      }
      case 0x1E: { // Strikethrough
        flush();
        state = cloneState(state);
        state.strike = !state.strike;
        i++;
        break;
      }
      case 0x11: { // Monospace
        flush();
        state = cloneState(state);
        state.monospace = !state.monospace;
        i++;
        break;
      }
      case 0x16: { // Reverse (swap fg/bg)
        flush();
        state = cloneState(state);
        const tmpFg = state.fg;
        state.fg = state.bg;
        state.bg = tmpFg;
        i++;
        break;
      }
      case 0x0F: { // Reset all formatting
        flush();
        state = resetState();
        i++;
        break;
      }
      case 0x03: { // mIRC color
        flush();
        state = cloneState(state);
        i++; // skip \x03

        // Parse optional fg color (1 or 2 digits)
        let fgStr = '';
        if (i < raw.length && /\d/.test(raw[i])) {
          fgStr += raw[i++];
          if (i < raw.length && /\d/.test(raw[i])) {
            fgStr += raw[i++];
          }
        }

        // Parse optional ,bg color (1 or 2 digits)
        let bgStr = '';
        if (i < raw.length && raw[i] === ',') {
          i++; // skip comma
          if (i < raw.length && /\d/.test(raw[i])) {
            bgStr += raw[i++];
            if (i < raw.length && /\d/.test(raw[i])) {
              bgStr += raw[i++];
            }
          } else {
            // Comma without digits — back up, comma was literal
            i--;
          }
        }

        if (fgStr === '' && bgStr === '') {
          // Bare \x03 resets colors
          state.fg = undefined;
          state.bg = undefined;
        } else {
          if (fgStr !== '') state.fg = mircColor(parseInt(fgStr, 10));
          if (bgStr !== '') state.bg = mircColor(parseInt(bgStr, 10));
        }
        break;
      }
      case 0x04: { // Hex color \x04RRGGBB
        flush();
        state = cloneState(state);
        i++; // skip \x04
        const hex = raw.slice(i, i + 6);
        if (/^[0-9a-fA-F]{6}$/.test(hex)) {
          state.fg = `#${hex}`;
          i += 6;
        }
        // If malformed, just skip the \x04
        break;
      }
      default: {
        buf += ch;
        i++;
        break;
      }
    }
  }

  flush();

  // Merge adjacent spans with identical formatting
  return mergeSpans(spans);
}

function mergeSpans(spans: TextSpan[]): TextSpan[] {
  const result: TextSpan[] = [];
  for (const span of spans) {
    if (result.length === 0) {
      result.push(span);
      continue;
    }
    const last = result[result.length - 1];
    if (
      last.bold === span.bold &&
      last.italic === span.italic &&
      last.underline === span.underline &&
      last.strike === span.strike &&
      last.monospace === span.monospace &&
      last.fg === span.fg &&
      last.bg === span.bg
    ) {
      result[result.length - 1] = { ...last, text: last.text + span.text };
    } else {
      result.push(span);
    }
  }
  return result;
}

/**
 * Returns true if the text contains any IRC formatting control codes.
 */
export function hasIrcFormatting(text: string): boolean {
  return /[\x02\x03\x04\x0f\x11\x16\x1d\x1e\x1f]/.test(text);
}

/**
 * Strip all IRC formatting control codes from a string, returning plain text.
 * Also strips CTCP ACTION wrapper.
 */
export function stripIrcFormatting(text: string): string {
  return text
    .replace(/\x01ACTION (.+)\x01/, '* $1') // CTCP ACTION
    .replace(/\x03\d{1,2}(,\d{1,2})?/g, '') // mIRC color codes
    .replace(/\x04[0-9a-fA-F]{6}/g, '')      // hex color codes
    .replace(/[\x02\x0f\x11\x16\x1d\x1e\x1f]/g, ''); // other control codes
}
