/**
 * Section-shaped skeleton loading components for the dashboard.
 * Replace full-page / modal-content LoadingSpinner instances with these.
 * Action-level spinners (buttons, inline progress) are intentionally left as-is.
 *
 * Type-scale reference (from tailwind.config.ts):
 *   text-display-sm  → 36px / lh 1.2 → rendered ~43px  → h-10 (40px)
 *   text-heading-lg  → 24px / lh 1.4 → rendered ~34px  → h-8  (32px)
 *   text-heading-md  → 20px / lh 1.4 → rendered ~28px  → h-7  (28px)
 *   text-body-lg     → 18px / lh 1.6 → rendered ~29px  → h-7  (28px)
 *   text-body-md     → 16px / lh 1.6 → rendered ~26px  → h-6  (24px)
 *   text-body-sm     → 14px / lh 1.6 → rendered ~22px  → h-[22px]
 *   text-caption     → 12px / lh 1.5 → rendered ~18px  → h-[18px]
 */

import { type ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Container-level placeholder — matches glass-container bg-white/5 surface */
function SkeletonBlock({
  className = '',
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  return (
    <div className={`bg-white/5 rounded-glass animate-pulse ${className}`}>
      {children}
    </div>
  )
}

/** Inline text-bar placeholder — slightly lighter than the block surface */
function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`bg-white/[0.07] rounded animate-pulse ${className}`} />
}
//
// Real card layout:
//   h3.text-heading-md mb-4           — title ~28px + 16px gap
//   div.space-y-2                      — 8px between rows
//     span.text-caption               — ~18px per row (×2)
//   div.mt-4 flex gap-2               — badge chips ~20px + 16px gap (optional)
// ---------------------------------------------------------------------------

