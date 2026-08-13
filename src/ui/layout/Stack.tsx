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

export type StackProps = JSX.HTMLAttributes<HTMLElement> & {
  as?: LayoutAs;
  gap?: LayoutSpace;
  align?: LayoutAlign;
  justify?: LayoutJustify;
};

export function Stack(props: StackProps) {
  const [local, rest] = splitProps(props, ['as', 'gap', 'align', 'justify', 'class', 'children']);

  const tag = createMemo(() => resolveLayoutAs(local.as));
  const gap = createMemo(() => resolveSpace(local.gap, '3'));
  const align = createMemo(() => resolveAlign(local.align));
  const justify = createMemo(() => resolveJustify(local.justify));
  const className = createMemo(() => joinLayoutClass('ui-layout', 'ui-stack', local.class));

  return (
    <Dynamic
      component={tag()}
      {...rest}
      class={className()}
      data-ui="stack"
      data-gap={gap()}
      data-align={align()}
      data-justify={justify()}
    >
      {local.children}
    </Dynamic>
  );
}
