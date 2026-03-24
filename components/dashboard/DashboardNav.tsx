'use client'

import { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { createClient } from '@/lib/supabase/client'

// Context for mobile menu state
const MobileMenuContext = createContext<{
  isOpen: boolean
  setIsOpen: (open: boolean) => void
}>({ isOpen: false, setIsOpen: () => {} })

export const useMobileMenu = () => useContext(MobileMenuContext)

// Context for sidebar collapse state
const SidebarContext = createContext<{
  isCollapsed: boolean
  setIsCollapsed: (collapsed: boolean) => void
}>({ isCollapsed: false, setIsCollapsed: () => {} })

export const useSidebar = () => useContext(SidebarContext)

const subscriptionNames: Record<string, string> = {
  free: 'Free',
  pro: 'Pro',
  pro_max: 'Pro Max',
}

interface RecentProject {
  id: string
  name: string
  viewedAt: string
  projectType?: 'project' | 'advertisement'
}

// Function to add a recent project to the database
export async function addRecentProject(project: { id: string; name: string }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) return
  
  try {
    // Call the upsert function
    await supabase.rpc('upsert_recent_project', {
      p_user_id: user.id,
      p_project_id: project.id,
      p_project_name: project.name
    })
    
    // Dispatch event to notify the sidebar to refresh
    window.dispatchEvent(new Event('recentProjectsUpdated'))
  } catch (error) {
    console.error('Error saving recent project:', error)
  }
}

// Sidebar Provider Component
export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <SidebarContext.Provider value={{ isCollapsed: sidebarCollapsed, setIsCollapsed: setSidebarCollapsed }}>
      <MobileMenuContext.Provider value={{ isOpen: mobileMenuOpen, setIsOpen: setMobileMenuOpen }}>
        {children}
      </MobileMenuContext.Provider>
    </SidebarContext.Provider>
  )
}

