'use client'

import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AuthProvider } from '@/contexts/AuthContext'
import { WalkthroughProvider } from '@/contexts/WalkthroughContext'
import DashboardNav, { useSidebar, SidebarProvider } from '@/components/dashboard/DashboardNav'
import Walkthrough from '@/components/dashboard/Walkthrough'

function DashboardContent({ children }: { children: React.ReactNode }) {
  const { isCollapsed } = useSidebar()
  
  return (
    <div className="min-h-screen bg-black flex">
      <DashboardNav />
      {/* Mobile gradient overlay for logo visibility */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-20 bg-[linear-gradient(to_bottom,_black_0%,_black_35%,_rgba(0,0,0,0.7)_55%,_rgba(0,0,0,0.3)_75%,_transparent_100%)] z-30 pointer-events-none" />
      {/* Extra darkness in top-left corner behind logo */}
      <div className="md:hidden fixed top-0 left-0 w-40 h-16 bg-[radial-gradient(ellipse_at_top_left,_rgba(0,0,0,0.9)_0%,_rgba(0,0,0,0.5)_40%,_transparent_70%)] z-30 pointer-events-none" />
      <main className={`flex-1 p-4 pt-16 md:pt-8 md:p-8 min-w-0 transition-all duration-300 ease-in-out ${
        isCollapsed ? 'ml-0 md:ml-[72px]' : 'ml-0 md:ml-[218px]'
      }`}>
        <div className="w-full">
          <Suspense fallback={null}>
            {children}
          </Suspense>
        </div>
      </main>
      {/* Walkthrough Modal - wrapped in Suspense for useSearchParams() during static generation */}
      <Suspense fallback={null}>
        <Walkthrough />
      </Suspense>
    </div>
  )
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <WalkthroughProvider>
        <SidebarProvider>
          <DashboardContent>{children}</DashboardContent>
        </SidebarProvider>
      </WalkthroughProvider>
    </AuthProvider>
  )
}

