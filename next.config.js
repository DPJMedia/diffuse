/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production'

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,

  experimental: {
    // Externalize Supabase only. Including `diff` here broke the server chunk layout (require("./1682.js")
    // next to webpack-runtime while files lived under chunks/), causing "Cannot find module './1682.js'".
    serverComponentsExternalPackages: ['@supabase/supabase-js', '@supabase/ssr'],
  },

  webpack: (config, { dev }) => {
    if (dev) {
      // Disable webpack persistent caching in dev. Client memory cache still produced bad server
      // chunk maps for large client pages (e.g. recordings + `diff`); full disable is slower but stable.
      config.cache = false
    }
    return config
  },

  // Image optimization
  images: {
    formats: ['image/avif', 'image/webp'],
    // Include common layout widths so /_next/image?w=... is always allowed (missing sizes → 400).
    deviceSizes: [384, 400, 500, 640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    remotePatterns: [
      // Supabase Storage: public + signed URLs are under /storage/v1/object/...
      {
        protocol: 'https',
        hostname: 'ddwcafuxatmejxcfkwhu.supabase.co',
        pathname: '/storage/v1/**',
      },
      { protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/**' },
      { protocol: 'https', hostname: '**.blob.core.windows.net', pathname: '/**' },
    ],
  },

  // Security headers (CSP + HSTS only in production — they often break Next.js dev / HMR on localhost)
  async headers() {
    const baseHeaders = [
      { key: 'X-DNS-Prefetch-Control', value: 'on' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-XSS-Protection', value: '1; mode=block' },
      { key: 'Referrer-Policy', value: 'origin-when-cross-origin' },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(self), geolocation=()',
      },
    ]

    if (isProd) {
      baseHeaders.push(
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload',
        },
        {
          key: 'Content-Security-Policy',
          value:
            "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' ws://localhost:* wss://localhost:* ws://127.0.0.1:* wss://127.0.0.1:* http://localhost:* https://localhost:* http://127.0.0.1:* https://127.0.0.1:* https://*.supabase.co wss://*.supabase.co https://*.n8n.cloud; media-src 'self' https://*.supabase.co blob:; worker-src 'self' blob:;",
        }
      )
    }

    // Do not attach these to `/_next/*` — same idea as middleware `matcher`. A catch-all `/:path*`
    // can interact oddly with dev static serving; missing chunks then return HTML and the browser
    // reports "MIME type text/html" for .js/.css.
    return [
      {
        source: '/((?!_next/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
        headers: baseHeaders,
      },
    ]
  },
}

module.exports = nextConfig