export default function DashboardNav() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, userProfile, signOut, workspaces } = useAuth()
  const { isCollapsed: sidebarCollapsed, setIsCollapsed: setSidebarCollapsed } = useSidebar()
  const { isOpen: mobileMenuOpen, setIsOpen: setMobileMenuOpen } = useMobileMenu()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])
  const [recentExpanded, setRecentExpanded] = useState(false)
  const [subscriptionTier, setSubscriptionTier] = useState<string>('Free')
  const userMenuRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname, setMobileMenuOpen])

  // Close user menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false)
      }
    }

    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showUserMenu])

  // Remove a project from recent projects
  const removeFromRecent = async (e: React.MouseEvent, projectId: string) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (!user) return
    
    try {
      const { error } = await supabase
        .from('user_recent_projects')
        .delete()
        .eq('user_id', user.id)
        .eq('project_id', projectId)
      
      if (error) throw error
      
      // Update local state immediately for responsiveness
      setRecentProjects(prev => prev.filter(p => p.id !== projectId))
    } catch (error) {
      console.error('Error removing recent project:', error)
    }
  }

  // Load recent projects from database and validate they still exist
  const loadRecentProjects = useCallback(async () => {
    if (!user) return
    
    try {
      // Get recent projects from user's list
      const { data, error } = await supabase
        .from('user_recent_projects')
        .select('project_id, project_name, viewed_at')
        .eq('user_id', user.id)
        .order('viewed_at', { ascending: false })
        .limit(8)
      
      if (error) throw error
      if (!data || data.length === 0) {
        setRecentProjects([])
        return
      }
      
      // Get the project IDs to verify they still exist and are accessible
      const projectIds = data.map(item => item.project_id)
      
      // Check which projects still exist (RLS will filter out inaccessible ones)
      const { data: existingProjects, error: projectsError } = await supabase
        .from('diffuse_projects')
        .select('id, name, project_type')
        .in('id', projectIds)
      
      if (projectsError) throw projectsError
      
      // Create a map of existing project IDs to their details
      const existingProjectMap = new Map(
        (existingProjects || []).map(p => [p.id, { name: p.name, projectType: p.project_type }])
      )
      
      // Filter to only include projects that still exist
      const validProjects = data.filter(item => existingProjectMap.has(item.project_id))
      const invalidProjectIds = data
        .filter(item => !existingProjectMap.has(item.project_id))
        .map(item => item.project_id)
      
      // Remove invalid projects from user_recent_projects in the background
      if (invalidProjectIds.length > 0) {
        (async () => {
          try {
            await supabase
              .from('user_recent_projects')
              .delete()
              .eq('user_id', user.id)
              .in('project_id', invalidProjectIds)
          } catch (err) {
            console.error('Error cleaning up invalid recent projects:', err)
          }
        })()
      }
      
      // Update state with valid projects (use current name from database)
      const newProjects = validProjects.map(item => {
        const projectDetails = existingProjectMap.get(item.project_id)
        return {
          id: item.project_id,
          name: projectDetails?.name || item.project_name,
          viewedAt: item.viewed_at,
          projectType: projectDetails?.projectType || 'project'
        }
      })
      
      setRecentProjects(newProjects)
    } catch (error) {
      console.error('Error loading recent projects:', error)
    }
  }, [user, supabase])

  // Get user's individual subscription tier
  useEffect(() => {
    const tier = userProfile?.subscription_tier || 'free'
    setSubscriptionTier(subscriptionNames[tier] || 'Free')
  }, [userProfile])

  useEffect(() => {
    loadRecentProjects()
    
    // Listen for updates from window events
    window.addEventListener('recentProjectsUpdated', loadRecentProjects)
    
    // Supabase Realtime subscription for recent projects
    const recentProjectsChannel = supabase
      .channel('recent-projects-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_recent_projects',
        },
        () => {
          loadRecentProjects()
        }
      )
      .subscribe()

    // Also listen for project name changes
    const projectNamesChannel = supabase
      .channel('project-names-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'diffuse_projects',
        },
        () => {
          loadRecentProjects()
        }
      )
      .subscribe()

    return () => {
      window.removeEventListener('recentProjectsUpdated', loadRecentProjects)
      supabase.removeChannel(recentProjectsChannel)
      supabase.removeChannel(projectNamesChannel)
    }
  }, [loadRecentProjects, supabase])

  // Get display name - use full_name if available, otherwise email prefix
  const displayName = userProfile?.full_name || user?.email?.split('@')[0] || 'User'

  const navItems = [
    { 
      name: 'Organizations', 
      href: '/dashboard/organization',
      walkthroughId: 'nav-organizations',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      )
    },
    { 
      name: 'Projects', 
      href: '/dashboard',
      walkthroughId: 'nav-projects',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      )
    },
    { 
      name: 'Advertisements', 
      href: '/dashboard/advertisements',
      walkthroughId: 'nav-advertisements',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
        </svg>
      )
    },
    { 
      name: 'Shared With Me', 
      href: '/dashboard/shared',
      walkthroughId: 'nav-shared',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      )
    },
    { 
      name: 'Recordings', 
      href: '/dashboard/recordings',
      walkthroughId: 'nav-recordings',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
      )
    },
  ]

  const handleSignOut = async () => {
    await signOut()
    router.push('/')
  }

  return (
    <>
      {/* Mobile Menu Button - Only visible on mobile */}
      <button
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        className="md:hidden fixed top-4 left-4 z-50 flex items-center gap-1"
        aria-label="Toggle menu"
      >
        <span className="text-xl font-bold whitespace-nowrap flex items-center">
          <span className="text-white">D</span>
          <span 
            className={`inline-block overflow-hidden transition-all duration-300 ease-in-out text-white ${
              mobileMenuOpen ? 'max-w-[60px] opacity-100' : 'max-w-0 opacity-0'
            }`}
          >
            iffuse
          </span>
          <span className="text-cosmic-orange">.AI</span>
        </span>
        <svg 
          className={`w-4 h-4 text-medium-gray transition-transform duration-300 ${mobileMenuOpen ? 'rotate-180' : ''}`}
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {/* Mobile Overlay */}
      {mobileMenuOpen && (
        <div 
          className="md:hidden fixed inset-0 bg-black/60 z-30 backdrop-blur-sm"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Navigation Sidebar */}
      <nav 
        data-walkthrough="sidebar"
        className={`fixed top-0 left-0 bottom-0 bg-white/5 backdrop-blur-glass border-r border-white/10 flex flex-col z-40 transition-all duration-300 ease-in-out ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        } ${sidebarCollapsed ? 'md:w-[72px]' : 'w-64 md:w-[218px]'}`}
      >
            {/* Logo - Hidden on mobile since toggle button shows it */}
            <div className={`hidden md:flex items-center transition-all duration-300 ${sidebarCollapsed ? 'p-6 justify-center' : 'p-6 justify-between'}`}>
              <Link href="/" className="text-xl font-bold hover:text-cosmic-orange transition-colors">
                {sidebarCollapsed ? (
                  <>
                    <span className="text-white">D</span>
                    <span className="text-cosmic-orange">.AI</span>
                  </>
                ) : (
                  <>
                    Diffuse<span className="text-cosmic-orange">.AI</span>
                  </>
                )}
              </Link>
              {!sidebarCollapsed && (
                <button
                  onClick={() => setSidebarCollapsed(true)}
                  className="text-medium-gray hover:text-secondary-white transition-colors"
                  aria-label="Collapse sidebar"
                >
                  <svg 
                    className="w-4 h-4" 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}
            </div>
            {/* Collapsed state expand button */}
            {sidebarCollapsed && (
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="hidden md:flex items-center justify-center py-2 text-medium-gray hover:text-secondary-white transition-colors w-full"
                aria-label="Expand sidebar"
              >
                <svg 
                  className="w-4 h-4" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
            {/* Spacer for mobile to account for toggle button */}
            <div className="h-14 md:hidden" />

            {/* Navigation Items */}
            <div className="px-4 space-y-1">
              {navItems.map((item) => {
                const isActive = pathname === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    data-walkthrough={item.walkthroughId}
                    className={`flex items-center rounded-glass text-body-sm transition-colors ${
                      sidebarCollapsed ? 'justify-center py-2' : 'gap-3 px-4 py-2'
                    } ${
                      isActive
                        ? 'bg-cosmic-orange/20 text-cosmic-orange'
                        : 'text-secondary-white hover:bg-white/10'
                    }`}
                    title={sidebarCollapsed ? item.name : undefined}
                  >
                    {item.icon}
                    {!sidebarCollapsed && <span>{item.name}</span>}
                  </Link>
                )
              })}
            </div>

            {/* Recent Projects - Hidden when collapsed */}
            {!sidebarCollapsed && recentProjects.length > 0 && (
              <div className="px-4 mt-4">
                <button
                  onClick={() => setRecentExpanded(!recentExpanded)}
                  className="flex items-center gap-2 text-caption text-medium-gray uppercase tracking-wider mb-1 px-4 hover:text-secondary-white transition-colors"
                >
                  <span>Recent</span>
                  <svg 
                    className={`w-2.5 h-2.5 transition-transform duration-200 ${recentExpanded ? 'rotate-90' : ''}`} 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                    strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <div 
                  className={`overflow-hidden transition-all duration-300 ease-out ${
                    recentExpanded ? 'max-h-[400px] opacity-100' : 'max-h-0 opacity-0'
                  }`}
                >
                  <div className="space-y-1">
                    {recentProjects.slice(0, 8).map((project, index) => {
                      const isActive = pathname === `/dashboard/projects/${project.id}`
                      const isAd = project.projectType === 'advertisement'
                      
                      return (
                        <div
                          key={project.id}
                          className="group relative"
                          style={{
                            transform: recentExpanded ? 'translateY(0)' : 'translateY(-8px)',
                            opacity: recentExpanded ? 1 : 0,
                            transitionDelay: recentExpanded ? `${index * 25}ms` : '0ms',
                          }}
                        >
                          <Link
                            href={`/dashboard/projects/${project.id}`}
                            className={`flex w-full min-w-0 items-center gap-3 px-4 py-2 rounded-glass text-body-sm transition-all duration-200 ease-out ${
                              isActive
                                ? 'bg-cosmic-orange/20 text-cosmic-orange'
                                : 'text-secondary-white hover:bg-white/10'
                            }`}
                          >
                            {isAd ? (
                              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                              </svg>
                            ) : (
                              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            )}
                            <span className="truncate flex-1 pr-0">{project.name}</span>
                          </Link>
                          {/* Remove button - appears on hover */}
                          <button
                            onClick={(e) => removeFromRecent(e, project.id)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                            title="Remove from recent"
                          >
                            <svg 
                              className="w-3.5 h-3.5 text-medium-gray hover:text-red-500 transition-colors" 
                              fill="none" 
                              stroke="currentColor" 
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Spacer */}
            <div className="flex-1" />

            {/* Bottom Section */}
            <div className="p-4">
              {/* User Menu Button */}
              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className={`w-full bg-white/5 rounded-glass text-body-sm text-secondary-white hover:bg-white/10 transition-colors ${
                    sidebarCollapsed ? 'py-3 flex items-center justify-center' : 'px-4 py-3 text-left'
                  }`}
                  title={sidebarCollapsed ? displayName : undefined}
                >
                  {sidebarCollapsed ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  ) : (
                    <div className="truncate">
                      <div className="font-medium truncate">{displayName}</div>
                      <div className="text-caption uppercase tracking-wider text-cosmic-orange">
                        {subscriptionTier}
                      </div>
                    </div>
                  )}
                </button>

                {showUserMenu && (
                  <div className={`absolute bottom-full mb-1 bg-dark-gray border border-white/10 rounded-glass z-50 overflow-hidden ${
                    sidebarCollapsed ? 'left-full ml-2 w-48' : 'left-0 right-0'
                  }`}>
                    <Link
                      href="/dashboard/settings"
                      onClick={() => setShowUserMenu(false)}
                      className="flex items-center gap-3 w-full px-4 py-3 text-left text-body-sm text-secondary-white hover:bg-white/10 transition-colors border-b border-white/10"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      Settings
                    </Link>
                    <Link
                      href="/dashboard/subscription"
                      onClick={() => setShowUserMenu(false)}
                      className="flex items-center gap-3 w-full px-4 py-3 text-left text-body-sm text-secondary-white hover:bg-white/10 transition-colors border-b border-white/10"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                      </svg>
                      Plans
                    </Link>
                    <button
                      onClick={handleSignOut}
                      className="flex items-center gap-3 w-full px-4 py-3 text-left text-body-sm text-red-400/80 hover:bg-red-500/10 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                      Sign Out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </nav>
    </>
  )
}

