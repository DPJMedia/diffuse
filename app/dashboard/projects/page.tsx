import { redirect } from 'next/navigation'

/** Project list lives at /dashboard; this path is linked from a few places. */
export default function DashboardProjectsIndex() {
  redirect('/dashboard')
}
