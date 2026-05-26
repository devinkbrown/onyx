'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useOnyxStore } from '@/lib/store';
import HomeView from '@/components/chat/HomeView';

export default function AppPage() {
  const status = useOnyxStore(s => s.status);
  const router = useRouter();

  useEffect(() => {
    if (status === 'disconnected') {
      router.replace('/');
    }
  }, [status, router]);

  // Send QUIT before the tab closes / navigates away so the server drops the
  // session immediately — prevents phantom sessions that steal the nick on
  // the next connect.  'pagehide' fires on navigation + tab close on all
  // modern browsers; 'beforeunload' is the classic fallback.
  useEffect(() => {
    const quit = () => {
      const client = useOnyxStore.getState().client;
      client?.sendRaw('QUIT', 'Page closed');
    };
    window.addEventListener('pagehide',     quit);
    window.addEventListener('beforeunload', quit);
    return () => {
      window.removeEventListener('pagehide',     quit);
      window.removeEventListener('beforeunload', quit);
    };
  }, []);

  return <HomeView />;
}
