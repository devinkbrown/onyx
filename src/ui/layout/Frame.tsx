// SPDX-License-Identifier: AGPL-3.0-or-later
import { createMemo, splitProps, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';

export const LAYOUT_AS = [
  'div',
  'section',
  'article',
  'aside',
  'main',
  'nav',
  'header',
  'footer',
  'ul',
  'ol',
  'li',
  'form',
  'fieldset',
  'span',
] as const;

export type LayoutAs = (typeof LAYOUT_AS)[number];
export type LayoutSpace = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';
export type LayoutAlign = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
export type LayoutJustify = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';

const LAYOUT_AS_SET = new Set<string>(LAYOUT_AS);
const SPACE_SET = new Set<string>(['0', '1', '2', '3', '4', '5', '6', '7', '8']);
const ALIGN_SET = new Set<string>(['start', 'center', 'end', 'stretch', 'baseline']);
const JUSTIFY_SET = new Set<string>(['start', 'center', 'end', 'between', 'around', 'evenly']);

export function resolveLayoutAs(value: unknown): LayoutAs {
  return typeof value === 'string' && LAYOUT_AS_SET.has(value) ? (value as LayoutAs) : 'div';
}

export function resolveSpace(value: unknown, fallback: LayoutSpace): LayoutSpace {
  const token = typeof value === 'number' && Number.isInteger(value) ? String(value) : value;
  return typeof token === 'string' && SPACE_SET.has(token) ? (token as LayoutSpace) : fallback;
}

export function resolveAlign(value: unknown): LayoutAlign | undefined {
  return typeof value === 'string' && ALIGN_SET.has(value) ? (value as LayoutAlign) : undefined;
}

export function resolveJustify(value: unknown): LayoutJustify | undefined {
  return typeof value === 'string' && JUSTIFY_SET.has(value) ? (value as LayoutJustify) : undefined;
}

export function joinLayoutClass(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export type FrameProps = JSX.HTMLAttributes<HTMLElement> & {
  as?: LayoutAs;
  pad?: LayoutSpace;
  gap?: LayoutSpace;
  align?: LayoutAlign;
  justify?: LayoutJustify;
  measure?: boolean;
};

export function Frame(props: FrameProps) {
  const [local, rest] = splitProps(props, [
    'as',
    'pad',
    'gap',
    'align',
    'justify',
    'measure',
    'class',
    'children',
  ]);

  const tag = createMemo(() => resolveLayoutAs(local.as));
  const pad = createMemo(() => resolveSpace(local.pad, '0'));
  const gap = createMemo(() => (local.gap === undefined ? undefined : resolveSpace(local.gap, '0')));
  const align = createMemo(() => resolveAlign(local.align));
  const justify = createMemo(() => resolveJustify(local.justify));
  const measure = createMemo(() => local.measure === true);
  const className = createMemo(() => joinLayoutClass('ui-layout', 'ui-frame', local.class));

  return (
    <Dynamic
      component={tag()}
      {...rest}
      class={className()}
      data-ui="frame"
      data-pad={pad()}
      data-gap={gap()}
      data-align={align()}
      data-justify={justify()}
      data-measure={measure() ? '' : undefined}
    >
      {local.children}
    </Dynamic>
  );
}
