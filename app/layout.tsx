import type { Metadata } from 'next'
import './globals.css'
import StoreHydration from '@/components/StoreHydration'

export const metadata: Metadata = {
  title: 'Clipr',
  description: 'Simple video editor for marketers',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-neutral-950 text-neutral-100 antialiased">
        <StoreHydration />
        {children}
      </body>
    </html>
  )
}
