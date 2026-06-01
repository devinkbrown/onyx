'use client';
import { useRef, useCallback } from 'react';

interface TabCompleteOptions {
  nicks: string[];
  getText: () => string;
  setText: (text: string, cursorPos?: number) => void;
}

export function useTabComplete({ nicks, getText, setText }: TabCompleteOptions) {
  const cycleRef = useRef<{
    prefix: string;
    matches: string[];
    index: number;
    originalStart: number;
    originalEnd: number;
  } | null>(null);

  const handleTab = useCallback((
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    cursorPos: number
  ): boolean => {
    if (e.key !== 'Tab') return false;
    e.preventDefault();

    const text = getText();

    if (cycleRef.current) {
      const { prefix, matches, index, originalStart, originalEnd } = cycleRef.current;

      if (e.shiftKey) {
        const newIndex = (index - 1 + matches.length + 1) % (matches.length + 1);
        cycleRef.current.index = newIndex;

        if (newIndex === matches.length) {
          const newText = text.slice(0, originalStart) + prefix + text.slice(originalEnd);
          setText(newText, originalStart + prefix.length);
        } else {
          const nick = matches[newIndex];
          const isAtStart = originalStart === 0;
          const suffix = isAtStart ? ': ' : ' ';
          const replacement = nick + suffix;
          const newText = text.slice(0, originalStart) + replacement + text.slice(originalEnd);
          const newEnd = originalStart + replacement.length;
          cycleRef.current.originalEnd = newEnd;
          setText(newText, newEnd);
        }
      } else {
        const newIndex = (index + 1) % (matches.length + 1);
        cycleRef.current.index = newIndex;

        if (newIndex === matches.length) {
          const newText = text.slice(0, originalStart) + prefix + text.slice(originalEnd);
          setText(newText, originalStart + prefix.length);
        } else {
          const nick = matches[newIndex];
          const isAtStart = originalStart === 0;
          const suffix = isAtStart ? ': ' : ' ';
          const replacement = nick + suffix;
          const newText = text.slice(0, originalStart) + replacement + text.slice(originalEnd);
          const newEnd = originalStart + replacement.length;
          cycleRef.current.originalEnd = newEnd;
          setText(newText, newEnd);
        }
      }
      return true;
    }

    const beforeCursor = text.slice(0, cursorPos);
    const wordMatch = beforeCursor.match(/(\S+)$/);
    if (!wordMatch) return false;

    const prefix = wordMatch[1];
    const startPos = cursorPos - prefix.length;
    const prefixLower = prefix.toLowerCase();

    const matches = nicks.filter(n =>
      n.toLowerCase().startsWith(prefixLower) && n.toLowerCase() !== prefixLower
    );

    if (matches.length === 0) return false;

    const firstNick = matches[0];
    const isAtStart = startPos === 0;
    const suffix = isAtStart ? ': ' : ' ';
    const replacement = firstNick + suffix;
    const newText = text.slice(0, startPos) + replacement + text.slice(cursorPos);
    const newEnd = startPos + replacement.length;

    cycleRef.current = {
      prefix,
      matches,
      index: 0,
      originalStart: startPos,
      originalEnd: newEnd,
    };

    setText(newText, newEnd);
    return true;
  }, [nicks, getText, setText]);

  const resetCycle = useCallback(() => {
    cycleRef.current = null;
  }, []);

  return { handleTab, resetCycle };
}
