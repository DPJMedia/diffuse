import { Suspense } from 'react'
import LoadingSpinner from '@/components/dashboard/LoadingSpinner'
import ProjectOutputDetailClient from './ProjectOutputDetailClient'

export default function ProjectOutputDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
          <LoadingSpinner size="lg" />
          <p className="text-body-sm text-medium-gray">Loading…</p>
        </div>
      }
    >
      <ProjectOutputDetailClient />
    </Suspense>
  )
}
