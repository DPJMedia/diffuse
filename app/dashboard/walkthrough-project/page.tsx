'use client'

/**
 * Duplicate project page used ONLY for the walkthrough.
 * This is a static copy of the project UI - no API calls, no real data.
 */
import { useRouter, useSearchParams } from 'next/navigation'

// Static demo data
const DEMO_INPUTS = [
  {
    id: '1',
    type: 'audio' as const,
    file_name: 'Council Meeting Recording',
    content: 'Good evening everyone, welcome to the January city council meeting. Tonight we have several infrastructure proposals to discuss...',
    metadata: { source: 'recording' as const, recording_duration: 9255 },
  },
  {
    id: '2',
    type: 'document' as const,
    file_name: 'Meeting Agenda.pdf',
    content: 'Agenda items: 1. Budget review 2. Infrastructure updates 3. Downtown revitalization...',
    file_size: 45000,
  },
]

const DEMO_OUTPUTS = [
  {
    id: '1',
    content: JSON.stringify({
      title: 'City Council Approves Downtown Plan',
      subtitle: 'Infrastructure Update',
      author: 'Diffuse.AI',
      excerpt: 'The City Council voted unanimously to approve the downtown revitalization project. Mayor Johnson highlighted the urgency of the initiative.',
    }),
    created_at: new Date().toISOString(),
  },
]

