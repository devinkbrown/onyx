import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import ThemeProvider from '@/components/ui/ThemeProvider';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Ocean',
  description: 'A better way to talk.',
  manifest: '/manifest.json',
  icons: { icon: '/favicon.ico', apple: '/apple-touch-icon.png' },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Ocean' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: '#07070a',
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        {/* Inline theme script — runs synchronously before CSS paints.
            Migrates old 'onyx' default → 'midnight' and applies data-theme
            immediately so there is no flash of wrong theme. */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){
  try {
    var t = localStorage.getItem('ocean-theme');
    if (t === 'onyx' && !localStorage.getItem('ocean-theme-v2')) {
      t = 'midnight';
      localStorage.setItem('ocean-theme', 'midnight');
      localStorage.setItem('ocean-theme-v2', '1');
    }
    var valid = ['midnight','onyx','ash','amoled','light'];
    document.documentElement.setAttribute('data-theme', valid.indexOf(t) !== -1 ? t : 'midnight');
  } catch(e) {
    document.documentElement.setAttribute('data-theme', 'midnight');
  }
})();` }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Roboto:wght@400;500&family=JetBrains+Mono:wght@400;500&family=Fira+Code:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="h-full overflow-hidden">
        <ThemeProvider />
        {children}
      </body>
    </html>
  );
}
