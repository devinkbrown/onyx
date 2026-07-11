// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  createContext,
  createMemo,
  createSignal,
  onCleanup,
  splitProps,
  useContext,
  type Accessor,
  type JSX,
  type ParentProps,
} from 'solid-js';

export type TabsOrientation = 'horizontal' | 'vertical';

export type TabsProps = ParentProps<{
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  orientation?: TabsOrientation;
}>;

export type TabsListProps = JSX.HTMLAttributes<HTMLDivElement>;

export type TabsTriggerProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  value: string;
};

export type TabsContentProps = JSX.HTMLAttributes<HTMLDivElement> & {
  value: string;
};

type TabsContextValue = {
  selected: Accessor<string>;
  setSelected: (value: string) => void;
  orientation: Accessor<TabsOrientation>;
  baseId: string;
  registerTrigger: (trigger: HTMLButtonElement) => void;
  unregisterTrigger: (trigger: HTMLButtonElement) => void;
  focusByDelta: (trigger: HTMLButtonElement, delta: number) => void;
  focusBoundary: (boundary: 'first' | 'last') => void;
};

let tabsId = 0;
const TabsContext = createContext<TabsContextValue>();

function useTabs() {
  const context = useContext(TabsContext);
  if (!context) throw new Error('Tabs primitives must be used inside <Tabs>.');
  return context;
}

function safeValue(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'tab';
}

function TabsRoot(props: TabsProps) {
  const [local, rest] = splitProps(props, ['value', 'defaultValue', 'onValueChange', 'orientation', 'children']);
  const [innerValue, setInnerValue] = createSignal(local.defaultValue ?? '');
  const [triggers, setTriggers] = createSignal<HTMLButtonElement[]>([]);
  const baseId = `onyx-tabs-${++tabsId}`;
  const selected = createMemo(() => local.value ?? innerValue());

  const setSelected = (value: string) => {
    if (local.value === undefined) setInnerValue(value);
    local.onValueChange?.(value);
  };

  const enabledTriggers = () => triggers().filter((trigger) => !trigger.disabled);

  const moveFocus = (trigger: HTMLButtonElement, nextIndex: number) => {
    const enabled = enabledTriggers();
    if (enabled.length === 0) return;
    const boundedIndex = (nextIndex + enabled.length) % enabled.length;
    const next = enabled[boundedIndex];
    if (!next) return;
    next.focus();
    setSelected(next.dataset.value ?? '');
  };

  const context: TabsContextValue = {
    selected,
    setSelected,
    orientation: () => local.orientation ?? 'horizontal',
    baseId,
    registerTrigger: (trigger) => setTriggers((current) => [...current, trigger]),
    unregisterTrigger: (trigger) => setTriggers((current) => current.filter((item) => item !== trigger)),
    focusByDelta: (trigger, delta) => {
      const enabled = enabledTriggers();
      moveFocus(trigger, enabled.indexOf(trigger) + delta);
    },
    focusBoundary: (boundary) => {
      const enabled = enabledTriggers();
      if (enabled.length === 0) return;
      const target = boundary === 'first' ? enabled[0] : enabled[enabled.length - 1];
      if (!target) return;
      target.focus();
      setSelected(target.dataset.value ?? '');
    },
  };

  return (
    <TabsContext.Provider value={context}>
      <div {...rest} class="onyx-tabs">{local.children}</div>
    </TabsContext.Provider>
  );
}

function TabsList(props: TabsListProps) {
  const [local, rest] = splitProps(props, ['class', 'children']);
  const context = useTabs();

  return (
    <div
      {...rest}
      class={['onyx-tabs__list', local.class].filter(Boolean).join(' ')}
      role="tablist"
      aria-orientation={context.orientation()}
    >
      {local.children}
    </div>
  );
}

function TabsTrigger(props: TabsTriggerProps) {
  const [local, rest] = splitProps(props, ['value', 'class', 'children', 'disabled', 'onClick', 'onKeyDown', 'type']);
  const context = useTabs();
  let triggerRef: HTMLButtonElement | undefined;
  const selected = () => context.selected() === local.value;
  const triggerId = () => `${context.baseId}-trigger-${safeValue(local.value)}`;
  const panelId = () => `${context.baseId}-panel-${safeValue(local.value)}`;

  const assignRef = (element: HTMLButtonElement) => {
    triggerRef = element;
    context.registerTrigger(element);
  };

  onCleanup(() => {
    if (triggerRef) context.unregisterTrigger(triggerRef);
  });

  const handleClick: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent> = (event) => {
    if (typeof local.onClick === 'function') local.onClick(event);
    if (!event.defaultPrevented && !local.disabled) context.setSelected(local.value);
  };

  const handleKeyDown: JSX.EventHandlerUnion<HTMLButtonElement, KeyboardEvent> = (event) => {
    if (typeof local.onKeyDown === 'function') local.onKeyDown(event);
    if (event.defaultPrevented || local.disabled || !triggerRef) return;

    const nextKeys = context.orientation() === 'vertical' ? ['ArrowDown'] : ['ArrowRight'];
    const previousKeys = context.orientation() === 'vertical' ? ['ArrowUp'] : ['ArrowLeft'];

    if (nextKeys.includes(event.key)) {
      event.preventDefault();
      context.focusByDelta(triggerRef, 1);
    } else if (previousKeys.includes(event.key)) {
      event.preventDefault();
      context.focusByDelta(triggerRef, -1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      context.focusBoundary('first');
    } else if (event.key === 'End') {
      event.preventDefault();
      context.focusBoundary('last');
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      context.setSelected(local.value);
    }
  };

  return (
    <button
      {...rest}
      ref={assignRef}
      type={local.type ?? 'button'}
      class={['onyx-tabs__trigger', local.class].filter(Boolean).join(' ')}
      role="tab"
      id={triggerId()}
      data-value={local.value}
      aria-selected={selected()}
      aria-controls={panelId()}
      tabindex={selected() ? 0 : -1}
      disabled={local.disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {local.children}
    </button>
  );
}

function TabsContent(props: TabsContentProps) {
  const [local, rest] = splitProps(props, ['value', 'class', 'children']);
  const context = useTabs();
  const selected = () => context.selected() === local.value;
  const triggerId = () => `${context.baseId}-trigger-${safeValue(local.value)}`;
  const panelId = () => `${context.baseId}-panel-${safeValue(local.value)}`;

  return (
    <div
      {...rest}
      class={['onyx-tabs__content', local.class].filter(Boolean).join(' ')}
      role="tabpanel"
      id={panelId()}
      aria-labelledby={triggerId()}
      hidden={!selected()}
      tabindex="0"
    >
      {local.children}
    </div>
  );
}

export const Tabs = Object.assign(TabsRoot, {
  List: TabsList,
  Trigger: TabsTrigger,
  Content: TabsContent,
});
