// SPDX-License-Identifier: AGPL-3.0-or-later
import { createMemo, splitProps, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  joinLayoutClass,
  resolveAlign,
  resolveJustify,
  resolveLayoutAs,
  resolveSpace,
  type LayoutAlign,
  type LayoutAs,
  type LayoutJustify,
  type LayoutSpace,
} from './Frame';

export type SplitRatio = 'equal' | 'start' | 'end';
export type SplitCollapse = 'sm' | 'md' | 'lg';

const RATIO_SET = new Set<string>(['equal', 'start', 'end']);
const COLLAPSE_SET = new Set<string>(['sm', 'md', 'lg']);

function resolveRatio(value: unknown): SplitRatio {
  return typeof value === 'string' && RATIO_SET.has(value) ? (value as SplitRatio) : 'equal';
}

function resolveCollapse(value: unknown): SplitCollapse {
  return typeof value === 'string' && COLLAPSE_SET.has(value) ? (value as SplitCollapse) : 'md';
}

export type SplitProps = JSX.HTMLAttributes<HTMLElement> & {
  as?: LayoutAs;
  gap?: LayoutSpace;
  align?: LayoutAlign;
  justify?: LayoutJustify;
  ratio?: SplitRatio;
  collapse?: SplitCollapse;
};

export function Split(props: SplitProps) {
  const [local, rest] = splitProps(props, [
    'as',
    'gap',
    'align',
    'justify',
    'ratio',
    'collapse',
    'class',
    'children',
  ]);

  const tag = createMemo(() => resolveLayoutAs(local.as));
  const gap = createMemo(() => resolveSpace(local.gap, '4'));
  const align = createMemo(() => resolveAlign(local.align));
  const justify = createMemo(() => resolveJustify(local.justify));
  const ratio = createMemo(() => resolveRatio(local.ratio));
  const collapse = createMemo(() => resolveCollapse(local.collapse));
  const className = createMemo(() => joinLayoutClass('ui-layout', 'ui-split', local.class));

  return (
    <Dynamic
      component={tag()}
      {...rest}
      class={className()}
      data-ui="split"
      data-gap={gap()}
      data-align={align()}
      data-justify={justify()}
      data-ratio={ratio()}
      data-collapse={collapse()}
    >
      {local.children}
    </Dynamic>
  );
}
