'use client';

import { WhiteboardCanvas } from './WhiteboardCanvas';

interface WhiteboardProps {
  channel: string;
  onClose: () => void;
}

export function Whiteboard({ channel, onClose }: WhiteboardProps) {
  // Gate on channel being a real channel
  if (!channel.startsWith('#') && !channel.startsWith('&')) return null;
  return <WhiteboardCanvas channel={channel} onClose={onClose} />;
}
