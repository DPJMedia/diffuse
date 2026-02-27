// Comprehensive structured data schemas for SEO and AI discoverability
export const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What is Diffuse.AI?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Diffuse.AI is an AI-powered platform that turns meeting recordings, documents (PDF, DOCX, TXT), images, and web pages into publication-ready articles and advertisements. You can combine multiple inputs in one project, get AI transcription with speaker identification and article or ad generation with headlines and SEO metadata, and publish via integrations or copy-paste. Free to start, with team collaboration and publishing integrations.',
      },
    },
    {
      '@type': 'Question',
      name: 'How does Diffuse.AI work?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Diffuse.AI works in four steps: (1) Record or upload: capture audio in-app or upload recordings, documents, images, or add web scrapes; (2) Transcribe: AI transcribes audio and extracts text from documents; (3) Generate: create articles from one or many inputs with one click; (4) Publish: connect to your publishing frontend to auto-populate articles, or copy and paste. You can edit transcriptions and outputs, and re-edit generated articles.',
      },
    },
    {
      '@type': 'Question',
      name: 'What input types does Diffuse support?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Diffuse supports recordings (in-app or upload: MP3, WAV, M4A), documents (PDF, DOCX, TXT), images (JPG, PNG), web scraping, and cover photos. You can combine multiple inputs in a single project to generate articles or advertisements.',
      },
    },
    {
      '@type': 'Question',
      name: 'How is Diffuse different from using ChatGPT?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Diffuse is built for the full workflow: record or upload, transcribe, generate, and publish. It supports multiple input types in one article, team collaboration with roles, and publishing integrations so articles auto-populate your frontend. No copy-paste. One tool instead of juggling ChatGPT and manual steps.',
      },
    },
    {
      '@type': 'Question',
      name: 'Who can use Diffuse.AI?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Diffuse.AI is for local newsrooms, journalists, freelancers, content teams, municipalities, and anyone who needs to turn meetings, interviews, press conferences, or documents into articles quickly. Individuals and teams can use it; free tier available, with paid plans for more usage and team features.',
      },
    },
    {
      '@type': 'Question',
      name: 'Can I edit the generated articles?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. You can edit transcriptions before generating, and every generated article is fully editable: title, subtitle, excerpt, content, and SEO fields. You can also re-edit and create revisions of outputs.',
      },
    },
    {
      '@type': 'Question',
      name: 'How accurate is the AI-generated content?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Diffuse.AI produces publication-ready articles from your sources. We recommend reviewing and editing before publish to add your voice and verify accuracy. Human-in-the-loop is built into the workflow.',
      },
    },
  ],
}

export const productSchema = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Diffuse.AI',
  description: 'Turn meetings, documents, and web pages into publication-ready articles and ads in minutes. AI transcription, multi-input projects (recordings, PDFs, images, web scrape), article and advertisement generation, team collaboration, and publishing integrations. Built for local news, journalists, and content teams.',
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
    url: 'https://diffuse.ai',
  },
  aggregateRating: {
    '@type': 'AggregateRating',
    ratingValue: '5.0',
    reviewCount: '1',
    bestRating: '5',
    worstRating: '1',
  },
  image: 'https://diffuse.ai/socialcover.png',
  url: 'https://diffuse.ai',
}

export const serviceSchema = {
  '@context': 'https://schema.org',
  '@type': 'Service',
  serviceType: 'AI Journalism & Article Automation',
  provider: {
    '@type': 'Organization',
    name: 'Diffuse.AI',
    url: 'https://diffuse.ai',
  },
  areaServed: {
    '@type': 'Country',
    name: 'United States',
  },
  description: 'Turn meetings, documents, and web pages into publication-ready articles and ads. AI transcription, multi-input article and ad generation, team collaboration, and publishing integrations. For local news, journalists, and content teams.',
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
          description: 'AI transcription with speaker identification; extraction from PDF, DOCX, TXT; web scraping for URLs',
        },
      },
      {
        '@type': 'Offer',
        itemOffered: {
          '@type': 'Service',
          name: 'AI Article & Ad Generation',
          description: 'Generate publication-ready articles and advertisements from one or many inputs (recordings, documents, images, web scrapes) with headlines and SEO metadata',
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
          description: 'Connect to publishing frontends to auto-populate articles; edit and re-edit outputs',
        },
      },
    ],
  },
}

export const howToSchema = {
  '@context': 'https://schema.org',
  '@type': 'HowTo',
  name: 'How to Turn Meetings and Documents Into Articles and Ads with Diffuse.AI',
  description: 'Use Diffuse.AI to turn recordings, documents, images, or web pages into publication-ready articles or advertisements in minutes',
  image: 'https://diffuse.ai/socialcover.png',
  totalTime: 'PT15M',
  step: [
    {
      '@type': 'HowToStep',
      position: 1,
      name: 'Record or add inputs',
      text: 'Record in the app, upload audio (MP3, WAV, M4A), add documents (PDF, DOCX, TXT), images (JPG, PNG), or scrape a URL. Combine multiple inputs in one project.',
      url: 'https://diffuse.ai#how-it-works',
    },
    {
      '@type': 'HowToStep',
      position: 2,
      name: 'Transcribe',
      text: 'Diffuse.AI transcribes audio and extracts text from documents. Edit the transcription and title before generating if needed.',
      url: 'https://diffuse.ai#how-it-works',
    },
    {
      '@type': 'HowToStep',
      position: 3,
      name: 'Generate',
      text: 'Click Generate to create publication-ready articles or advertisements with headline, excerpt, and content. Edit and re-edit outputs as needed.',
      url: 'https://diffuse.ai#how-it-works',
    },
    {
      '@type': 'HowToStep',
      position: 4,
      name: 'Publish',
      text: 'Connect your publishing frontend to auto-populate articles, or copy and paste. You can publish in minutes.',
      url: 'https://diffuse.ai#how-it-works',
    },
  ],
}

export const videoSchema = {
  '@context': 'https://schema.org',
  '@type': 'VideoObject',
  name: 'Diffuse.AI Platform Demo',
  description: 'See how Diffuse.AI turns recordings, documents, and web pages into publication-ready articles and ads with AI transcription and multi-input generation',
  thumbnailUrl: 'https://diffuse.ai/socialcover.png',
  uploadDate: '2024-11-01',
  contentUrl: 'https://diffuse.ai#demo',
  embedUrl: 'https://diffuse.ai#demo',
}