function SkeletonCard() {
  return (
    <div className="glass-container p-6">
      {/* Title: text-heading-md ~28px → h-7, mb-4 matches real card */}
      <SkeletonLine className="w-3/4 h-7 mb-4" />
      {/* Metadata: text-caption ~18px per row */}
      <div className="space-y-2">
        <SkeletonLine className="w-1/2 h-[18px]" />
        <SkeletonLine className="w-2/5 h-[18px]" />
      </div>
      {/* Tag/badge row: mt-4 matches real card, pill shapes */}
      <div className="mt-4 flex gap-2">
        <SkeletonBlock className="w-14 h-[18px] rounded-full" />
        <SkeletonBlock className="w-10 h-[18px] rounded-full" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// List-view row: matches the compact horizontal layout used when viewMode='list'
//
// Real row: glass-container p-4 flex items-center gap-4
//   icon square  w-10 h-10 bg-white/5 rounded-glass   (flex-shrink-0)
//   info stack   flex-1 min-w-0
//     h3.text-body-md mb-1                             ~26px
//     div.flex.text-caption                            ~18px
//   status badge px-2 py-1 bg-white/5 rounded text-caption  ~26px tall
//   arrow svg    w-5 h-5                               (flex-shrink-0)
//
// Total row height: p-4 (32px) + max(icon 40px, text 48px) = ~80px
// ---------------------------------------------------------------------------

function SkeletonRow() {
  return (
    <div className="glass-container p-4 flex items-center gap-4">
      {/* Icon square */}
      <SkeletonBlock className="w-10 h-10 flex-shrink-0" />
      {/* Title + metadata */}
      <div className="flex-1 min-w-0 space-y-1.5">
        <SkeletonLine className="w-1/2 h-6" />
        <SkeletonLine className="w-1/3 h-[18px]" />
      </div>
      {/* Status badge: px-2 py-1 ≈ 8px h-padding + 18px text = ~26px tall */}
      <SkeletonBlock className="w-20 h-[26px] rounded flex-shrink-0" />
      {/* Chevron arrow */}
      <SkeletonBlock className="w-5 h-5 flex-shrink-0" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared page header skeleton
//
// Real header: flex items-center justify-between mb-8
//   h1.text-display-sm  (left)
//   div.hidden md:flex items-center gap-3 (right, optional)
// ---------------------------------------------------------------------------

function SkeletonPageHeader({
  showSubtitle = false,
  rightSlot,
}: {
  showSubtitle?: boolean
  /** Override the right-side buttons. Defaults to: icon + icon + primary */
  rightSlot?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between mb-8">
      <div className={showSubtitle ? 'space-y-2' : undefined}>
        {/* text-display-sm: 36px font, 1.2 line-height → rendered ~43px → h-10 */}
        <SkeletonLine className="w-48 h-10" />
        {showSubtitle && (
          /* text-body-md subtitle: ~26px → h-[17px] visually lighter bar */
          <SkeletonLine className="w-72 h-[17px]" />
        )}
      </div>
      <div className="hidden md:flex items-center gap-3">
        {rightSlot ?? (
          /* Default matches Projects / Advertisements / Recordings:
             Edit icon (w-10 h-10) + View-toggle icon (w-10 h-10) + primary (w-36 h-10) */
          <>
            <SkeletonBlock className="w-10 h-10 flex-shrink-0" />
            <SkeletonBlock className="w-10 h-10 flex-shrink-0" />
            <SkeletonBlock className="w-36 h-10 flex-shrink-0" />
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// GridPageSkeleton
// Used by: Projects, Advertisements, Shared With Me, Organizations, Recordings
//
// showHeader=true  (default): full-page auth-gate replacement — renders the
//   header skeleton + card grid.
// showHeader=false: inline data-loading — the real page header is already
//   visible above; renders only the card grid to avoid a duplicate title row.
//
// viewMode='grid' (default): 3-col responsive card grid.
// viewMode='list': single-column rows matching the compact list layout.
// ---------------------------------------------------------------------------

export function GridPageSkeleton({
  cardCount = 6,
  showHeader = true,
  viewMode = 'grid',
}: {
  cardCount?: number
  showHeader?: boolean
  viewMode?: 'grid' | 'list'
}) {
  return (
    <div>
      {showHeader && <SkeletonPageHeader />}
      {viewMode === 'list' ? (
        // List mode: single-column stack of compact rows (gap-3 matches real list container)
        <div className="flex flex-col gap-3">
          {Array.from({ length: cardCount }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : (
        // Grid mode: responsive 3-column card grid
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
          {Array.from({ length: cardCount }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SettingsPageSkeleton
//
// Real layout: title + subtitle → max-w-4xl div with stacked glass-container
//   sections: Organizations (optional), Profile, Help, Delete Account
// ---------------------------------------------------------------------------

function SkeletonSettingsSection({
  rows = 2,
  showRowButton = true,
}: {
  rows?: number
  showRowButton?: boolean
}) {
  return (
    <SkeletonBlock className="border border-white/10 p-6 mb-6">
      {/* Section heading: text-heading-lg ~34px → h-8 */}
      <SkeletonLine className="w-40 h-8 mb-6" />
      <div className="space-y-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <div className="space-y-1.5 flex-1">
              {/* Label: text-caption ~18px */}
              <SkeletonLine className="w-24 h-[18px]" />
              {/* Value: text-body-md ~26px → h-6 */}
              <SkeletonLine className="w-48 h-6" />
            </div>
            {/* Row action button for first row only */}
            {showRowButton && i === 0 && (
              <SkeletonBlock className="w-28 h-10 hidden sm:block flex-shrink-0" />
            )}
          </div>
        ))}
      </div>
    </SkeletonBlock>
  )
}

export function SettingsPageSkeleton() {
  return (
    <div>
      {/* Header: title + subtitle, no action buttons */}
      <div className="flex items-center justify-between mb-8">
        <div className="space-y-2">
          <SkeletonLine className="w-36 h-10" />
          <SkeletonLine className="w-72 h-[17px]" />
        </div>
      </div>
      <div className="w-full max-w-4xl">
        {/* Organizations list section */}
        <SkeletonSettingsSection rows={2} showRowButton />
        {/* Profile section */}
        <SkeletonSettingsSection rows={2} showRowButton={false} />
        {/* Help & Support section */}
        <SkeletonSettingsSection rows={1} showRowButton />
        {/* Delete Account — single row with danger button */}
        <SkeletonBlock className="border border-white/10 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <SkeletonLine className="w-72 h-[17px]" />
            <SkeletonBlock className="w-32 h-10 flex-shrink-0" />
          </div>
        </SkeletonBlock>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SubscriptionPageSkeleton
//
// Real layout: title + subtitle → Individual Plans heading + 4-col grid →
//   Enterprise heading + CTA banner + 3-col grid
// ---------------------------------------------------------------------------

function SkeletonPlanCard() {
  return (
    <SkeletonBlock className="border border-white/10 p-6 flex flex-col min-h-[200px]">
      {/* Plan name: text-heading-md ~28px → h-7 */}
      <SkeletonLine className="w-24 h-7 mb-3" />
      {/* Description lines: text-body-sm ~22px, min-h-[4.5rem] in real card */}
      <div className="min-h-[4.5rem] space-y-2 mb-6">
        <SkeletonLine className="w-full h-[18px]" />
        <SkeletonLine className="w-3/4 h-[18px]" />
      </div>
      {/* CTA button: full width, h-10ish */}
      <SkeletonBlock className="h-10 w-full mt-auto" />
    </SkeletonBlock>
  )
}

export function SubscriptionPageSkeleton() {
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="space-y-2">
          <SkeletonLine className="w-24 h-10" />
          <SkeletonLine className="w-56 h-[17px]" />
        </div>
      </div>

      {/* Individual Plans */}
      <div className="mb-12">
        {/* Section heading: text-heading-lg ~34px → h-8 + mb-6 */}
        <SkeletonLine className="w-44 h-8 mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonPlanCard key={i} />
          ))}
        </div>
      </div>

      {/* Enterprise Plans */}
      <div>
        <SkeletonLine className="w-44 h-8 mb-6" />
        {/* "Join an organization" notice card */}
        <SkeletonBlock className="border border-white/10 p-6 mb-6">
          <SkeletonLine className="w-80 h-[17px]" />
        </SkeletonBlock>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <SkeletonPlanCard key={i} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// OrganizationDetailSkeleton
//
// Real layout:
//   Header: back chevron (w-5 h-5 icon) + title (text-display-sm) + description
//   Stats: grid-cols-3 gap-4 — each cell: label (text-body-sm) + value (text-heading-lg)
//   Projects: subheader + CTA + grid-cols 3 cards
//   Members: table with NAME / PROJECTS / ROLE columns
// ---------------------------------------------------------------------------

export function OrganizationDetailSkeleton() {
  return (
    <div className="overflow-x-hidden">
      {/* Header: back icon + title + description */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          {/* Back chevron svg: w-5 h-5 */}
          <SkeletonBlock className="w-5 h-5 flex-shrink-0" />
          {/* Title: text-display-sm ~43px → h-10 */}
          <SkeletonLine className="w-56 h-10" />
        </div>
        {/* Description: text-body-md ~26px → h-[17px]; ml-8 to clear back icon gap */}
        <SkeletonLine className="w-80 h-[17px] ml-8" />
      </div>

      {/* 3 stat cards: grid-cols-3 gap-4 mb-8 */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonBlock key={i} className="border border-white/10 p-4 flex flex-col items-center gap-2">
            {/* Label: text-body-sm ~22px → h-[22px] */}
            <SkeletonLine className="w-16 h-[22px]" />
            {/* Value: text-heading-lg ~34px → h-8 */}
            <SkeletonLine className="w-10 h-8" />
          </SkeletonBlock>
        ))}
      </div>

      {/* Projects subheader: flex items-center justify-between mb-4 */}
      <div className="flex items-center justify-between mb-4">
        {/* "Projects" heading: text-heading-lg ~34px → h-8 */}
        <SkeletonLine className="w-28 h-8" />
        {/* Create Project button: btn-primary px-4 py-2 → h-10 */}
        <SkeletonBlock className="w-36 h-10" />
      </div>
      {/* Project cards: same grid as other pages */}
      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4 mb-12">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>

      {/* Members heading: text-heading-lg ~34px → h-8 */}
      <SkeletonLine className="w-28 h-8 mb-4" />
      {/* Members table */}
      <SkeletonBlock className="border border-white/10 mb-12">
        {/* Table header row: py-4 px-6, 3 column labels */}
        <div className="border-b border-white/10 flex items-center gap-8 px-6 py-4">
          <SkeletonLine className="w-20 h-[18px]" />
          <SkeletonLine className="w-16 h-[18px]" />
          <SkeletonLine className="w-12 h-[18px]" />
        </div>
        {/* 3 member rows */}
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="border-b border-white/10 last:border-b-0 flex items-center gap-8 px-6 py-4">
            {/* Name: body-md ~26px → h-6 */}
            <SkeletonLine className="w-32 h-6" />
            {/* Project count: single digit */}
            <SkeletonLine className="w-6 h-6" />
            {/* Role badge: rounded-full pill */}
            <SkeletonBlock className="w-20 h-7 rounded-full" />
          </div>
        ))}
      </SkeletonBlock>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ProjectDetailSkeleton
//
// Exact replica of the two-column layout with responsive behavior.
// Only database-loaded content (project data, inputs, outputs, images) shows skeleton animation.
// All static UI structure (buttons, section headers, containers) renders normally.
// ---------------------------------------------------------------------------

export function ProjectDetailSkeleton() {
  return (
    <div>
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="mb-6">
        <button className="inline-flex items-center gap-1.5 text-medium-gray hover:text-secondary-white transition-colors text-body-sm mb-3">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          All Projects
        </button>
        {/* Project name - ANIMATED (from database) */}
        <SkeletonLine className="w-64 h-8 mb-1" />
        {/* Project description - ANIMATED (from database) */}
        <SkeletonLine className="w-96 h-[22px]" />
      </div>

      {/* ── Two-column layout ──────────────────────────────── */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">

        {/* ── Left: Output column ───────────────────────── */}
        <div className="flex-1 min-w-0">
          {/* Output display area */}
          <div>
            {/* Current output card - ANIMATED (from database) */}
            <div className="glass-container p-5 mb-4">
              {/* Output type label */}
              <div className="flex items-center gap-2 mb-2">
                <SkeletonBlock className="w-3.5 h-3.5 flex-shrink-0" />
                <SkeletonLine className="w-20 h-[18px]" />
              </div>
              {/* Output title */}
              <SkeletonLine className="w-3/4 h-6 mb-1" />
              {/* Output subtitle */}
              <SkeletonLine className="w-2/3 h-[18px] mb-2" />
              {/* Output excerpt */}
              <div className="space-y-2 mb-3">
                <SkeletonLine className="w-full h-[18px]" />
                <SkeletonLine className="w-full h-[18px]" />
                <SkeletonLine className="w-5/6 h-[18px]" />
              </div>
              {/* Author and date */}
              <SkeletonLine className="w-48 h-[18px]" />
            </div>

            {/* Past outputs section */}
            <div className="mt-4 border-t border-white/10 pt-3">
              <p className="text-caption text-medium-gray uppercase tracking-wider mb-1">Past Outputs</p>
              {/* Past output items - ANIMATED (from database) */}
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="border-b border-white/10 last:border-b-0">
                  <div className="w-full flex items-center justify-between py-2.5 px-1">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <SkeletonBlock className="flex-shrink-0 w-3.5 h-3.5" />
                      <SkeletonLine className="flex-1 h-[22px]" />
                      <SkeletonLine className="w-16 h-[18px] flex-shrink-0" />
                    </div>
                    <svg className="w-3.5 h-3.5 text-medium-gray flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right sidebar — single container ──────────── */}
        <div className="w-full lg:w-72 xl:w-80 flex-shrink-0 glass-container overflow-hidden">

          {/* Quick + Generate buttons — STATIC UI */}
          <div className="flex border-b border-white/10">
            <button
              disabled
              className="btn-secondary border-0 border-r border-secondary-white/25 flex-1 py-3 gap-1.5 text-body-sm rounded-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Quick
            </button>
            <button
              disabled
              className="btn-primary flex-1 py-3 gap-1.5 text-body-sm rounded-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              Generate
            </button>
          </div>

          {/* Inputs section - STATIC structure */}
          <div className="border-b border-white/10">
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-body-sm text-secondary-white font-medium">
                Inputs <span className="text-body-sm text-medium-gray"></span>
              </p>
              <button className="text-caption text-medium-gray hover:text-secondary-white transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>
            {/* Input items - ANIMATED (from database) */}
            <div className="space-y-0.5 px-4 pb-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="relative group">
                  <div className="w-full flex items-center gap-2 py-2 px-2 rounded hover:bg-white/10 transition-colors">
                    <SkeletonBlock className="flex-shrink-0 w-3.5 h-3.5" />
                    <SkeletonLine className="flex-1 h-[22px]" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Images section - STATIC structure */}
          <div className="border-b border-white/10">
            <button className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors">
              <p className="text-body-sm text-secondary-white font-medium">
                Images <span className="text-body-sm text-medium-gray"></span>
              </p>
              <svg className="w-3.5 h-3.5 text-medium-gray transition-transform rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {/* Image grid - ANIMATED (from database) */}
            <div className="grid grid-cols-3 gap-2 px-4 pb-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonBlock key={i} className="aspect-square rounded-glass" />
              ))}
            </div>
          </div>

          {/* Visibility section - STATIC structure */}
          <div className="border-b border-white/10">
            <button className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors">
              <p className="text-body-sm text-secondary-white font-medium">
                Visibility <span className="text-body-sm text-medium-gray"></span>
              </p>
              <svg className="w-3.5 h-3.5 text-medium-gray transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          {/* Settings section - STATIC structure */}
          <div>
            <button className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors">
              <p className="text-body-sm text-secondary-white font-medium">Settings</p>
              <svg className="w-3.5 h-3.5 text-medium-gray transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SelectRecordingModalSkeleton
// Used inside ModalShell's ModalScrollRegion
//
// Real row layout: p-4 rounded-glass border
//   checkbox (w-5 h-5) + mic icon (w-5 h-5) + title+date stack + duration
// ---------------------------------------------------------------------------

export function SelectRecordingModalSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="p-4 rounded-glass border border-white/10 bg-white/5">
          <div className="flex items-center gap-4">
            {/* Checkbox: w-5 h-5 rounded border-2 */}
            <SkeletonBlock className="w-5 h-5 flex-shrink-0 rounded" />
            {/* Mic icon: w-5 h-5 */}
            <SkeletonBlock className="w-5 h-5 flex-shrink-0" />
            {/* Title + date */}
            <div className="flex-1 space-y-1.5">
              {/* Title: text-body-md ~26px → h-6 */}
              <SkeletonLine className="w-2/3 h-6" />
              {/* Date: text-caption ~18px */}
              <SkeletonLine className="w-1/3 h-[18px]" />
            </div>
            {/* Duration: text-caption ~18px, right-aligned */}
            <SkeletonLine className="w-12 h-[18px] flex-shrink-0" />
          </div>
        </div>
      ))}
    </div>
  )
}
