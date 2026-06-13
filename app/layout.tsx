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
    var activeValid = ['ocean','abyss','midnight','bathyal','coral','kelp','brine','onyx','amoled','arctic','ash','light','lacquer','pearl','system'];
    var displayValid = ['lacquer','midnight','onyx','ash','amoled','light','system'];
    // Normalize a missing/invalid active theme. Default is now 'lacquer'.
    if (activeValid.indexOf(active) === -1) {
      active = activeValid.indexOf(legacy) !== -1 ? legacy : 'lacquer';
      localStorage.setItem('ocean-active-theme', active);
    }
    // v2 migration: legacy 'onyx' default -> 'midnight'.
    if (display === 'onyx' && !localStorage.getItem('ocean-theme-v2')) {
      display = 'midnight';
      localStorage.setItem('ocean-display-theme', 'midnight');
      localStorage.setItem('ocean-theme-v2', '1');
    }
    if (displayValid.indexOf(display) === -1) {
      display = displayValid.indexOf(legacy) !== -1 ? legacy : 'midnight';
      localStorage.setItem('ocean-display-theme', display);
    }
    // v3 migration: 'lacquer' is the new flagship default. Move users still on
    // the old auto-default (active 'ocean' and/or display 'midnight'/none) to
    // 'lacquer'. Any explicit non-ocean/non-system named active theme is kept.
    if (localStorage.getItem('ocean-theme-v3') !== '1') {
      var explicit = active && active !== 'ocean' && active !== 'system' && active !== 'lacquer';
      var autoDisplay = (display == null || display === 'midnight');
      if (!explicit && active === 'ocean') {
        active = 'lacquer';
        localStorage.setItem('ocean-active-theme', 'lacquer');
      }
      if (!explicit && autoDisplay) {
        display = 'lacquer';
        localStorage.setItem('ocean-display-theme', 'lacquer');
      }
      localStorage.setItem('ocean-theme-v3', '1');
    }
    if (active === 'system' || display === 'system') {
      document.documentElement.setAttribute('data-theme', window.matchMedia('(prefers-color-scheme: dark)').matches ? 'lacquer' : 'light');
    } else if (active && active !== 'ocean') {
      document.documentElement.setAttribute('data-theme', active);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  } catch(e) {
    document.documentElement.setAttribute('data-theme', 'lacquer');
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
