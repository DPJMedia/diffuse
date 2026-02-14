import { NextResponse } from 'next/server'

export function GET() {
  const manifest = {
    name: 'Diffuse.AI - Reviving Local News Through Smart Automation',
    short_name: 'Diffuse.AI',
    description: 'Transform local meetings into news articles with AI-powered automation. Built for newsrooms, communities, and the future of journalism.',
    start_url: '/',
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#000000',
    orientation: 'portrait-primary',
    scope: '/',
    lang: 'en-US',
    dir: 'ltr',
    categories: ['business', 'news', 'productivity'],
    icons: [
      { src: '/D.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/D.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/D.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/D.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
    screenshots: [{ src: '/og-image.png', sizes: '1200x630', type: 'image/png' }],
  }
  return NextResponse.json(manifest, {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
