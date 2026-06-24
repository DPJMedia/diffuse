import type { Metadata, Viewport } from 'next'
import './globals.css'
import { faqSchema, productSchema, serviceSchema, howToSchema } from './schema'
import { seoDescription } from '@/lib/content/diffuse'

const siteUrl = 'https://www.diffuse.press'
const siteName = 'Diffuse.AI'
const siteDescription = seoDescription

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Diffuse.AI - AI for Local News, Judgment Kept Human',
    template: '%s | Diffuse.AI',
  },
  description: siteDescription,
  keywords: [
    // Primary
    'meeting to article',
    'recording to article AI',
    'AI journalism tool',
    'automated article writing',
    'transcription to news article',
    'local news automation',
    // Multi-input & outputs
    'AI article generator',
    'AI ad generator',
    'multi-input article generator',
    'generate articles and advertisements',
    'web scrape to article',
    'PDF to article AI',
    'audio to article',
    'speech to article',
    // Use cases
    'government meeting coverage',
    'school board meeting news',
    'town hall coverage',
    'municipal meeting automation',
    'interview to article',
    'press conference to article',
    // Workflow & platform
    'record transcribe generate publish',
    'newsroom automation platform',
    'publishing integration',
    'auto-publish articles',
    'team journalism tool',
    'content automation SaaS',
    // Audience
    'tool for journalists',
    'local journalism software',
    'content team automation',
    'one-person newsroom',
    // Discoverability
    'ChatGPT for journalism',
    'AI writing for news',
    'automated reporting tool',
  ],
  authors: [
    { name: 'Diffuse.AI', url: siteUrl },
  ],
  creator: 'Diffuse.AI',
  publisher: 'Diffuse.AI',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteUrl,
    siteName: siteName,
    title: 'Diffuse.AI - AI for Local News, Judgment Kept Human',
    description: siteDescription,
    images: [
      {
        url: '/socialcover.png',
        width: 1200,
        height: 630,
        alt: 'Diffuse.AI - context to publication for local news, with a human verification layer',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@DiffuseAI',
    creator: '@DiffuseAI',
    title: 'Diffuse.AI - AI for Local News, Judgment Kept Human',
    description: siteDescription,
    images: ['/socialcover.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  alternates: {
    canonical: siteUrl,
  },
  icons: {
    icon: [
      { url: '/D.png', sizes: 'any', type: 'image/png' },
    ],
    apple: [
      { url: '/D.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  manifest: '/manifest.webmanifest',
  category: 'technology',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
    { media: '(prefers-color-scheme: light)', color: '#000000' },
  ],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="custom-scrollbar">
      <head>
        {/* Preconnect to optimize loading */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="dns-prefetch" href="https://fonts.googleapis.com" />
        
        {/* Structured Data - Organization */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Organization',
              name: 'Diffuse.AI',
              url: siteUrl,
              logo: `${siteUrl}/D.png`,
              description: siteDescription,
              foundingDate: '2024',
              sameAs: [
                'https://twitter.com/DiffuseAI',
                'https://linkedin.com/company/diffuse-ai',
              ],
              contactPoint: {
                '@type': 'ContactPoint',
                contactType: 'Sales',
                availableLanguage: ['English'],
              },
            }),
          }}
        />
        {/* Structured Data - Software Application */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'SoftwareApplication',
              name: 'Diffuse.AI',
              applicationCategory: 'BusinessApplication',
              operatingSystem: 'Web',
              description: siteDescription,
              featureList: [
                'Draft articles and ads from recordings, documents, images, and web pages, with a person verifying before publish',
                'AI transcription with speaker identification and editable transcripts',
                'Multiple input types: recordings, documents (PDF, DOCX, TXT), images, web scrape, cover photos',
                'Multiple output types: articles and ads; combine multiple sources per project',
                'Built-in recording and file upload; project organization with inputs and outputs',
                'Team collaboration with organizations and role-based access',
                'Publishing integrations: auto-populate articles to your frontend',
                'Edit transcriptions and generated content; re-edit and revise outputs',
              ],
              offers: {
                '@type': 'Offer',
                price: '0',
                priceCurrency: 'USD',
              },
              aggregateRating: {
                '@type': 'AggregateRating',
                ratingValue: '5',
                ratingCount: '1',
              },
            }),
          }}
        />
        {/* Structured Data - WebSite */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebSite',
              name: siteName,
              url: siteUrl,
              description: siteDescription,
              potentialAction: {
                '@type': 'SearchAction',
                target: `${siteUrl}/?s={search_term_string}`,
                'query-input': 'required name=search_term_string',
              },
            }),
          }}
        />
        {/* Structured Data - FAQ */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(faqSchema),
          }}
        />
        {/* Structured Data - Product */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(productSchema),
          }}
        />
        {/* Structured Data - Service */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(serviceSchema),
          }}
        />
        {/* Structured Data - HowTo */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(howToSchema),
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
