'use client'

import { motion } from 'framer-motion'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

const navLinks = [
  { name: 'How It Works', href: '#how-it-works' },
  { name: 'Features', href: '#features' },
  { name: 'Live Example', href: '#use-cases' },
]

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const supabase = createClient()

  useEffect(() => {
    // Check if user is logged in
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [supabase.auth])

  const scrollToSection = (href: string) => {
    const element = document.querySelector(href)
    if (element) {
      const offset = 80
      const elementPosition = element.getBoundingClientRect().top
      const offsetPosition = elementPosition + window.pageYOffset - offset

      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      })
    }
    setMobileMenuOpen(false)
  }

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-glass">
        <div className="border-b border-white/10 bg-black/50">
          <div className="container-padding">
            <div className="max-w-7xl mx-auto flex items-center justify-between py-4">
              {/* Logo */}
              <Link
                href="/"
                className="text-lg sm:text-xl md:text-2xl font-bold hover:text-cosmic-orange transition-colors"
              >
                diffuse<span className="text-cosmic-orange">.ai</span>
              </Link>

              {/* Desktop Navigation */}
              <div className="hidden md:flex items-center gap-6 lg:gap-8">
                {navLinks.map((link) => (
                  <button
                    key={link.name}
                    onClick={() => scrollToSection(link.href)}
                    className="text-sm md:text-body-sm text-secondary-white hover:text-cosmic-orange transition-colors whitespace-nowrap"
                  >
                    {link.name}
                  </button>
                ))}
                {user ? (
                  <Link href="/dashboard" className="btn-primary px-5 py-2.5 text-sm md:text-body-sm whitespace-nowrap">
                    Dashboard
                  </Link>
                ) : (
                  <Link href="/login" className="btn-primary px-5 py-2.5 text-sm md:text-body-sm whitespace-nowrap">
                    Start Free
                  </Link>
                )}
              </div>

              {/* Mobile Menu Button */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden text-secondary-white p-2"
                aria-label="Toggle menu"
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {mobileMenuOpen ? (
                    <>
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </>
                  ) : (
                    <>
                      <line x1="3" y1="12" x2="21" y2="12" />
                      <line x1="3" y1="6" x2="21" y2="6" />
                      <line x1="3" y1="18" x2="21" y2="18" />
                    </>
                  )}
                </svg>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Menu */}
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{
          opacity: mobileMenuOpen ? 1 : 0,
          height: mobileMenuOpen ? 'auto' : 0,
        }}
        transition={{ duration: 0.3 }}
        className="fixed top-[72px] left-0 right-0 z-40 md:hidden overflow-hidden"
      >
        <div className="glass-container border-0 border-b border-white/10">
          <div className="container-padding">
            <div className="max-w-7xl mx-auto py-4 flex flex-col gap-4">
              {navLinks.map((link) => (
                <button
                  key={link.name}
                  onClick={() => scrollToSection(link.href)}
                  className="text-base md:text-body-md text-secondary-white hover:text-cosmic-orange transition-colors text-left py-2"
                >
                  {link.name}
                </button>
              ))}
              {user ? (
                <Link href="/dashboard" className="btn-primary w-full py-3 text-sm md:text-body-sm text-center">
                  Dashboard
                </Link>
              ) : (
                <Link href="/login" className="btn-primary w-full py-3 text-sm md:text-body-sm text-center">
                  Start Free
                </Link>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </>
  )
}
