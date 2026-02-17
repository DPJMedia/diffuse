import type { Metadata, Viewport } from 'next'
import './globals.css'
import { faqSchema, productSchema, serviceSchema, howToSchema } from './schema'

const siteUrl = 'https://diffuse.ai'
const siteName = 'diffuse.ai'
const siteDescription = 'Turn meeting recordings, documents, and web pages into publication-ready articles in minutes. AI transcription, multi-input articles, team collaboration, and publishing integrations. Free to start—built for local news, journalists, and content teams.'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Diffuse.AI — Meeting to Article in Minutes',
    template: '%s | Diffuse.AI',
  },
  description: siteDescription,
  keywords: [
    // Primary — what we do
    'meeting to article',
    'recording to article AI',
    'AI journalism tool',
    'automated article writing',
    'transcription to news article',
    'local news automation',
    // Strengths & tools
    'AI article generator',
    'meeting transcription to article',
    'multi-input article generator',
    'combine recording and document into article',
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
    // Workflow
    'record transcribe generate publish',
    'newsroom automation platform',
    'publishing integration',
    'auto-publish articles',
    'team journalism tool',
    // Audience
    'tool for journalists',
    'local journalism software',
    'freelance journalist tools',
    'one-person newsroom',
    'content team automation',
    // Alternatives
    'ChatGPT for journalism',
    'AI writing for news',
    'automated reporting tool',
  ],
  authors: [
    { name: 'diffuse.ai', url: siteUrl },
  ],
  creator: 'diffuse.ai',
  publisher: 'diffuse.ai',
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
    title: 'Diffuse.AI — Recordings, Documents & Web → Articles in Minutes',
    description: siteDescription,
    images: [
      {
        url: '/socialcover.png',
        width: 1200,
        height: 630,
        alt: 'Diffuse.AI - Turn meetings, documents, and web pages into publication-ready articles with AI',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@DiffuseAI',
    creator: '@DiffuseAI',
    title: 'Diffuse.AI — Recordings, Documents & Web → Articles in Minutes',
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
              name: 'diffuse.ai',
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
                'Turn meeting recordings into publication-ready articles',
                'AI transcription with automatic titles',
                'Multiple input types: recordings, documents (PDF, DOCX, TXT), images, web scraping',
                'Combine multiple sources into one article',
                'Built-in recording and file upload',
                'Team collaboration with organizations and role-based access',
                'Publishing integrations—auto-populate articles to your frontend',
                'Edit transcriptions and generated articles; re-edit and revise outputs',
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
