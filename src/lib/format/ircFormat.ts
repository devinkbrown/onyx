/**
 * ircFormat.ts — parse mIRC / IRC control codes into styled text runs.
 *
 * IRC messages carry inline formatting as C0 control bytes, not markup:
 *   0x02 (^B)  bold          0x1D (^])  italic        0x1F (^_)  underline
 *   0x1E (^^)  strikethrough  0x11 (^Q)  monospace     0x16 (^V)  reverse
 *   0x0F (^O)  reset          0x03 (^C)  colour  fg[,bg]  (1-2 decimal digits)
 *   0x04 (^D)  hex colour  RRGGBB[,RRGGBB]
 *
 * Formatting is STATEFUL: a code toggles (or sets) a style that persists until
 * toggled again or reset. We walk the string once, maintain the current style,
 * and emit a run whenever the style changes — stripping the control bytes from
 * the visible text.
 *
 * SECURITY: colours resolve to a fixed palette or a strictly-validated 6-hex
 * value — never arbitrary text — so the renderer can place them in a `color:`
 * style without any injection surface. This module produces data only.
 */

/** Resolved style for a run of text. Absent fields mean "inherit/default". */
export interface IrcStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  monospace?: boolean;
  /** reverse video — the renderer swaps fg/bg. */
  reverse?: boolean;
  /** foreground colour as `#rrggbb` (palette- or hex-resolved). */
  fg?: string;
  /** background colour as `#rrggbb`. */
  bg?: string;
}

/** A contiguous run of text sharing one resolved style. */
export interface IrcRun {
  text: string;
  style: IrcStyle;
}

// ── Control bytes ───────────────────────────────────────────────────────────

const CTRL_BOLD = 0x02;
const CTRL_COLOR = 0x03;
const CTRL_HEX = 0x04;
const CTRL_RESET = 0x0f;
const CTRL_MONO = 0x11;
const CTRL_REVERSE = 0x16;
const CTRL_ITALIC = 0x1d;
const CTRL_STRIKE = 0x1e;
const CTRL_UNDERLINE = 0x1f;

/**
 * The mIRC 99-colour palette (indices 0–98). Index 99 (and anything out of
 * range) means "default colour" → undefined. Codes 0–15 are the classic set;
 * 16–98 are the extended table standardised by modern IRC clients.
 */
const MIRC_PALETTE: readonly string[] = [
  '#ffffff', '#000000', '#00007f', '#009300', '#ff0000', '#7f0000', '#9c009c', '#fc7f00',
  '#ffff00', '#00fc00', '#009393', '#00ffff', '#0000fc', '#ff00ff', '#7f7f7f', '#d2d2d2',
  '#470000', '#472100', '#474700', '#324700', '#004700', '#00472c', '#004747', '#002747',
  '#000047', '#2e0047', '#470047', '#47002a', '#740000', '#743a00', '#747400', '#517400',
  '#007400', '#007449', '#007474', '#004074', '#000074', '#4b0074', '#740074', '#740045',
  '#b50000', '#b56300', '#b5b500', '#7db500', '#00b500', '#00b571', '#00b5b5', '#0063b5',
  '#0000b5', '#7500b5', '#b500b5', '#b5006b', '#ff0000', '#ff8c00', '#ffff00', '#b2ff00',
  '#00ff00', '#00ffa0', '#00ffff', '#008cff', '#0000ff', '#a500ff', '#ff00ff', '#ff0098',
  '#ff5959', '#ffb459', '#ffff71', '#cfff60', '#6fff6f', '#65ffc9', '#6dffff', '#59b4ff',
  '#5959ff', '#c459ff', '#ff66ff', '#ff59bc', '#ff9c9c', '#ffd39c', '#ffff9c', '#e2ff9c',
  '#9cff9c', '#9cffdb', '#9cffff', '#9cd3ff', '#9c9cff', '#dc9cff', '#ff9cff', '#ff94d3',
  '#000000', '#131313', '#282828', '#363636', '#4d4d4d', '#656565', '#818181', '#9f9f9f',
  '#bcbcbc', '#e2e2e2', '#ffffff',
];

