'use client'

import { useState } from 'react'

const TONE_OPTIONS = ['Professional', 'Conversational', 'Urgent', 'Neutral', 'Friendly'] as const
const LENGTH_OPTIONS = ['Short', 'Medium', 'Long'] as const
const AUDIENCE_OPTIONS = ['General reader', 'Local community', 'Expert/industry', 'Youth-friendly'] as const
const ARTICLE_COUNT_OPTIONS = ['One', 'Two', 'Three'] as const

export const WORKFLOW_PREFERENCES_KEY = 'diffuse_workflow_preferences'

export interface WorkflowPreferences {
  tone?: string
  length?: string
  audience?: string
  comments?: string
  numberOfOutputs?: number
  articleTopics?: string
}

export interface GenerateOptionsModalProps {
  onClose: () => void
  onGenerate: (payload: {
    outputType: 'article' | 'ad'
    tone?: string
    length?: string
    audience?: string
    comments?: string
    numberOfOutputs?: number
    articleTopics?: string
  }) => void
  initialValues?: WorkflowPreferences
  onSavePreferences?: (prefs: WorkflowPreferences) => Promise<void>
}

export default function GenerateOptionsModal({
  onClose,
  onGenerate,
  initialValues,
  onSavePreferences,
}: GenerateOptionsModalProps) {
  const [step, setStep] = useState(0)
  const [tonePreset, setTonePreset] = useState<string>(() => {
    const t = initialValues?.tone ?? ''
    return TONE_OPTIONS.includes(t as any) ? t : ''
  })
  const [toneOther, setToneOther] = useState<string>(() => {
    const t = initialValues?.tone ?? ''
    return TONE_OPTIONS.includes(t as any) ? '' : t
  })
  const [lengthPreset, setLengthPreset] = useState<string>(() => {
    const l = initialValues?.length ?? ''
    return LENGTH_OPTIONS.includes(l as any) ? l : ''
  })
  const [lengthOther, setLengthOther] = useState<string>(() => {
    const l = initialValues?.length ?? ''
    return LENGTH_OPTIONS.includes(l as any) ? '' : l
  })
  const [audiencePreset, setAudiencePreset] = useState<string>(() => {
    const a = initialValues?.audience ?? ''
    return AUDIENCE_OPTIONS.includes(a as any) ? a : ''
  })
  const [audienceOther, setAudienceOther] = useState<string>(() => {
    const a = initialValues?.audience ?? ''
    return AUDIENCE_OPTIONS.includes(a as any) ? '' : a
  })
  const [comments, setComments] = useState<string>('')
  const [outputType, setOutputType] = useState<'article' | 'ad'>('article')
  const [saveAsDefault, setSaveAsDefault] = useState(false)
  const [savingPrefs, setSavingPrefs] = useState(false)
  const [toneOtherFocused, setToneOtherFocused] = useState(false)
  const [lengthOtherFocused, setLengthOtherFocused] = useState(false)
  const [audienceOtherFocused, setAudienceOtherFocused] = useState(false)
  const [numberOfOutputs, setNumberOfOutputs] = useState<number>(() => initialValues?.numberOfOutputs ?? 1)
  const [numberOfOutputsOther, setNumberOfOutputsOther] = useState<string>(() => {
    const n = initialValues?.numberOfOutputs
    return n != null && n > 3 ? String(n) : ''
  })
  const [numberOfOutputsOtherFocused, setNumberOfOutputsOtherFocused] = useState(false)
  const [articleTopicsFocused, setArticleTopicsFocused] = useState(false)
  const [articleTopics, setArticleTopics] = useState<string>('')
  const [commentsFocused, setCommentsFocused] = useState(false)

  const SELECT_DELAY_MS = 320

  const finalTone = (tonePreset || toneOther.trim()).trim()
  const finalLength = (lengthPreset || lengthOther.trim()).trim()
  const finalAudience = (audiencePreset || audienceOther.trim()).trim()

  const handleTonePreset = (value: string) => {
    setTonePreset(value)
    setToneOther('')
    setTimeout(() => setStep(1), SELECT_DELAY_MS)
  }

  const handleLengthSelect = (value: string) => {
    setLengthPreset(value)
    setLengthOther('')
    setTimeout(() => setStep(2), SELECT_DELAY_MS)
  }

  const handleAudiencePreset = (value: string) => {
    setAudiencePreset(value)
    setAudienceOther('')
    setTimeout(() => setStep(4), SELECT_DELAY_MS)
  }

  const handleToneOtherEnter = () => {
    if (!toneOther.trim()) return
    setTimeout(() => setStep(1), SELECT_DELAY_MS)
  }

  const handleLengthOtherEnter = () => {
    if (!lengthOther.trim()) return
    setTimeout(() => setStep(2), SELECT_DELAY_MS)
  }

  const handleAudienceOtherEnter = () => {
    if (!audienceOther.trim()) return
    setTimeout(() => setStep(4), SELECT_DELAY_MS)
  }

  const handleArticleCountSelect = (value: 'One' | 'Two' | 'Three') => {
    const num = value === 'One' ? 1 : value === 'Two' ? 2 : 3
    setNumberOfOutputs(num)
    setNumberOfOutputsOther('')
    if (value === 'One') {
      setTimeout(() => setStep(3), SELECT_DELAY_MS)
    }
  }

  const handleArticleCountOther = () => {
    const parsed = parseInt(numberOfOutputsOther, 10)
    if (Number.isNaN(parsed) || parsed < 4 || parsed > 10 || !Number.isInteger(parsed)) return
    setNumberOfOutputs(parsed)
  }

  const finalNumberOfOutputs = numberOfOutputsOther.trim()
    ? (() => {
        const n = parseInt(numberOfOutputsOther, 10)
        return Number.isNaN(n) || n < 4 || n > 10 ? 0 : n
      })()
    : numberOfOutputs

  const showSpecifyTopics = finalNumberOfOutputs >= 2 || numberOfOutputsOtherFocused || numberOfOutputsOther.trim().length > 0

  const isOtherInvalid =
    numberOfOutputsOther.trim().length > 0 &&
    (() => {
      const n = parseInt(numberOfOutputsOther, 10)
      return Number.isNaN(n) || n < 4 || n > 10
    })()

  const stepTitles = [
    'What tone do you want?',
    'How long should the article be?',
    'How many articles do you want generated from this?',
    'Who is the audience?',
    'Choose output type',
  ]

  const handleGenerate = async () => {
    if (saveAsDefault) {
      const prefs: WorkflowPreferences = {}
      if (finalTone) prefs.tone = finalTone
      if (finalLength) prefs.length = finalLength
      if (finalAudience) prefs.audience = finalAudience
      if (finalNumberOfOutputs > 1) prefs.numberOfOutputs = finalNumberOfOutputs
      if (onSavePreferences) {
        setSavingPrefs(true)
        try {
          await onSavePreferences(prefs)
        } catch (_) {}
        setSavingPrefs(false)
      } else {
        try {
          localStorage.setItem(WORKFLOW_PREFERENCES_KEY, JSON.stringify(prefs))
        } catch (_) {}
      }
    }
    onGenerate({
      outputType,
      ...(finalTone && { tone: finalTone }),
      ...(finalLength && { length: finalLength }),
      ...(finalAudience && { audience: finalAudience }),
      ...(comments.trim() && { comments: comments.trim() }),
      ...(finalNumberOfOutputs > 1 && { numberOfOutputs: finalNumberOfOutputs }),
      ...(articleTopics.trim() && { articleTopics: articleTopics.trim() }),
    })
    onClose()
  }

  const inputClass =
    'w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors'
  const optionRowClass =
    'w-full px-4 py-3 flex items-center gap-3 text-left rounded-glass border transition-colors text-body-sm'
  const otherInputClass =
    'flex-1 min-w-0 bg-transparent border-none py-0 text-secondary-white text-body-sm focus:outline-none placeholder:text-medium-gray'
  const checkIcon = (
    <svg className="w-5 h-5 text-cosmic-orange flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  )
  const xIcon = (
    <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center px-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="glass-container p-8 max-w-md w-full h-[600px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-heading-lg text-secondary-white mb-6 flex-shrink-0">
          {stepTitles[step]}
        </h2>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          {step === 0 && (
          <div key={0} className="modal-step-enter space-y-2">
            {TONE_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => handleTonePreset(opt)}
                className={`${optionRowClass} ${
                  tonePreset === opt ? 'border-cosmic-orange bg-white/10 text-secondary-white' : 'border-white/10 hover:bg-white/5 text-secondary-white'
                }`}
              >
                {tonePreset === opt && (
                  <svg className="w-5 h-5 text-cosmic-orange flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                <span>{opt}</span>
              </button>
            ))}
            <div
              className={`${optionRowClass} ${
                toneOther.trim() || toneOtherFocused
                  ? 'border-cosmic-orange bg-white/10 text-secondary-white'
                  : 'border-white/10 hover:bg-white/5 text-secondary-white'
              }`}
            >
              {(toneOther.trim() || toneOtherFocused) && checkIcon}
              <input
                type="text"
                value={toneOther}
                onChange={(e) => {
                  setToneOther(e.target.value)
                  if (e.target.value.trim()) setTonePreset('')
                }}
                onFocus={() => {
                  setToneOtherFocused(true)
                  setTonePreset('')
                }}
                onBlur={() => setToneOtherFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleToneOtherEnter()
                  }
                }}
                placeholder="Other"
                className={otherInputClass}
              />
            </div>
          </div>
        )}

        {step === 1 && (
          <div key={1} className="modal-step-enter space-y-2">
            {LENGTH_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => handleLengthSelect(opt)}
                className={`${optionRowClass} ${
                  lengthPreset === opt ? 'border-cosmic-orange bg-white/10 text-secondary-white' : 'border-white/10 hover:bg-white/5 text-secondary-white'
                }`}
              >
                {lengthPreset === opt && (
                  <svg className="w-5 h-5 text-cosmic-orange flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                <span>{opt}</span>
              </button>
            ))}
            <div
              className={`${optionRowClass} ${
                lengthOther.trim() || lengthOtherFocused
                  ? 'border-cosmic-orange bg-white/10 text-secondary-white'
                  : 'border-white/10 hover:bg-white/5 text-secondary-white'
              }`}
            >
              {(lengthOther.trim() || lengthOtherFocused) && checkIcon}
              <input
                type="text"
                value={lengthOther}
                onChange={(e) => {
                  setLengthOther(e.target.value)
                  if (e.target.value.trim()) setLengthPreset('')
                }}
                onFocus={() => {
                  setLengthOtherFocused(true)
                  setLengthPreset('')
                }}
                onBlur={() => setLengthOtherFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleLengthOtherEnter()
                  }
                }}
                placeholder="Other"
                className={otherInputClass}
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div key={2} className="modal-step-enter space-y-2">
            {ARTICLE_COUNT_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => handleArticleCountSelect(opt)}
                className={`${optionRowClass} ${
                  !numberOfOutputsOther && numberOfOutputs === (opt === 'One' ? 1 : opt === 'Two' ? 2 : 3)
                    ? 'border-cosmic-orange bg-white/10 text-secondary-white'
                    : 'border-white/10 hover:bg-white/5 text-secondary-white'
                }`}
              >
                {!numberOfOutputsOther && numberOfOutputs === (opt === 'One' ? 1 : opt === 'Two' ? 2 : 3) && checkIcon}
                <span>{opt}</span>
              </button>
            ))}
            <div
              className={`${optionRowClass} ${
                isOtherInvalid
                  ? 'border-red-500 bg-red-500/5 text-secondary-white'
                  : numberOfOutputsOther.trim() || numberOfOutputsOtherFocused
                    ? 'border-cosmic-orange bg-white/10 text-secondary-white'
                    : 'border-white/10 hover:bg-white/5 text-secondary-white'
              }`}
            >
              {isOtherInvalid ? xIcon : (numberOfOutputsOther.trim() || numberOfOutputsOtherFocused) && checkIcon}
              <input
                type="text"
                inputMode="numeric"
                value={numberOfOutputsOther}
                onChange={(e) => {
                  setNumberOfOutputsOther(e.target.value.replace(/\D/g, '').slice(0, 2))
                  if (e.target.value.trim()) setNumberOfOutputs(0)
                }}
                onFocus={() => {
                  setNumberOfOutputsOtherFocused(true)
                  setNumberOfOutputs(0)
                }}
                onBlur={() => setNumberOfOutputsOtherFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleArticleCountOther()
                  }
                }}
                placeholder="Other (4–10)"
                className={otherInputClass}
              />
            </div>
            {showSpecifyTopics && (
              <>
                <label htmlFor="article-topics" className="block text-body-sm text-secondary-white mb-2 mt-4">
                  Specify Topics <span className="text-medium-gray">(optional)</span>
                </label>
                <div
                  className={`${optionRowClass} ${
                    articleTopics.trim() || articleTopicsFocused
                      ? 'border-cosmic-orange bg-white/10 text-secondary-white'
                      : 'border-white/10 hover:bg-white/5 text-secondary-white'
                  }`}
                >
                  {(articleTopics.trim() || articleTopicsFocused) && checkIcon}
                  <input
                    id="article-topics"
                    type="text"
                    value={articleTopics}
                    onChange={(e) => setArticleTopics(e.target.value)}
                    onFocus={() => setArticleTopicsFocused(true)}
                    onBlur={() => setArticleTopicsFocused(false)}
                    placeholder="Leave blank and Diffuse will decide"
                    className={otherInputClass}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {step === 3 && (
          <div key={3} className="modal-step-enter space-y-2">
            {AUDIENCE_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => handleAudiencePreset(opt)}
                className={`${optionRowClass} ${
                  audiencePreset === opt ? 'border-cosmic-orange bg-white/10 text-secondary-white' : 'border-white/10 hover:bg-white/5 text-secondary-white'
                }`}
              >
                {audiencePreset === opt && (
                  <svg className="w-5 h-5 text-cosmic-orange flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                <span>{opt}</span>
              </button>
            ))}
            <div
              className={`${optionRowClass} ${
                audienceOther.trim() || audienceOtherFocused
                  ? 'border-cosmic-orange bg-white/10 text-secondary-white'
                  : 'border-white/10 hover:bg-white/5 text-secondary-white'
              }`}
            >
              {(audienceOther.trim() || audienceOtherFocused) && checkIcon}
              <input
                type="text"
                value={audienceOther}
                onChange={(e) => {
                  setAudienceOther(e.target.value)
                  if (e.target.value.trim()) setAudiencePreset('')
                }}
                onFocus={() => {
                  setAudienceOtherFocused(true)
                  setAudiencePreset('')
                }}
                onBlur={() => setAudienceOtherFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAudienceOtherEnter()
                  }
                }}
                placeholder="Other"
                className={otherInputClass}
              />
            </div>
          </div>
        )}

        {step === 4 && (
          <div key={4} className="modal-step-enter space-y-4">
            <button
              type="button"
              onClick={() => setOutputType('article')}
              className={`${optionRowClass} ${
                outputType === 'article'
                  ? 'border-cosmic-orange bg-white/10 text-secondary-white'
                  : 'border-white/10 hover:bg-white/5 text-secondary-white'
              }`}
            >
              {outputType === 'article' ? (
                checkIcon
              ) : (
                <svg className="w-5 h-5 text-accent-purple flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              )}
              <span>Article</span>
            </button>
            <button
              type="button"
              onClick={() => setOutputType('ad')}
              className={`${optionRowClass} ${
                outputType === 'ad'
                  ? 'border-cosmic-orange bg-white/10 text-secondary-white'
                  : 'border-white/10 hover:bg-white/5 text-secondary-white'
              }`}
            >
              {outputType === 'ad' ? (
                checkIcon
              ) : (
                <svg className="w-5 h-5 text-cosmic-orange flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                </svg>
              )}
              <span>Advertisement</span>
            </button>
            <label htmlFor="generate-comments" className="block text-body-sm text-secondary-white mb-2">
              Additional Comments <span className="text-medium-gray">(optional)</span>
            </label>
            <div
              className={`${optionRowClass} ${
                comments.trim() || commentsFocused
                  ? 'border-cosmic-orange bg-white/10 text-secondary-white'
                  : 'border-white/10 hover:bg-white/5 text-secondary-white'
              }`}
            >
              {(comments.trim() || commentsFocused) && checkIcon}
              <input
                id="generate-comments"
                type="text"
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                onFocus={() => setCommentsFocused(true)}
                onBlur={() => setCommentsFocused(false)}
                placeholder="Any extra instructions for Diffuse..."
                className={otherInputClass}
              />
            </div>
            <button
              type="button"
              onClick={() => setSaveAsDefault((prev) => !prev)}
              className={`${optionRowClass} mt-4 ${
                saveAsDefault
                  ? 'border-cosmic-orange bg-white/10 text-secondary-white'
                  : 'border-white/10 hover:bg-white/5 text-secondary-white'
              }`}
            >
              {saveAsDefault && checkIcon}
              <span>Save all responses as default</span>
            </button>
          </div>
        )}
        </div>

        <div className="flex gap-4 mt-8 flex-shrink-0 pt-4 border-t border-white/10">
          {step < 4 ? (
            <>
              {step > 0 && (
                <button
                  type="button"
                  onClick={() => setStep((s) => s - 1)}
                  className="btn-secondary flex-1 py-3"
                >
                  Back
                </button>
              )}
              <button
                type="button"
                onClick={() => setStep((s) => s + 1)}
                disabled={
                  (step === 1 && !finalLength) ||
                  (step === 2 && finalNumberOfOutputs < 1) ||
                  (step === 3 && !finalAudience)
                }
                className="btn-primary flex-1 py-3 disabled:opacity-50"
              >
                Next
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setStep(3)} className="btn-secondary flex-1 py-3">
                Back
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={savingPrefs}
                className="btn-primary flex-1 py-3 disabled:opacity-50"
              >
                {savingPrefs ? 'Saving...' : 'Generate'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
