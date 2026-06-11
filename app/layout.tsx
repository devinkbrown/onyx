import type { Metadata, Viewport } from 'next';
import { Fraunces, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import ThemeProvider from '@/components/ui/ThemeProvider';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  axes: ['SOFT', 'WONK', 'opsz'],
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jbmono',
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
    <html lang="en" className={`${inter.variable} ${fraunces.variable} ${jetBrainsMono.variable}`}>
      <head>
        {/* Inline theme script — runs synchronously before CSS paints.
            Migrates split theme keys and applies data-theme immediately so
            there is no flash of wrong theme. */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){
  try {
    var legacy = localStorage.getItem('ocean-theme');
    var active = localStorage.getItem('ocean-active-theme');
    var display = localStorage.getItem('ocean-display-theme');
    var activeValid = ['ocean','abyss','midnight','bathyal','coral','kelp','brine','onyx','amoled','arctic','ash','light','system'];
    var displayValid = ['midnight','onyx','ash','amoled','light','system'];
    if (activeValid.indexOf(active) === -1) {
      active = activeValid.indexOf(legacy) !== -1 ? legacy : 'ocean';
      localStorage.setItem('ocean-active-theme', active);
    }
    if (display === 'onyx' && !localStorage.getItem('ocean-theme-v2')) {
      display = 'midnight';
      localStorage.setItem('ocean-display-theme', 'midnight');
      localStorage.setItem('ocean-theme-v2', '1');
    }
    if (displayValid.indexOf(display) === -1) {
      display = displayValid.indexOf(legacy) !== -1 ? legacy : 'midnight';
      if (display === 'onyx' && !localStorage.getItem('ocean-theme-v2')) {
        display = 'midnight';
        localStorage.setItem('ocean-theme-v2', '1');
      }
      localStorage.setItem('ocean-display-theme', display);
    }
    if (active === 'system' || display === 'system') {
      document.documentElement.setAttribute('data-theme', window.matchMedia('(prefers-color-scheme: dark)').matches ? 'midnight' : 'light');
    } else if (active && active !== 'ocean') {
      document.documentElement.setAttribute('data-theme', active);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  } catch(e) {
    document.documentElement.removeAttribute('data-theme');
  }
})();` }} />
      </head>
      <body className="h-full overflow-hidden">
        <ThemeProvider />
        {children}
      </body>
    </html>
  );
}
