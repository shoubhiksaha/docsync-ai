import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { Providers } from './providers';
import Navbar from './components/Navbar';
import AdtFooter from './components/AdtEndorsement';
import ServiceWorkerRegister from './components/ServiceWorkerRegister';
import { serverI18n } from '@/client/i18n/server';

// ADT brand type: IBM Plex Sans for text, Space Grotesk for headings (SIL Open Font License).
const body = localFont({
  src: [
    { path: './fonts/IBMPlexSans-400.woff2', weight: '400' },
    { path: './fonts/IBMPlexSans-600.woff2', weight: '600' },
  ],
  variable: '--font-body',
});

const heading = localFont({
  src: './fonts/SpaceGrotesk-700.woff2',
  weight: '700',
  variable: '--font-heading',
});

export const metadata: Metadata = {
  title: 'DocSync AI: paper documents to Google Sheets & Notion',
  description: 'Photograph receipts, slips and registers. DocSync reads them, you check the details, and a row is added to your own Google Sheet or Notion.',
  applicationName: 'DocSync AI',
  authors: [{ name: 'Analog Digital Technologies (ADT)', url: 'https://analogdigital.tech' }],
  publisher: 'Analog Digital Technologies (ADT)',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'DocSync AI' },
  formatDetection: { telephone: false },
};

// No maximumScale: people must be able to pinch-zoom (WCAG 1.4.4).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#121514' },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { lang, t } = await serverI18n();
  return (
    <html lang={lang} className={`${body.variable} ${heading.variable}`}>
      <body>
        <a href="#main" className="skip-link">{t('nav.skip')}</a>
        <Providers lang={lang}>
          <Navbar />
          {children}
          <AdtFooter />
        </Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
