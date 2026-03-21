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

// ---------------------------------------------------------------------------
// Shared card: matches glass-container p-6 structure used across all grid pages
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
// ---------------------------------------------------------------------------

export function GridPageSkeleton({
  cardCount = 6,
  showHeader = true,
}: {
  cardCount?: number
  showHeader?: boolean
}) {
  return (
    <div>
      {showHeader && <SkeletonPageHeader />}
      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
        {Array.from({ length: cardCount }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
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
// Real layout:
//   Header: back chevron + title (text-display-sm) + description (text-body-lg)
//   Tabs: flex gap-4 mb-8 border-b border-white/10 — pb-3 px-4 per tab
//   Action row: flex md:justify-end gap-3 mb-4 — Settings icon + Delete icon + Add button
//   Card grid: grid-cols 3 — each card matches SkeletonCard structure with icon
// ---------------------------------------------------------------------------

export function ProjectDetailSkeleton() {
  return (
    <div>
      {/* Header: back + title + description */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          {/* Back chevron: w-5 h-5 */}
          <SkeletonBlock className="w-5 h-5 flex-shrink-0" />
          {/* Title: text-display-sm ~43px → h-10 */}
          <SkeletonLine className="w-64 h-10" />
        </div>
        {/* Description: text-body-lg ~29px → h-7; ml-8 to clear back icon */}
        <SkeletonLine className="w-80 h-7 ml-8" />
      </div>

      {/* Tab strip: flex gap-4 mb-8 border-b border-white/10 */}
      <div className="flex gap-4 mb-8 border-b border-white/10">
        {/* Each tab: pb-3 px-4 — text-body-md ~26px → h-6 */}
        {['w-20', 'w-24', 'w-24'].map((w, i) => (
          <div key={i} className="pb-3 px-4">
            <SkeletonLine className={`${w} h-6`} />
          </div>
        ))}
      </div>

      {/* Action row: flex md:justify-end gap-3 mb-4
          Settings icon (w-10 h-10) + Delete icon (w-10 h-10) + Add Input button (w-32 h-10) */}
      <div className="flex flex-col md:flex-row md:justify-end gap-3 mb-4">
        <SkeletonBlock className="w-10 h-10 flex-shrink-0" />
        <SkeletonBlock className="w-10 h-10 flex-shrink-0" />
        <SkeletonBlock className="w-32 h-10 flex-shrink-0" />
      </div>

      {/* Card grid: same structure as other pages but cards have an icon on the left */}
      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass-container p-6">
            <div className="flex items-start gap-3">
              {/* Type icon: p-2 rounded-lg bg-white/5 wrapping a w-4 h-4 icon → total ~32px */}
              <SkeletonBlock className="w-8 h-8 flex-shrink-0" />
              <div className="flex-1 space-y-2">
                {/* File name: text-heading-md ~28px → h-7 */}
                <SkeletonLine className="w-3/4 h-7" />
                {/* Type + size metadata: text-caption ~18px */}
                <SkeletonLine className="w-1/2 h-[18px]" />
                {/* Date: text-caption ~18px */}
                <SkeletonLine className="w-1/3 h-[18px]" />
              </div>
            </div>
          </div>
        ))}
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
