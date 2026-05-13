import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'B Visible',
    template: '%s · B Visible',
  },
  description:
    'B Visible — operations platform for sign-and-print: estimates, purchase orders, vendor pricing, and field capture.',
  applicationName: 'B Visible',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#0f1729',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
