import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { ServiceWorkerRegistration } from '@/components/service-worker-registration'
import './globals.css'

export const metadata: Metadata = {
  title: 'STAY FIT — Your pace, your progress',
  description: 'A personal fitness and wellbeing dashboard for building consistency, one day at a time.',
  generator: 'v0.app',
  applicationName: 'Stay Fit',
  appleWebApp: {
    capable: true,
    title: 'Stay Fit',
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#171717',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <ServiceWorkerRegistration />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
