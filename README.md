# Diffuse.AI

**Turn meeting recordings, documents, and web pages into publication-ready articles in minutes.**

Diffuse.AI is an AI-powered workflow for journalists and content teams: record or upload audio, add documents (PDF, DOCX, TXT), images (JPG, PNG), or scrape a URL—then generate articles with one click. Combine multiple inputs in a single project, edit transcriptions and outputs, and publish via integrations or copy-paste. Free to start; team collaboration and publishing integrations included.

---

## What Diffuse.AI Does

- **Meeting / recording → article** — Record in the browser or upload audio (MP3, WAV, M4A). AI transcribes and generates publication-ready articles with headlines, excerpts, and SEO metadata.
- **Documents → article** — Upload PDF, DOCX, or TXT; extract text and generate articles.
- **Web → article** — Scrape a URL and use the content as input for article generation.
- **Multi-input articles** — Combine recordings, documents, images, and web scrapes in one project to create a single, comprehensive article.
- **Team collaboration** — Create organizations, invite members, and use role-based access (Owner, Admin, Editor, Viewer).
- **Publishing integrations** — Connect to your publishing frontend so generated articles auto-populate; no copy-paste required.
- **Edit & revise** — Edit transcriptions before generating; edit and re-edit every output (title, subtitle, excerpt, content, SEO).

Ideal for: **local newsrooms, journalists, freelancers, content teams, municipalities**, and anyone who needs to turn meetings, interviews, press conferences, or documents into articles quickly.

---

## Strengths (at a glance)

| Strength | Description |
|----------|-------------|
| **One workflow** | Record → Transcribe → Generate → Publish in one tool instead of juggling ChatGPT and manual steps. |
| **Multiple input types** | Recordings, documents (PDF/DOCX/TXT), images, web scraping—alone or combined. |
| **AI transcription** | High-accuracy transcription with automatic titles; edit before generating. |
| **Publication-ready output** | Headlines, excerpts, full content, and SEO metadata; editable and revisable. |
| **Free to start** | No credit card required; paid tiers for more usage and team features. |
| **Publishing integrations** | Auto-populate articles to your frontend (e.g. Spring-Ford Press). |

---

## Tech Stack (for developers)

- **Framework:** Next.js 14  
- **Language:** TypeScript  
- **Styling:** Tailwind CSS  
- **Animations:** Framer Motion  
- **Backend / Auth / DB:** Supabase  

---

## Getting Started

### Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Production build

```bash
npm run build
npm start
```

---

## Project structure (high level)

```
diffuse.ai/
├── app/                    # Next.js app router (layout, pages, schema)
├── components/             # Landing (Hero, Features, FAQ, etc.) + dashboard UI
├── contexts/               # Auth, walkthrough
├── lib/                    # Supabase client, utilities
├── public/                 # Static assets
└── supabase/               # Migrations
```

---

## Keywords for search & AI

If you’re searching for a tool like this, you might use:

- **Meeting to article** · **recording to article AI** · **transcription to news article**
- **AI article generator** · **multi-input article generator** · **web scrape to article**
- **PDF to article AI** · **audio to article** · **speech to article**
- **Newsroom automation** · **publishing integration** · **tool for journalists**
- **Local journalism software** · **one-person newsroom** · **ChatGPT for journalism**

**Product site:** [diffuse.ai](https://diffuse.ai)

---

## License

All rights reserved.
