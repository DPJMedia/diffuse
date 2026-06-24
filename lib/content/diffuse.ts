/**
 * Single source of truth for Diffuse product copy.
 *
 * This module is consumed by the landing page components, the read-only MCP
 * server (app/api/[transport]/route.ts), and the llms.txt route
 * (app/llms.txt/route.ts). Keeping the copy here means the page and what AI
 * agents are told about Diffuse can never drift apart.
 *
 * Copy rules: plain language, no hype words, no em dashes, no semicolons.
 * Positioning: a context-to-publication system with a human verification layer.
 * AI does the labor. People decide what is newsworthy and verify what is true.
 */

export const overview =
  'Diffuse is a context-to-publication system for local news. It pulls the raw ' +
  'material of reporting, meeting audio, public documents, and source links, ' +
  'into one workspace, then drafts articles from it. AI does the labor of ' +
  'transcribing and writing. People decide what is newsworthy and verify what ' +
  'is true before anything publishes. The source recordings and documents stay ' +
  'attached to every story, so the context behind the coverage is never thrown away.'

/** One-line description for machine-readable surfaces (llms.txt, MCP). */
export const tagline = 'A context-to-publication system for local news, with a human verification layer.'

/**
 * SEO/meta description, shared by app/layout.tsx metadata and the JSON-LD in
 * app/schema.tsx so the machine-readable positioning never drifts from the page.
 */
export const seoDescription =
  'Diffuse is a context-to-publication system for local news. Pull meeting audio, ' +
  'documents, and web pages into one workspace, get AI transcription and drafts, then ' +
  'verify and publish with editorial judgment kept human. Multi-input projects, team ' +
  'collaboration, and publishing integrations for local newsrooms, journalists, and content teams.'

export interface HowItWorksStep {
  title: string
  body: string
}

export const howItWorks: HowItWorksStep[] = [
  {
    title: 'Capture',
    body: 'Record or upload meeting audio. Add public documents, images, or a source URL. Everything lives in one project as primary material.',
  },
  {
    title: 'Transcribe and review',
    body: 'Diffuse transcribes the audio and separates speakers. You name them, then read and correct the transcript before anything is drafted.',
  },
  {
    title: 'Draft with AI',
    body: 'Generate a draft article or ad with a headline, excerpt, and body. AI does the writing. You stay in control and can re-run for a new version.',
  },
  {
    title: 'Verify and publish',
    body: 'Edit, check the facts, and approve. Connect your site to auto-fill the fields or copy and paste. The source material stays attached to the published story.',
  },
]

export interface Feature {
  key: string
  title: string
  description: string
}

export const features: Feature[] = [
  {
    key: 'drafts-you-review',
    title: 'Drafts you review, not articles you inherit',
    description: 'Generate a draft with a headline, excerpt, and body. You check the facts and approve every version before anything publishes.',
  },
  {
    key: 'transcription',
    title: 'Transcription with speaker names',
    description: 'Diffuse separates speakers and you name them once. Read and correct the transcript before you generate.',
  },
  {
    key: 'mixed-sources',
    title: 'Mix recordings, documents, images, and web',
    description: 'Combine sources in one project. A single draft can pull from a meeting, a press release, and a web page.',
  },
  {
    key: 'context-retained',
    title: 'The source material stays with the story',
    description: 'Recordings, documents, and transcripts are kept in the project alongside every piece, not discarded once it publishes.',
  },
  {
    key: 'teams',
    title: 'Teams with roles and shared projects',
    description: 'Invite people and set roles. Control who can edit, view, or manage.',
  },
  {
    key: 'agent-readable',
    title: 'Built to be read by AI agents',
    description: 'Diffuse serves structured facts to AI agents through an MCP endpoint and an llms.txt file, so agents read accurate information instead of scraping the page.',
  },
]

export interface Faq {
  question: string
  answer: string
}

export const faqs: Faq[] = [
  {
    question: 'What is Diffuse?',
    answer: 'Diffuse is a context-to-publication system for local news. It pulls the raw material of reporting, meeting audio, public documents, and source links, into one workspace and drafts from it. AI does the labor. People review the transcript, check the facts, and decide what is newsworthy before anything publishes.',
  },
  {
    question: 'How does the workflow work?',
    answer: 'Record in the app or upload audio, and add documents or web links if you want. Diffuse transcribes and identifies speakers so you can name them. Read and correct the transcript, then generate a draft article or ad. Connect your site to auto-fill the fields, or copy and paste. Same flow for solo use or teams.',
  },
  {
    question: 'What can I use as input?',
    answer: 'Audio you record or upload (MP3, WAV, M4A), documents (PDF, DOCX, TXT), images, and URLs for web pages. You can combine several inputs in one project so a single draft can pull from a meeting, a press release, and a web page.',
  },
  {
    question: 'Who keeps editorial control?',
    answer: 'You do. Correct the transcript and speaker names before generating. Every draft is fully editable, including the headline, excerpt, body, and SEO fields. You can re-run and create new versions, and nothing publishes until a person approves it.',
  },
  {
    question: 'Who is Diffuse for?',
    answer: 'Local newsrooms, freelancers, and content teams who need to turn meetings, interviews, and documents into verified coverage. A free tier gets you started, and paid plans add more projects and team features. No organization is required to try it.',
  },
  {
    question: 'How is this different from using ChatGPT?',
    answer: 'Diffuse covers the whole path from raw material to published piece, and it keeps a human verification layer. You get recording and upload, transcription with speaker names, multi-input projects, and drafting in one workflow. The source material stays attached to each story instead of being thrown away. It is one product built for the job, not a generic chatbot plus manual steps.',
  },
  {
    question: 'How do you handle AI use and disclosure?',
    answer: 'AI does the labor of transcribing and drafting. People keep editorial judgment and verify the facts. Publishers using Diffuse disclose AI involvement in production, and AI-generated images are labeled.',
  },
  {
    question: 'Can AI agents read Diffuse?',
    answer: 'Yes. Diffuse serves a machine-readable layer so AI agents get accurate structured facts instead of scraping the page. See diffuse.press/llms.txt and the read-only MCP endpoint at diffuse.press/api/mcp.',
  },
]

export interface UseCase {
  name: string
  summary: string
}

export const useCases: UseCase[] = [
  {
    name: 'Spring-Ford Press',
    summary:
      'Spring-Ford Press is a local news site covering the Spring-Ford community in ' +
      'Pennsylvania, and the first live newsroom built on Diffuse. Diffuse captures ' +
      'municipal meetings and turns the audio and documents into structured drafts with ' +
      'headlines, bylines, and body text. An editor reviews, verifies, and publishes. The ' +
      'recordings and source documents stay attached to each story. It is not a demo. It is ' +
      'a working newsroom running on Diffuse in production.',
  },
]