export default function WalkthroughProjectPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab = (tabParam === 'inputs' || tabParam === 'outputs' || tabParam === 'visibility') ? tabParam : 'outputs'

  // Redirect away if not in walkthrough (optional guard - walkthrough controls when this is shown)
  // For now we just render - the walkthrough overlay will be on top when active

  const setTab = (tab: 'inputs' | 'outputs' | 'visibility') => {
    router.replace(`/dashboard/walkthrough-project?tab=${tab}`, { scroll: false })
  }

  const visibilityOpen = activeTab === 'visibility'
  const demoVisibility: 'private' | 'public' = 'private'
  const demoOrgs = [{ id: 'org-1', name: 'DPJ Media' }, { id: 'org-2', name: 'City Desk' }]

  return (
    <div>
      {/* Header - mirrors real project page */}
      <div className="mb-6">
        <button
          onClick={() => router.push('/dashboard')}
          className="inline-flex items-center gap-1.5 text-medium-gray hover:text-secondary-white transition-colors text-body-sm mb-3"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          All Projects
        </button>

        <h1 className="text-heading-lg text-secondary-white font-medium leading-tight">City Council Meeting - Jan 2026</h1>
        <p className="text-body-sm text-medium-gray mt-1">Example project for walkthrough</p>
      </div>

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* Left: Output column */}
        <div className="flex-1 min-w-0">
          {/* Latest output card */}
          {DEMO_OUTPUTS.length > 0 && (() => {
            const output = DEMO_OUTPUTS[0]
            const info = (() => {
              try {
                const parsed = JSON.parse(output.content)
                return {
                  title: parsed.title || 'Untitled Article',
                  subtitle: parsed.subtitle || null,
                  author: parsed.author || 'Diffuse.AI',
                  excerpt: parsed.excerpt || null,
                }
              } catch {
                return { title: 'Untitled Article', subtitle: null, author: 'Diffuse.AI', excerpt: null }
              }
            })()
            return (
              <div className="glass-container p-5 hover:bg-white/10 transition-colors cursor-default">
                <div className="flex items-center gap-2 text-caption uppercase tracking-wider text-teal-400 mb-2">
                  <span className="flex-shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </span>
                  <span>ARTICLE</span>
                </div>
                <h3 className="text-body-md text-secondary-white font-semibold mb-1 line-clamp-2">{info.title}</h3>
                {info.subtitle && (
                  <p className="text-caption uppercase tracking-wider mb-2 line-clamp-2 text-teal-400">{String(info.subtitle).toUpperCase()}</p>
                )}
                {info.excerpt && <p className="text-body-sm text-medium-gray mb-3 line-clamp-3">{info.excerpt}</p>}
                <div className="text-caption uppercase tracking-wider">
                  <span className="text-teal-400">{String(info.author).toUpperCase()}</span>
                  <span className="text-medium-gray"> • </span>
                  <span className="text-medium-gray">JAN 15, 2026</span>
                </div>
              </div>
            )
          })()}
        </div>

        {/* Right sidebar */}
        <div className="w-full lg:w-72 xl:w-80 flex-shrink-0 glass-container overflow-hidden">
          {/* Quick + Generate buttons — top of sidebar */}
          <div className="flex border-b border-white/10" data-walkthrough="wt-quick-generate">
            <button
              type="button"
              className="btn-secondary border-0 border-r border-secondary-white/25 flex-1 py-3 gap-1.5 text-body-sm rounded-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Quick
            </button>
            <button
              type="button"
              className="btn-primary flex-1 py-3 gap-1.5 text-body-sm rounded-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              Generate
            </button>
          </div>

          {/* Inputs section */}
          <div className="border-b border-white/10" data-walkthrough="wt-inputs-section">
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-body-sm text-secondary-white font-medium">
                Inputs <span className="text-body-sm text-medium-gray">({DEMO_INPUTS.length})</span>
              </p>
              <div className="relative flex items-center justify-center w-6">
                <button
                  data-walkthrough="wt-add-input"
                  className="text-caption text-medium-gray hover:text-secondary-white transition-colors"
                  title="Add input"
                  type="button"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="px-4 pb-3 space-y-1.5">
              {DEMO_INPUTS.map((input) => (
                <button
                  key={input.id}
                  type="button"
                  className="w-full flex items-center gap-2 py-2 px-2 rounded hover:bg-white/10 transition-colors text-left"
                >
                  <span className={`flex-shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5 ${
                    input.metadata?.source === 'recording' ? 'text-rose-400' : 'text-emerald-400'
                  }`}>
                    {input.metadata?.source === 'recording' ? (
                      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                    ) : (
                      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    )}
                  </span>
                  <span className="text-body-sm text-secondary-white truncate">{input.file_name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Visibility section (collapsed in real UI; always shown for walkthrough target) */}
          <div className="border-b border-white/10" data-walkthrough="wt-visibility-section">
            <button
              type="button"
              onClick={() => setTab(visibilityOpen ? 'outputs' : 'visibility')}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors"
            >
              <p className="text-body-sm text-secondary-white font-medium">
                Visibility <span className="text-body-sm text-medium-gray">({demoVisibility === 'private' ? 'Private' : 'Public'})</span>
              </p>
              <div className="w-6 flex items-center justify-center">
                <svg
                  className={`w-3.5 h-3.5 text-medium-gray transition-transform ${visibilityOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {visibilityOpen && (
              <div className="px-4 pb-3 space-y-0.5">
                <button
                  type="button"
                  className="w-full flex items-center justify-between py-2 px-2 rounded hover:bg-white/10 transition-colors text-left"
                >
                  <span className="text-body-sm text-secondary-white">Private</span>
                  <svg className="w-3.5 h-3.5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="w-full flex items-center justify-between py-2 px-2 rounded hover:bg-white/10 transition-colors text-left"
                >
                  <span className="text-body-sm text-secondary-white">Public</span>
                </button>

                <div className="space-y-0.5 pt-2">
                  <p className="text-caption text-medium-gray px-2 pb-1">ORGANIZATIONS</p>
                  {demoOrgs.map((o) => (
                    <div
                      key={o.id}
                      className="w-full flex items-center justify-between py-2 px-2 rounded hover:bg-white/10 transition-colors"
                    >
                      <span className="text-body-sm text-secondary-white truncate">{o.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Settings section (visual filler to resemble real sidebar) */}
          <div>
            <button
              type="button"
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors"
            >
              <p className="text-body-sm text-secondary-white font-medium">Settings</p>
              <svg className="w-3.5 h-3.5 text-medium-gray" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
