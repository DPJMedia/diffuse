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
  const activeTab = (tabParam === 'inputs' || tabParam === 'outputs' || tabParam === 'visibility') ? tabParam : 'inputs'

  // Redirect away if not in walkthrough (optional guard - walkthrough controls when this is shown)
  // For now we just render - the walkthrough overlay will be on top when active

  const setTab = (tab: 'inputs' | 'outputs' | 'visibility') => {
    router.replace(`/dashboard/walkthrough-project?tab=${tab}`, { scroll: false })
  }

  return (
    <div>
      {/* Header - matches real project page */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={() => router.push('/dashboard')}
            className="text-medium-gray hover:text-secondary-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1">
            <h1 className="text-display-sm text-secondary-white">City Council Meeting - Jan 2026</h1>
            <p className="text-body-lg text-medium-gray mt-1">Example project for walkthrough</p>
          </div>
        </div>
      </div>

      {/* Tabs - matches real project page, bigger bar */}
      <div className="flex gap-6 py-2 mb-8 border-b border-white/10 bg-white/5 px-1">
        <button
          data-walkthrough="wt-inputs-tab"
          onClick={() => setTab('inputs')}
          className={`py-3 px-5 text-body-lg font-medium transition-colors relative ${
            activeTab === 'inputs' ? 'text-cosmic-orange' : 'text-secondary-white hover:text-white'
          }`}
        >
          Inputs ({DEMO_INPUTS.length})
          {activeTab === 'inputs' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-cosmic-orange" />
          )}
        </button>
        <button
          data-walkthrough="wt-outputs-tab"
          onClick={() => setTab('outputs')}
          className={`py-3 px-5 text-body-lg font-medium transition-colors relative ${
            activeTab === 'outputs' ? 'text-cosmic-orange' : 'text-secondary-white hover:text-white'
          }`}
        >
          Outputs ({DEMO_OUTPUTS.length})
          {activeTab === 'outputs' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-cosmic-orange" />
          )}
        </button>
        <button
          data-walkthrough="wt-visibility-tab"
          onClick={() => setTab('visibility')}
          className={`py-3 px-5 text-body-lg font-medium transition-colors relative ${
            activeTab === 'visibility' ? 'text-cosmic-orange' : 'text-secondary-white hover:text-white'
          }`}
        >
          Visibility (0)
          {activeTab === 'visibility' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-cosmic-orange" />
          )}
        </button>
      </div>

      {/* Inputs Tab */}
      {activeTab === 'inputs' && (
        <div>
          <div className="flex flex-col md:flex-row md:justify-end gap-3 mb-4">
            <button className="btn-secondary px-4 py-2 flex items-center justify-center gap-2 text-body-sm w-full md:w-auto">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings
            </button>
            <div className="relative">
              <button
                data-walkthrough="wt-add-input"
                className="btn-primary px-4 py-2 flex items-center justify-center gap-2 text-body-sm w-full md:w-auto"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Input
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
            {DEMO_INPUTS.map((input) => (
              <div key={input.id} className="glass-container p-6 hover:bg-white/10 transition-colors cursor-default">
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg bg-white/5 ${
                    input.metadata?.source === 'recording' ? 'text-cosmic-orange' : 'text-green-400'
                  }`}>
                    {input.metadata?.source === 'recording' ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-heading-md text-secondary-white font-medium mb-1 break-words">
                      {input.file_name}
                    </h3>
                    <div className="text-caption uppercase tracking-wider">
                      {input.metadata?.source === 'recording' ? (
                        <>
                          <span className="text-cosmic-orange">RECORDING</span>
                          <span className="text-medium-gray"> • 2:34:15</span>
                        </>
                      ) : (
                        <>
                          <span className="text-green-400">DOCUMENT</span>
                          <span className="text-medium-gray"> • 45 KB</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                {input.content && (
                  <p className="text-body-sm text-secondary-white/70 mt-3 line-clamp-2">
                    {input.content}
                  </p>
                )}
                <div className="text-caption text-medium-gray uppercase tracking-wider mt-3">
                  JAN 15, 2026
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Outputs Tab */}
      {activeTab === 'outputs' && (
        <div>
          <div className="flex justify-end gap-3 mb-4">
            <button className="btn-primary px-4 py-2 flex items-center gap-2 text-body-sm">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Generate with diffuse.ai
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
            {DEMO_OUTPUTS.map((output) => {
              const info = (() => {
                try {
                  const parsed = JSON.parse(output.content)
                  return {
                    title: parsed.title || 'Untitled',
                    subtitle: parsed.subtitle || null,
                    author: parsed.author || 'Diffuse.AI',
                    excerpt: parsed.excerpt || null,
                  }
                } catch {
                  return { title: 'Untitled', subtitle: null, author: 'Diffuse.AI', excerpt: null }
                }
              })()
              return (
                <div key={output.id} className="glass-container p-6 hover:bg-white/10 transition-colors cursor-default">
                  <h3 className="text-heading-md text-secondary-white font-medium mb-2 break-words">
                    {info.title}
                  </h3>
                  {info.subtitle && (
                    <p className="text-caption text-accent-purple uppercase tracking-wider mb-2">
                      {info.subtitle}
                    </p>
                  )}
                  <div className="text-caption uppercase tracking-wider mb-3">
                    <span className="text-cosmic-orange">{info.author}</span>
                    <span className="text-medium-gray"> • JAN 15, 2026</span>
                  </div>
                  {info.excerpt && (
                    <p className="text-caption text-medium-gray uppercase tracking-wider leading-relaxed line-clamp-2">
                      {info.excerpt}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Visibility Tab */}
      {activeTab === 'visibility' && (
        <div>
          <h3 className="text-body-md text-secondary-white mb-2">Visibility</h3>
          <p className="text-caption text-medium-gray mb-4">
            Choose who can see this project.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <button className="glass-container p-6 flex flex-col items-center justify-center text-center transition-colors min-h-[200px] bg-cosmic-orange/20 border-cosmic-orange/30">
              <h3 className="text-heading-lg font-medium mb-2 text-cosmic-orange">Private</h3>
              <p className="text-caption text-medium-gray uppercase tracking-wider">
                ONLY YOU CAN ACCESS
              </p>
              <svg className="w-6 h-6 text-cosmic-orange mt-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </button>
            <div className="glass-container p-6 flex flex-col items-center justify-center text-center min-h-[200px]">
              <p className="text-body-md text-medium-gray">
                Join an organization to share projects
              </p>
            </div>
          </div>
          <button className="btn-primary px-6 py-3 text-xs font-medium">Save Visibility Settings</button>
        </div>
      )}
    </div>
  )
}
