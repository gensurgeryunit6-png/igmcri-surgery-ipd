import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SessionProvider } from '@/lib/session';
import { Shell } from '@/components/Shell';

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export const metadata: Metadata = {
  title: 'Surgery Unit OS · IGMCRI',
  description: 'Department of General Surgery, Unit VI — IGMCRI Puducherry',
  robots: { index: false, follow: false },
  manifest: `${base}/manifest.webmanifest`,
  icons: { icon: `${base}/icon-192.png`, apple: `${base}/apple-touch-icon.png` },
  appleWebApp: { capable: true, title: 'Unit VI', statusBarStyle: 'default' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#12305a' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <Shell>{children}</Shell>
        </SessionProvider>
      </body>
    </html>
  );
}
