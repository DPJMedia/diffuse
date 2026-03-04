'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useBodyScrollLock } from '@/components/dashboard/ModalShell'

// Production site URL for email redirects (used in Supabase signUp emailRedirectTo)
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.diffuse.press'

export default function LoginPage() {
  const [activeTab, setActiveTab] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success', text: string } | null>(null)
  const [verificationPending, setVerificationPending] = useState(false)
  const [pendingEmail, setPendingEmail] = useState('')
  const [emailAlreadyUsed, setEmailAlreadyUsed] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  // Poll for email verification
  useEffect(() => {
    if (!verificationPending) return

    const checkVerification = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user?.email_confirmed_at) {
        setVerificationPending(false)
        router.push('/dashboard')
      }
    }

    // Check every 3 seconds
    const interval = setInterval(checkVerification, 3000)
    
    return () => clearInterval(interval)
  }, [verificationPending, router, supabase.auth])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) throw error

      if (!data.user?.email_confirmed_at) {
        setMessage({
          type: 'error',
          text: 'Please verify your email address before logging in.',
        })
        return
      }

      router.push('/dashboard')
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error.message || 'Failed to login. Please try again.',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    if (password !== confirmPassword) {
      setMessage({ type: 'error', text: 'Passwords do not match.' })
      setLoading(false)
      return
    }

    if (password.length < 6) {
      setMessage({ type: 'error', text: 'Password must be at least 6 characters.' })
      setLoading(false)
      return
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${SITE_URL}/api/auth/callback`,
          data: {
            full_name: fullName,
          },
        },
      })

      if (error) throw error

      // Check if user already exists (Supabase returns user with identities: [] for existing emails)
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        setEmailAlreadyUsed(true)
        setMessage(null)
        setLoading(false)
        return
      }

      // Show verification pending modal
      setPendingEmail(email)
      setVerificationPending(true)
      setFullName('')
      setPassword('')
      setConfirmPassword('')
    } catch (error: any) {
      // Also check for "User already registered" error message
      if (error.message?.toLowerCase().includes('already registered') || 
          error.message?.toLowerCase().includes('already been registered')) {
        setEmailAlreadyUsed(true)
        setMessage(null)
      } else {
        setMessage({
          type: 'error',
          text: error.message || 'Failed to create account. Please try again.',
        })
      }
    } finally {
      setLoading(false)
    }
  }

  // Verification Pending Modal
  const VerificationModal = () => (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center px-4 sm:px-6 overflow-hidden">
      <div className="glass-container p-4 sm:p-8 max-w-md w-full max-h-[80vh] overflow-y-auto text-center">
        {/* Mail Icon - No animation */}
        <div className="mb-6">
          <div className="w-20 h-20 mx-auto rounded-full bg-cosmic-orange/10 flex items-center justify-center">
            <svg 
              className="w-10 h-10 text-cosmic-orange" 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={1.5} 
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" 
              />
            </svg>
          </div>
        </div>

        <h2 className="text-xl font-semibold text-secondary-white mb-2">
          Check your email!
        </h2>
        
        <p className="text-medium-gray text-body-md">
          We&apos;ve sent a verification link to
        </p>
        
        <p className="text-cosmic-orange font-medium text-body-md mb-6 break-all">
          {pendingEmail}
        </p>

        {/* Waiting for verification */}
        <div className="flex items-center justify-center gap-3 mb-4 py-4 px-6 bg-white/5 rounded-glass border border-white/10">
          <div className="flex gap-1">
            <span className="w-2 h-2 bg-cosmic-orange rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-2 h-2 bg-cosmic-orange rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2 h-2 bg-cosmic-orange rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <span className="text-body-sm text-secondary-white">
            Waiting for verification...
          </span>
        </div>

        {/* Resend verification email */}
        <button
          onClick={async () => {
            setLoading(true)
            try {
              await supabase.auth.resend({
                type: 'signup',
                email: pendingEmail,
                options: {
                  emailRedirectTo: `${SITE_URL}/api/auth/callback`,
                },
              })
              setMessage({
                type: 'success',
                text: 'Verification email resent!',
              })
            } catch {
              setMessage({
                type: 'error',
                text: 'Failed to resend email. Please try again.',
              })
            } finally {
              setLoading(false)
            }
          }}
          disabled={loading}
          className="w-full py-3 text-body-md text-cosmic-orange border border-cosmic-orange/30 rounded-glass hover:bg-cosmic-orange/10 transition-colors disabled:opacity-50 mb-3"
        >
          {loading ? 'Sending...' : 'Resend verification email'}
        </button>
        
        {/* Use a different email */}
        <button
          onClick={() => {
            setVerificationPending(false)
            setEmail('')
            setPendingEmail('')
            setMessage(null)
          }}
          className="w-full py-3 text-body-md text-medium-gray hover:text-secondary-white transition-colors"
        >
          Use a different email
        </button>

        {/* Message */}
        {message && (
          <div
            className={`mt-4 p-4 rounded-glass border ${
              message.type === 'error'
                ? 'bg-red-500/10 border-red-500/30 text-red-400'
                : 'bg-cosmic-orange/10 border-cosmic-orange/30 text-cosmic-orange'
            }`}
          >
            <p className="text-body-sm">{message.text}</p>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-6 py-12">
      {/* Verification Modal */}
      {verificationPending && <VerificationModal />}

      <div className="w-full max-w-md">
        {/* Logo */}
        <Link href="/" className="block text-center mb-8">
          <h1 className="text-3xl font-bold">
            diffuse<span className="text-cosmic-orange">.ai</span>
          </h1>
        </Link>

        {/* Auth Container */}
        <div className="glass-container p-8">
          {/* Tabs */}
          <div className="flex gap-4 mb-8 border-b border-white/10">
            <button
              onClick={() => {
                setActiveTab('login')
                setMessage(null)
                setEmailAlreadyUsed(false)
              }}
              className={`pb-3 px-2 text-body-md font-medium transition-colors relative ${
                activeTab === 'login'
                  ? 'text-cosmic-orange'
                  : 'text-secondary-white hover:text-white'
              }`}
            >
              Login
              {activeTab === 'login' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-cosmic-orange" />
              )}
            </button>
            <button
              onClick={() => {
                setActiveTab('signup')
                setMessage(null)
                setEmailAlreadyUsed(false)
              }}
              className={`pb-3 px-2 text-body-md font-medium transition-colors relative ${
                activeTab === 'signup'
                  ? 'text-cosmic-orange'
                  : 'text-secondary-white hover:text-white'
              }`}
            >
              Sign Up
              {activeTab === 'signup' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-cosmic-orange" />
              )}
            </button>
          </div>

          {/* Message */}
          {message && (
            <div
              className={`mb-6 p-4 rounded-glass border ${
                message.type === 'error'
                  ? 'bg-red-500/10 border-red-500/30 text-red-400'
                  : 'bg-cosmic-orange/10 border-cosmic-orange/30 text-cosmic-orange'
              }`}
            >
              <p className="text-body-sm">{message.text}</p>
            </div>
          )}

          {/* Login Form */}
          {activeTab === 'login' && (
            <form onSubmit={handleLogin} className="space-y-6">
              <div>
                <label htmlFor="email" className="block text-body-sm text-secondary-white mb-2">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-body-sm text-secondary-white mb-2">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-medium-gray hover:text-secondary-white transition-colors"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-3 text-body-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>

              <div className="text-center">
                <button
                  type="button"
                  className="text-body-sm text-medium-gray hover:text-cosmic-orange transition-colors"
                >
                  Forgot password?
                </button>
              </div>
            </form>
          )}

          {/* Signup Form */}
          {activeTab === 'signup' && (
            <form onSubmit={handleSignup} className="space-y-6">
              <div>
                <label htmlFor="full-name" className="block text-body-sm text-secondary-white mb-2">
                  Full Name
                </label>
                <input
                  id="full-name"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors"
                  placeholder="John Doe"
                />
              </div>

              <div>
                <label htmlFor="signup-email" className="block text-body-sm text-secondary-white mb-2">
                  Email
                </label>
                <input
                  id="signup-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label htmlFor="signup-password" className="block text-body-sm text-secondary-white mb-2">
                  Password
                </label>
                <input
                  id="signup-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors"
                  placeholder="••••••••"
                />
                <p className="mt-2 text-caption text-medium-gray">
                  Minimum 6 characters
                </p>
              </div>

              <div>
                <label htmlFor="confirm-password" className="block text-body-sm text-secondary-white mb-2">
                  Confirm Password
                </label>
                <input
                  id="confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors"
                  placeholder="••••••••"
                />
              </div>

              {/* Email already used message */}
              {emailAlreadyUsed && (
                <div className="p-4 rounded-glass border bg-cosmic-orange/10 border-cosmic-orange/30">
                  <p className="text-body-sm text-cosmic-orange mb-3">
                    This email has already been used.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('login')
                      setEmailAlreadyUsed(false)
                      setMessage(null)
                      // Keep email filled in for login
                    }}
                    className="w-full py-2 text-body-sm text-secondary-white bg-white/10 rounded-glass hover:bg-white/20 transition-colors"
                  >
                    Go to Login
                  </button>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-3 text-body-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Creating account...' : 'Create Account'}
              </button>
            </form>
          )}
        </div>

        {/* Back to Home */}
        <div className="mt-6 text-center">
          <Link
            href="/"
            className="text-body-sm text-medium-gray hover:text-cosmic-orange transition-colors"
          >
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
  )
}