/** Resolve a mIRC colour index to a hex string, or undefined for default. */
function paletteColor(index: number): string | undefined {
  return MIRC_PALETTE[index];
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

function isHex(ch: string | undefined): boolean {
  return ch !== undefined && /[0-9a-fA-F]/.test(ch);
}

/** True when a style carries no visible formatting (a plain text run). */
export function isDefaultStyle(style: IrcStyle): boolean {
  return (
    !style.bold &&
    !style.italic &&
    !style.underline &&
    !style.strike &&
    !style.monospace &&
    !style.reverse &&
    style.fg === undefined &&
    style.bg === undefined
  );
}

/** Fast check: does this text contain any IRC formatting control bytes? */
export function hasIrcFormatting(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (
      c === CTRL_BOLD || c === CTRL_COLOR || c === CTRL_HEX || c === CTRL_RESET ||
      c === CTRL_MONO || c === CTRL_REVERSE || c === CTRL_ITALIC || c === CTRL_STRIKE ||
      c === CTRL_UNDERLINE
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Split `text` into styled runs, threading `inStyle` as the starting state.
 *
 * Returns the runs (control bytes stripped) and the trailing style `out`, so a
 * caller can carry formatting across newline-split lines of one message.
 */
export function parseIrcRuns(text: string, inStyle: IrcStyle = {}): { runs: IrcRun[]; out: IrcStyle } {
  const runs: IrcRun[] = [];
  let style: IrcStyle = { ...inStyle };
  let buf = '';

  const flush = (): void => {
    if (buf) {
      runs.push({ text: buf, style: { ...style } });
      buf = '';
    }
  };

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);

    switch (code) {
      case CTRL_BOLD:      flush(); style.bold = !style.bold; break;
      case CTRL_ITALIC:    flush(); style.italic = !style.italic; break;
      case CTRL_UNDERLINE: flush(); style.underline = !style.underline; break;
      case CTRL_STRIKE:    flush(); style.strike = !style.strike; break;
      case CTRL_MONO:      flush(); style.monospace = !style.monospace; break;
      case CTRL_REVERSE:   flush(); style.reverse = !style.reverse; break;
      case CTRL_RESET:     flush(); style = {}; break;

      case CTRL_COLOR: {
        flush();
        // Read up to two decimal digits for fg, optional ",bg".
        let j = i + 1;
        let fg = '';
        while (fg.length < 2 && isDigit(text[j])) { fg += text[j]; j++; }
        if (fg === '') {
          // ^C with no digits → clear colours.
          style = { ...style, fg: undefined, bg: undefined };
        } else {
          let bg = '';
          if (text[j] === ',' && isDigit(text[j + 1])) {
            let k = j + 1;
            while (bg.length < 2 && isDigit(text[k])) { bg += text[k]; k++; }
            j = k;
          }
          style = { ...style, fg: paletteColor(parseInt(fg, 10)) };
          if (bg !== '') style.bg = paletteColor(parseInt(bg, 10));
        }
        i = j - 1;
        break;
      }

      case CTRL_HEX: {
        flush();
        let j = i + 1;
        let fg = '';
        while (fg.length < 6 && isHex(text[j])) { fg += text[j]; j++; }
        if (fg.length < 6) {
          // Malformed / bare ^D → clear colours, consume the digits seen.
          style = { ...style, fg: undefined, bg: undefined };
        } else {
          style = { ...style, fg: `#${fg.toLowerCase()}` };
          if (text[j] === ',') {
            let bg = '';
            let k = j + 1;
            while (bg.length < 6 && isHex(text[k])) { bg += text[k]; k++; }
            if (bg.length === 6) { style.bg = `#${bg.toLowerCase()}`; j = k; }
          }
        }
        i = j - 1;
        break;
      }

      default:
        buf += text[i];
    }
  }

  flush();
  return { runs, out: style };
}
