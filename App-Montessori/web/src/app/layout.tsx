import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@/styles/globals.css';
import { Providers } from '@/providers/Providers';

export const metadata: Metadata = {
  title: { default: 'Quản trị mầm non', template: '%s · Quản trị mầm non' },
  description: 'Web quản trị hệ thống mầm non nhiều cơ sở',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
