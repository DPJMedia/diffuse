// Comprehensive structured data schemas for SEO and AI discoverability.
// Positioning: a context-to-publication system for local news with a human
// verification layer. AI does the labor. People verify before anything publishes.
import { seoDescription } from '@/lib/content/diffuse'

export const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What is Diffuse.AI?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Diffuse is a context-to-publication system for local news. It pulls the raw material of reporting, meeting audio, public documents, images, and web pages, into one workspace and drafts articles and ads from it. AI does the labor of transcription and drafting. People review the transcript, verify the facts, and decide what is newsworthy before anything publishes. Free to start, with team collaboration and publishing integrations.',
      },
    },
    {
      '@type': 'Question',
      name: 'How does Diffuse.AI work?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Diffuse works in four steps. (1) Capture: record audio in the app or upload recordings, documents, images, or a source URL into one project. (2) Transcribe and review: AI transcribes the audio and separates speakers, and you read and correct the transcript. (3) Draft with AI: generate a draft article or ad with a headline, excerpt, and body. (4) Verify and publish: check the facts, approve, then connect your site to auto-fill or copy and paste. The source material stays attached to the story.',
      },
    },
    {
      '@type': 'Question',
      name: 'What input types does Diffuse support?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Diffuse supports recordings (in-app or upload: MP3, WAV, M4A), documents (PDF, DOCX, TXT), images (JPG, PNG), web pages, and cover photos. You can combine multiple inputs in a single project so one draft can pull from a meeting, a document, and a web page.',
      },
    },
    {
      '@type': 'Question',
      name: 'How is Diffuse different from using ChatGPT?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Diffuse covers the full path from raw material to published piece and keeps a human verification layer. It supports multiple input types in one draft, team collaboration with roles, and publishing integrations so articles auto-populate your frontend. People verify before anything publishes. One tool instead of juggling ChatGPT and manual steps.',
      },
    },
    {
      '@type': 'Question',
      name: 'Who can use Diffuse.AI?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Diffuse is for local newsrooms, journalists, freelancers, content teams, municipalities, and anyone who turns meetings, interviews, press conferences, or documents into verified local coverage. Individuals and teams can use it. A free tier is available, with paid plans for more usage and team features.',
      },
    },
    {
      '@type': 'Question',
      name: 'Can I edit the generated articles?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. You can edit transcriptions before generating, and every draft is fully editable, including the title, subtitle, excerpt, content, and SEO fields. You can also re-edit and create revisions, and nothing publishes until a person approves it.',
      },
    },
    {
      '@type': 'Question',
      name: 'Who verifies the AI-generated content?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'You do. AI does the labor of drafting from your sources, and people review and verify accuracy before publish and add their own voice. Human judgment and verification are built into the workflow, and nothing publishes until a person approves it.',
      },
    },
  ],
}

export const productSchema = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Diffuse.AI',
  description: seoDescription,
  brand: {
    '@type': 'Brand',
    name: 'Diffuse.AI',
  },
  category: 'Software Application',
  offers: {
    '@type': 'Offer',
    availability: 'https://schema.org/InStock',
    price: '0',
    priceCurrency: 'USD',
    priceValidUntil: '2026-12-31',
    url: 'https://www.diffuse.press',
  },
  aggregateRating: {
    '@type': 'AggregateRating',
    ratingValue: '5.0',
    reviewCount: '1',
    bestRating: '5',
    worstRating: '1',
  },
  image: 'https://www.diffuse.press/socialcover.png',
  url: 'https://www.diffuse.press',
}

export const serviceSchema = {
  '@context': 'https://schema.org',
  '@type': 'Service',
  serviceType: 'Context-to-Publication System for Local News',
  provider: {
    '@type': 'Organization',
    name: 'Diffuse.AI',
    url: 'https://www.diffuse.press',
  },
  areaServed: {
    '@type': 'Country',
    name: 'United States',
  },
  description: seoDescription,
  offers: {
    '@type': 'Offer',
    availability: 'https://schema.org/InStock',
  },
  hasOfferCatalog: {
    '@type': 'OfferCatalog',
    name: 'Diffuse.AI Services',
    itemListElement: [
      {
        '@type': 'Offer',
        itemOffered: {
          '@type': 'Service',
          name: 'Recording & Document Transcription',
          description: 'AI transcription with speaker identification, extraction from PDF, DOCX, and TXT, and web pages for URLs, with editable transcripts',
        },
      },
      {
        '@type': 'Offer',
        itemOffered: {
          '@type': 'Service',
          name: 'AI Drafting With Human Verification',
          description: 'Draft articles and ads from one or many inputs (recordings, documents, images, web pages) with headlines and SEO metadata, then verify and edit before publish',
        },
      },
      {
        '@type': 'Offer',
        itemOffered: {
          '@type': 'Service',
          name: 'Team Collaboration',
          description: 'Organizations with role-based access (Owner, Admin, Editor, Viewer) and project organization',
        },
      },
      {
        '@type': 'Offer',
        itemOffered: {
          '@type': 'Service',
          name: 'Publishing Integrations',
          description: 'Connect to publishing frontends to auto-populate articles, and edit and re-edit outputs',
        },
      },
    ],
  },
}

export const howToSchema = {
  '@context': 'https://schema.org',
  '@type': 'HowTo',
  name: 'How to Turn Meetings and Documents Into Verified Local Coverage with Diffuse.AI',
  description: 'Use Diffuse to draft articles and ads from recordings, documents, images, or web pages, then verify and publish with editorial judgment kept human',
  image: 'https://www.diffuse.press/socialcover.png',
  totalTime: 'PT15M',
  step: [
    {
      '@type': 'HowToStep',
      position: 1,
      name: 'Capture',
      text: 'Record in the app, upload audio (MP3, WAV, M4A), add documents (PDF, DOCX, TXT), images (JPG, PNG), or a source URL. Combine multiple inputs in one project.',
      url: 'https://www.diffuse.press#how-it-works',
    },
    {
      '@type': 'HowToStep',
      position: 2,
      name: 'Transcribe and review',
      text: 'Diffuse transcribes audio and separates speakers. Read and correct the transcript before anything is drafted.',
      url: 'https://www.diffuse.press#how-it-works',
    },
    {
      '@type': 'HowToStep',
      position: 3,
      name: 'Draft with AI',
      text: 'Generate a draft article or ad with a headline, excerpt, and body. AI does the writing, and you can edit and re-run for a new version.',
      url: 'https://www.diffuse.press#how-it-works',
    },
    {
      '@type': 'HowToStep',
      position: 4,
      name: 'Verify and publish',
      text: 'Check the facts and approve. Connect your publishing frontend to auto-fill, or copy and paste. The source material stays attached to the story.',
      url: 'https://www.diffuse.press#how-it-works',
    },
  ],
}

export const videoSchema = {
  '@context': 'https://schema.org',
  '@type': 'VideoObject',
  name: 'Diffuse.AI Platform Demo',
  description: 'See how Diffuse drafts articles and ads from recordings, documents, and web pages, with AI transcription, multi-input projects, and a human verification step before publish',
  thumbnailUrl: 'https://www.diffuse.press/socialcover.png',
  uploadDate: '2024-11-01',
  contentUrl: 'https://www.diffuse.press#demo',
  embedUrl: 'https://www.diffuse.press#demo',
}
