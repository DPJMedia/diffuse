'use client'

import { useWalkthrough } from '@/contexts/WalkthroughContext'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState, useCallback, useRef } from 'react'

type MockView = 'none' | 'recording-modal'

interface WalkthroughStep {
  page: string
  tab?: 'inputs' | 'outputs' | 'visibility'
  targetSelector: string | null
  title: string
  description: string
  position: 'top' | 'bottom' | 'left' | 'right' | 'center'
  highlightPadding?: number
  mockView?: MockView
}

const walkthroughSteps: WalkthroughStep[] = [
  {
    page: '/dashboard',
    targetSelector: null,
    title: 'Welcome to Diffuse.AI!',
    description: 'Let\'s take a quick tour to show you around. We\'ll highlight key features so you know where everything is.',
    position: 'center',
    mockView: 'none',
  },
  {
    page: '/dashboard',
    targetSelector: '[data-walkthrough="nav-projects"]',
    title: 'Projects',
    description: 'Your projects live here. Open one to add inputs and generate outputs.',
    position: 'right',
    highlightPadding: 6,
    mockView: 'none',
  },
  {
    page: '/dashboard',
    targetSelector: '[data-walkthrough="create-project"]',
    title: 'Create a Project',
    description: 'Create a project to group your inputs (recordings, documents, text) and generate outputs.',
    position: 'bottom',
    highlightPadding: 6,
    mockView: 'none',
  },
  {
    page: '/dashboard/walkthrough-project',
    targetSelector: null,
    title: 'Inside a Project',
    description: 'Your latest output is on the left. Project controls and inputs are in the right sidebar.',
    position: 'center',
    mockView: 'none',
  },
  {
    page: '/dashboard/walkthrough-project',
    tab: 'outputs',
    targetSelector: '[data-walkthrough="wt-inputs-section"]',
    title: 'Inputs',
    description: 'Add a recording, upload files, scrape a web page, or paste text. Inputs power everything you generate.',
    position: 'left',
    highlightPadding: 6,
    mockView: 'none',
  },
  {
    page: '/dashboard/walkthrough-project',
    tab: 'outputs',
    targetSelector: '[data-walkthrough="wt-quick-generate"]',
    title: 'Generate',
    description: 'Use Quick for a fast default run, or Generate to fine-tune options.',
    position: 'bottom',
    highlightPadding: 6,
    mockView: 'none',
  },
  {
    page: '/dashboard/walkthrough-project',
    tab: 'visibility',
    targetSelector: '[data-walkthrough="wt-visibility-section"]',
    title: 'Visibility',
    description: 'Control who can access the project. Keep it private or share it with your organization for collaboration.',
    position: 'left',
    highlightPadding: 6,
    mockView: 'none',
  },
  {
    page: '/dashboard',
    targetSelector: '[data-walkthrough="nav-recordings"]',
    title: 'Recordings Library',
    description: 'All your recordings are stored here. You can record directly in the app or upload audio files.',
    position: 'right',
    highlightPadding: 6,
    mockView: 'none',
  },
  {
    page: '/dashboard/recordings/new',
    targetSelector: '[data-walkthrough="recording-mic"]',
    title: 'New Recording',
    description: 'Click the microphone to start recording. When you save, it will be transcribed automatically.',
    position: 'left',
    highlightPadding: 10,
    mockView: 'none',
  },
  {
    page: '/dashboard',
    targetSelector: null,
    title: 'You\'re all set',
    description: 'Create a project, add inputs, and generate output. You can restart this tour anytime from Settings.',
    position: 'center',
    mockView: 'none',
  },
]

