'use client'

/**
 * Settings → "AI agent access (MCP)". Lets a user mint, copy (once), list, and revoke
 * Personal Access Tokens for the authenticated agent MCP at /api/agent/mcp.
 */

import { useCallback, useEffect, useState } from 'react'

interface AgentToken {
  id: string
  name: string
  prefix: string
  scopes: string[]
  last_used_at: string | null
  expires_at: string | null
  revoked_at: string | null
  created_at: string
}

export default function AgentAccessSection() {
  const [tokens, setTokens] = useState<AgentToken[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [plaintext, setPlaintext] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const endpoint = typeof window !== 'undefined' ? `${window.location.origin}/api/agent/mcp` : '/api/agent/mcp'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/agent/tokens')
      if (!res.ok) throw new Error('Could not load tokens')
      const data = await res.json()
      setTokens(data.tokens ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load tokens')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const createToken = async () => {
    setCreating(true)
    setError(null)
    setPlaintext(null)
    try {
      const res = await fetch('/api/agent/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || 'Agent token' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not create token')
      setPlaintext(data.token)
      setName('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create token')
    } finally {
      setCreating(false)
    }
  }

  const revokeToken = async (id: string) => {
    if (!window.confirm('Revoke this token? Any agent using it will immediately lose access.')) return
    setRevoking(id)
    try {
      const res = await fetch(`/api/agent/tokens/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Could not revoke token')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revoke token')
    } finally {
      setRevoking(null)
    }
  }

  const copyPlaintext = async () => {
    if (!plaintext) return
    try {
      await navigator.clipboard.writeText(plaintext)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard may be unavailable */
    }
  }

  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—')
  const active = tokens.filter((t) => !t.revoked_at)

  return (
    <div className="glass-container p-6 mb-6">
      <h2 className="text-heading-md text-secondary-white mb-2">AI agent access (MCP)</h2>
      <p className="text-body-sm text-medium-gray mb-4">
        Connect an AI agent to your Diffuse account to create projects, add inputs, and generate
        outputs. Generate a Personal Access Token below and add it to your MCP client. A token can
        only ever access your own account.
      </p>

      {/* Connection snippet */}
      <div className="mb-5 p-4 rounded-glass bg-white/5 border border-white/10">
        <p className="text-caption text-medium-gray mb-1">MCP endpoint</p>
        <code className="text-body-sm text-secondary-white break-all">{endpoint}</code>
        <p className="text-caption text-medium-gray mt-3 mb-1">Auth header</p>
        <code className="text-body-sm text-secondary-white break-all">Authorization: Bearer &lt;your-token&gt;</code>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-glass bg-red-500/10 border border-red-500/30 text-red-400 text-body-sm">
          {error}
        </div>
      )}

      {/* One-time plaintext reveal */}
      {plaintext && (
        <div className="mb-5 p-4 rounded-glass bg-cosmic-orange/10 border border-cosmic-orange/30">
          <p className="text-body-sm text-cosmic-orange mb-2">
            Copy this token now — it will not be shown again.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <code className="flex-1 text-body-sm text-secondary-white break-all bg-black/30 p-2 rounded">
              {plaintext}
            </code>
            <button
              onClick={copyPlaintext}
              className="shrink-0 px-4 py-2 text-body-sm text-secondary-white bg-white/10 border border-white/10 rounded-glass hover:bg-white/20 transition-colors"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {/* Create */}
      <div className="flex flex-col sm:flex-row gap-2 mb-5">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Token name (e.g. Claude Desktop)"
          maxLength={100}
          className="flex-1 px-4 py-2 text-body-sm text-secondary-white bg-white/5 border border-white/10 rounded-glass focus:outline-none focus:border-cosmic-orange/50"
        />
        <button
          onClick={createToken}
          disabled={creating}
          className="shrink-0 btn-secondary px-4 py-2 text-body-sm disabled:opacity-50"
        >
          {creating ? 'Creating…' : 'Create token'}
        </button>
      </div>

      {/* List */}
      {loading ? (
        <p className="text-body-sm text-medium-gray">Loading tokens…</p>
      ) : active.length === 0 ? (
        <p className="text-body-sm text-medium-gray">No active tokens yet.</p>
      ) : (
        <div className="divide-y divide-white/10">
          {active.map((t) => (
            <div
              key={t.id}
              className="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
            >
              <div>
                <p className="text-body-sm text-secondary-white font-medium">{t.name}</p>
                <p className="text-caption text-medium-gray">
                  <code>{t.prefix}…</code> · created {fmtDate(t.created_at)} · last used {fmtDate(t.last_used_at)}
                  {t.expires_at ? ` · expires ${fmtDate(t.expires_at)}` : ''}
                </p>
              </div>
              <button
                onClick={() => revokeToken(t.id)}
                disabled={revoking === t.id}
                className="shrink-0 px-4 py-2 text-body-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-glass hover:bg-red-500/20 transition-colors disabled:opacity-50"
              >
                {revoking === t.id ? 'Revoking…' : 'Revoke'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
