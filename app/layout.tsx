import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';
import './access.css';

const geist = Geist({ variable: '--font-geist', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Tamam - Announcement Builder',
  description: 'Create polished bilingual internal service announcements.',
  openGraph: {
    title: 'Tamam - Announcement Builder',
    description: 'Create bilingual service announcements with speed and clarity.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Tamam Announcement Builder' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Tamam - Announcement Builder',
    description: 'Create bilingual service announcements with speed and clarity.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geist.variable} antialiased`}>{children}</body></html>;
}