// Mock View Component - Shows different mock UI states
function MockViewComponent({ view }: { view: MockView }) {
  if (view === 'none') return null

  // Recording Modal Mock
  if (view === 'recording-modal') {
    return (
      <div className="fixed inset-0 z-[99] pointer-events-none">
        {/* Full-page mock of the New Recording screen (sidebar + centered mic) */}
        <div data-walkthrough="mock-recording-panel" className="absolute inset-0 flex bg-black">
          {/* Sidebar */}
          <div className="w-[260px] shrink-0 border-r border-white/10 bg-white/5 backdrop-blur-glass relative">
            <div className="px-6 py-5">
              <div className="text-lg font-semibold text-secondary-white">
                Diffuse<span className="text-cosmic-orange">.AI</span>
              </div>
            </div>
            <div className="px-3 space-y-0.5">
              {['Organizations', 'Projects', 'Advertisements', 'Shared With Me', 'Recordings'].map((label) => (
                <div
                  key={label}
                  className={`px-3 py-2 rounded-glass text-body-sm ${
                    label === 'Recordings' ? 'bg-white/10 text-secondary-white' : 'text-medium-gray'
                  }`}
                >
                  {label}
                </div>
              ))}
            </div>
            <div className="absolute bottom-0 left-0 right-0 p-4">
              <div className="glass-container-sm bg-dark-gray/95 backdrop-blur-glass p-3">
                <div className="text-body-sm text-secondary-white font-medium">Preston Schlagheck</div>
                <div className="text-caption text-medium-gray uppercase tracking-wider">Pro Max</div>
              </div>
            </div>
          </div>

          {/* Main */}
          <div className="flex-1 min-w-0 p-6">
            <div className="mb-6">
              <button className="inline-flex items-center gap-1.5 text-medium-gray text-body-sm mb-3">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Recordings
              </button>
              <h1 className="text-heading-lg text-secondary-white font-medium leading-tight">New Recording</h1>
            </div>

            <div className="min-h-[calc(100vh-220px)] flex items-center justify-center">
              <div className="flex flex-col items-center justify-center">
                <div className="w-28 h-28 rounded-full bg-cosmic-orange/20 border-2 border-cosmic-orange flex items-center justify-center">
                  <svg className="w-12 h-12 text-cosmic-orange" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/>
                  </svg>
                </div>
                <p className="text-body-sm text-medium-gray mt-4">Click the microphone to start recording</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return null
}

export default function Walkthrough() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const {
    isWalkthroughOpen,
    currentStep,
    closeWalkthrough,
    nextStep,
    prevStep,
    completeWalkthrough,
  } = useWalkthrough()

  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const [targetBorderRadius, setTargetBorderRadius] = useState<string>('8px')
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [displayedStep, setDisplayedStep] = useState(currentStep)
  
  // Use ref to track the previous step to detect changes
  const prevStepRef = useRef(currentStep)
  const transitionTimerRef = useRef<NodeJS.Timeout | null>(null)

  const step = walkthroughSteps[currentStep] ?? walkthroughSteps[0]
  const displayStep = walkthroughSteps[displayedStep] ?? walkthroughSteps[0]
  const isFirstStep = currentStep === 0
  const isLastStep = currentStep === walkthroughSteps.length - 1

  // Find and measure target element - uses stepIndex to support displayedStep during transitions
  const updateTargetRect = useCallback((stepIndex?: number) => {
    const stepToUse = stepIndex !== undefined ? walkthroughSteps[stepIndex] : step
    if (!stepToUse?.targetSelector) {
      setTargetRect(null)
      return
    }

    const element = document.querySelector(stepToUse.targetSelector)
    if (element) {
      const rect = element.getBoundingClientRect()
      setTargetRect(rect)

      // Get the computed border-radius of the element
      const computedStyle = window.getComputedStyle(element)
      const borderRadius = computedStyle.borderRadius || '8px'
      setTargetBorderRadius(borderRadius)
    } else {
      setTargetRect(null)
    }
  }, [step])

  // Reset state when walkthrough opens
  useEffect(() => {
    if (isWalkthroughOpen) {
      // Sync displayed step with current step on open
      setDisplayedStep(currentStep)
      setIsTransitioning(false)
      prevStepRef.current = currentStep
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWalkthroughOpen])

  // Handle step transitions with unified animation - everything fades together
  useEffect(() => {
    // Only run when currentStep actually changes
    if (prevStepRef.current === currentStep) return
    prevStepRef.current = currentStep
    
    if (!isWalkthroughOpen) return
    
    // Clear any existing timer
    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current)
    }
    
    // Phase 1: Fade out everything together (200ms)
    setIsTransitioning(true)
    
    // Phase 2: After fade-out, update content and target rect for new step, then fade in
    transitionTimerRef.current = setTimeout(() => {
      setDisplayedStep(currentStep)
      // Update target rect for the new step before fading in
      updateTargetRect(currentStep)
      // Brief delay for layout, then fade in (200ms)
      transitionTimerRef.current = setTimeout(() => {
        setIsTransitioning(false)
        transitionTimerRef.current = null
      }, 50)
    }, 200)
    
    return () => {
      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current)
        transitionTimerRef.current = null
      }
    }
  }, [currentStep, isWalkthroughOpen, updateTargetRect])

  // Navigate to the correct page for current step
  useEffect(() => {
    if (!isWalkthroughOpen || !step) return

    const targetUrl = step.tab ? `${step.page}?tab=${step.tab}` : step.page
    const currentTab = searchParams.get('tab')
    const needsNav = pathname !== step.page || (step.tab && currentTab !== step.tab)

    if (needsNav) {
      router.push(targetUrl)
    } else {
      // Small delay to let page render before finding element
      setTimeout(updateTargetRect, 300)
    }
  }, [isWalkthroughOpen, step, pathname, searchParams, router, updateTargetRect])

  // Update target rect on scroll/resize
  useEffect(() => {
    if (!isWalkthroughOpen) return

    const handleUpdate = () => updateTargetRect()
    window.addEventListener('resize', handleUpdate)
    window.addEventListener('scroll', handleUpdate)

    return () => {
      window.removeEventListener('resize', handleUpdate)
      window.removeEventListener('scroll', handleUpdate)
    }
  }, [isWalkthroughOpen, updateTargetRect])

  if (!isWalkthroughOpen) return null

  const handleNext = () => {
    if (isLastStep) {
      completeWalkthrough()
    } else {
      nextStep()
    }
  }

  const handleSkip = () => {
    router.push('/dashboard')
    completeWalkthrough() // Persist so walkthrough won't show again
  }

  const handleNeverShowAgain = () => {
    router.push('/dashboard')
    completeWalkthrough()
  }

  const padding = step?.highlightPadding ?? 8

  // Parse border radius to get numeric value for SVG
  const parseBorderRadius = (radius: string): number => {
    const match = radius.match(/^([\d.]+)/)
    if (match) {
      const value = parseFloat(match[1])
      // If it's in rem, convert to px (assuming 16px base)
      if (radius.includes('rem')) {
        return value * 16
      }
      return value
    }
    return 8
  }

  const borderRadiusValue = parseBorderRadius(targetBorderRadius)

  // Calculate tooltip position with viewport bounds checking (uses displayedStep for consistency)
  const getTooltipStyle = (): React.CSSProperties => {
    const stepForPosition = walkthroughSteps[displayedStep] ?? walkthroughSteps[0]
    if (stepForPosition?.position === 'center' || !targetRect) {
      return {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      }
    }

    const tooltipWidth = 320
    const tooltipHeight = 200 // Approximate height
    const tooltipMargin = 16
    const viewportPadding = 16

    // Calculate the ideal position based on the specified direction
    let top: number | undefined
    let left: number | undefined
    let bottom: number | undefined
    let right: number | undefined
    let transform: string | undefined

    switch (stepForPosition?.position) {
      case 'top':
        bottom = window.innerHeight - targetRect.top + tooltipMargin + padding
        left = Math.max(viewportPadding, Math.min(
          targetRect.left + targetRect.width / 2 - tooltipWidth / 2,
          window.innerWidth - tooltipWidth - viewportPadding
        ))
        break
      case 'bottom':
        top = targetRect.bottom + tooltipMargin + padding
        left = Math.max(viewportPadding, Math.min(
          targetRect.left + targetRect.width / 2 - tooltipWidth / 2,
          window.innerWidth - tooltipWidth - viewportPadding
        ))
        break
      case 'left':
        top = targetRect.top + targetRect.height / 2
        right = window.innerWidth - targetRect.left + tooltipMargin + padding
        transform = 'translateY(-50%)'
        break
      case 'right':
        top = targetRect.top + targetRect.height / 2
        left = targetRect.right + tooltipMargin + padding
        transform = 'translateY(-50%)'
        break
    }

    // Adjust vertical position if tooltip would go off screen
    if (top !== undefined) {
      // For positions using transform translateY(-50%), adjust the center point
      if (transform?.includes('translateY(-50%)')) {
        const centeredTop = top - tooltipHeight / 2
        if (centeredTop < viewportPadding) {
          // Would go off top - remove transform and position from top
          top = viewportPadding
          transform = undefined
        } else if (centeredTop + tooltipHeight > window.innerHeight - viewportPadding) {
          // Would go off bottom - position from bottom instead
          top = window.innerHeight - tooltipHeight - viewportPadding
          transform = undefined
        }
      } else {
        // Direct top positioning
        if (top < viewportPadding) {
          top = viewportPadding
        } else if (top + tooltipHeight > window.innerHeight - viewportPadding) {
          top = window.innerHeight - tooltipHeight - viewportPadding
        }
      }
    }

    // Adjust if using bottom positioning and would go off top
    if (bottom !== undefined) {
      const calculatedTop = window.innerHeight - bottom - tooltipHeight
      if (calculatedTop < viewportPadding) {
        // Switch to top positioning instead
        bottom = undefined
        top = viewportPadding
      }
    }

    // Adjust horizontal position for left/right positioned tooltips
    if (right !== undefined) {
      const calculatedLeft = window.innerWidth - right - tooltipWidth
      if (calculatedLeft < viewportPadding) {
        // Not enough room on left, switch to right side
        right = undefined
        left = targetRect.right + tooltipMargin + padding
      }
    }

    if (left !== undefined && stepForPosition?.position === 'right') {
      if (left + tooltipWidth > window.innerWidth - viewportPadding) {
        // Not enough room on right, switch to left side
        left = undefined
        right = window.innerWidth - targetRect.left + tooltipMargin + padding
      }
    }

    return {
      position: 'fixed',
      ...(top !== undefined && { top: `${top}px` }),
      ...(bottom !== undefined && { bottom: `${bottom}px` }),
      ...(left !== undefined && { left: `${left}px` }),
      ...(right !== undefined && { right: `${right}px` }),
      ...(transform && { transform }),
    }
  }

  const mockView = displayStep?.mockView || 'none'
  const displayStepForSpotlight = walkthroughSteps[displayedStep]
  const showSpotlight = targetRect && displayStepForSpotlight?.position !== 'center' && displayStepForSpotlight?.mockView !== 'recording-modal'

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Unified transition wrapper - overlay, highlight, mock view, tooltip fade together */}
      <div
        className={`absolute inset-0 transition-opacity duration-200 ${
          isTransitioning ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {/* Dark overlay with cutout for highlighted element */}
        <svg 
          className="absolute inset-0 w-full h-full"
          style={{ pointerEvents: 'none' }}
        >
          <defs>
            <mask id="spotlight-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              {showSpotlight && targetRect && (
                <rect
                  x={targetRect.left - padding}
                  y={targetRect.top - padding}
                  width={targetRect.width + padding * 2}
                  height={targetRect.height + padding * 2}
                  rx={borderRadiusValue + padding / 2}
                  fill="black"
                />
              )}
            </mask>
          </defs>
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="rgba(0, 0, 0, 0.75)"
            mask="url(#spotlight-mask)"
          />
        </svg>

        {/* Highlight border around target element - hide for recording modal mock */}
        <div
          className={`absolute border-2 border-cosmic-orange pointer-events-none ${
            showSpotlight ? 'opacity-100' : 'opacity-0'
          }`}
          style={{
            left: targetRect ? targetRect.left - padding : 0,
            top: targetRect ? targetRect.top - padding : 0,
            width: targetRect ? targetRect.width + padding * 2 : 0,
            height: targetRect ? targetRect.height + padding * 2 : 0,
            borderRadius: `${borderRadiusValue + padding / 2}px`,
            boxShadow: '0 0 0 4px rgba(255, 150, 40, 0.2), 0 0 20px rgba(255, 150, 40, 0.3)',
          }}
        />

        {/* Mock View Display */}
        <div className={mockView !== 'none' ? '' : 'pointer-events-none'}>
          {mockView !== 'none' && <MockViewComponent view={mockView} />}
        </div>

        {/* Clickable overlay to prevent interactions */}
        <div 
          className="absolute inset-0" 
          onClick={(e) => e.stopPropagation()}
          style={{ pointerEvents: 'auto' }}
        />

        {/* Tooltip */}
        <div
            className="glass-container p-5 w-80 border border-cosmic-orange/30 bg-dark-gray/95 backdrop-blur-xl"
            style={{
              ...getTooltipStyle(),
              pointerEvents: 'auto',
              zIndex: 101,
            }}
          >
            {/* Step indicator */}
            <div className="text-caption text-cosmic-orange mb-2">
              Step {displayedStep + 1} of {walkthroughSteps.length}
            </div>

            {/* Content */}
            <h3 className="text-heading-md text-secondary-white mb-2">
              {displayStep.title}
            </h3>
            <p className="text-body-sm text-medium-gray mb-4">
              {displayStep.description}
            </p>

          {/* Navigation - always visible */}
          <div className="flex items-center justify-between">
            {isFirstStep ? (
              <button
                onClick={handleSkip}
                disabled={isTransitioning}
                className="text-body-sm text-medium-gray hover:text-secondary-white transition-colors disabled:opacity-50"
              >
                Skip tour
              </button>
            ) : (
              <button
                onClick={prevStep}
                disabled={isTransitioning}
                className="flex items-center gap-1 text-body-sm text-medium-gray hover:text-secondary-white transition-colors disabled:opacity-50"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>
            )}

            <button
              onClick={handleNext}
              disabled={isTransitioning}
              className="btn-primary px-4 py-2 text-body-sm flex items-center gap-1 disabled:opacity-50"
            >
              {isLastStep ? (
                'Get Started'
              ) : (
                <>
                  Next
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </>
              )}
            </button>
          </div>

          {/* Don't show again option - first step only */}
          {isFirstStep && (
            <div className="mt-3 pt-3 border-t border-white/10 text-center">
              <button
                onClick={handleNeverShowAgain}
                className="text-caption text-medium-gray hover:text-secondary-white transition-colors"
              >
                Don&apos;t show this again
              </button>
            </div>
          )}

          {/* Close button */}
          <button
            onClick={handleSkip}
            className="absolute top-3 right-3 text-medium-gray hover:text-secondary-white transition-colors"
            aria-label="Close walkthrough"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
