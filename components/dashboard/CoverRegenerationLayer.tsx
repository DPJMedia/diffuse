'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'

/** `idle` — single image. `processing` — regen in flight (blur + spinner). `check` — pending new image; blur fades to reveal sharp. */
export type CoverRegenPhase = 'idle' | 'processing' | 'check'

const BLUR_FADE_MS = 900

type Props = {
  phase: CoverRegenPhase
  snapshotUrl: string
  /** New image URL when phase is `check` (pending review). */
  sharpUrl: string | null
  alt: string
  sizes: string
  className?: string
  imageClassName?: string
}

export default function CoverRegenerationLayer({
  phase,
  snapshotUrl,
  sharpUrl,
  alt,
  sizes,
  className = 'relative w-full h-[40vh] min-h-[200px]',
  imageClassName = 'object-contain',
}: Props) {
  const [blurFade, setBlurFade] = useState(1)

  useEffect(() => {
    if (phase !== 'check' || !sharpUrl) {
      setBlurFade(1)
      return
    }
    setBlurFade(1)
    const t = requestAnimationFrame(() => {
      setBlurFade(0)
    })
    return () => cancelAnimationFrame(t)
  }, [phase, sharpUrl, snapshotUrl])

  const proxy = (u: string) => u.startsWith('/api/proxy-image')
  const apiRoute = (u: string) => u.startsWith('/api/')

  if (phase === 'idle') {
    return (
      <div className={`${className} overflow-hidden rounded-glass bg-white/5 leading-none`}>
        <Image
          src={snapshotUrl}
          alt={alt}
          fill
          sizes={sizes}
          className={imageClassName}
          referrerPolicy={proxy(snapshotUrl) ? 'no-referrer' : undefined}
          unoptimized={apiRoute(snapshotUrl)}
        />
      </div>
    )
  }

  /** Review: user rejected the new cover — show previous snapshot only (no sharp layer). */
  if (phase === 'check' && !sharpUrl) {
    return (
      <div className={`${className} overflow-hidden rounded-glass bg-white/5 leading-none`}>
        <Image
          src={snapshotUrl}
          alt={alt}
          fill
          sizes={sizes}
          className={imageClassName}
          referrerPolicy={proxy(snapshotUrl) ? 'no-referrer' : undefined}
          unoptimized={apiRoute(snapshotUrl)}
        />
      </div>
    )
  }

  const showSharpUnder = phase === 'check' && sharpUrl

  return (
    <div
      className={`${className} relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-glass bg-white/5 leading-none`}
    >
      {showSharpUnder && (
        <Image
          key={sharpUrl}
          src={sharpUrl}
          alt={alt}
          fill
          sizes={sizes}
          className={`${imageClassName} z-0`}
          referrerPolicy={proxy(sharpUrl) ? 'no-referrer' : undefined}
          unoptimized={apiRoute(sharpUrl)}
        />
      )}

      {/* Blurred snapshot: processing = full blur + spinner; check = fades out to reveal sharp */}
      {(phase === 'processing' || (phase === 'check' && sharpUrl)) && (
        <div
          className={`absolute inset-0 z-10 flex min-h-0 min-w-0 items-center justify-center ${phase === 'check' && sharpUrl && blurFade < 0.01 ? 'pointer-events-none' : ''}`}
          style={
            phase === 'check' && sharpUrl
              ? { opacity: blurFade, transition: `opacity ${BLUR_FADE_MS}ms ease-out` }
              : undefined
          }
        >
          <div className="absolute inset-0 bg-black/25 z-[1]" aria-hidden />
          <img
            src={snapshotUrl}
            alt=""
            className="absolute inset-0 z-0 block h-full w-full object-cover object-bottom blur-xl opacity-95"
            referrerPolicy={proxy(snapshotUrl) ? 'no-referrer' : undefined}
            draggable={false}
          />
          {phase === 'processing' && (
            <div className="relative z-20 flex flex-col items-center gap-2">
              <svg
                className="h-9 w-9 text-cosmic-orange animate-spin"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
