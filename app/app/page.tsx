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

  return <HomeView />;
}
