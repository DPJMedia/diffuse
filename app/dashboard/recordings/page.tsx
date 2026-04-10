import dynamic from 'next/dynamic'
import { GridPageSkeleton } from '@/components/dashboard/Skeletons'

/**
 * Load the full recordings UI only in the browser. A server bundle for this ~3k-line
 * client module pulls broken webpack async chunks in Next 14 dev (Cannot find module './8948.js').
 */
const RecordingsPageClient = dynamic(() => import('./RecordingsPageClient'), {
  ssr: false,
  loading: () => <GridPageSkeleton viewMode="grid" />,
})

export default function RecordingsPage() {
  return <RecordingsPageClient />
}
