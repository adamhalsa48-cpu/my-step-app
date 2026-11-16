'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, LockKeyhole } from 'lucide-react'
import { getCurrentLocalAccount, signInLocal } from '@/lib/local-store'
import { ApiRequestError, apiRequest, establishOnlineAccount } from '@/lib/api-client'

export default function SignInPage() {
  const router = useRouter()
  const [usernameOrEmail, setUsernameOrEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const profile = await signInLocal(usernameOrEmail, password)
      if (navigator.onLine) {
        try {
          await apiRequest('username-login', {
            method: 'POST',
            body: JSON.stringify({ usernameOrEmail, password }),
            signal: AbortSignal.timeout(6000),
          })
        } catch (cause) {
          const localAccount = getCurrentLocalAccount()
          if (cause instanceof ApiRequestError && cause.status === 401 && localAccount) {
            try {
              await establishOnlineAccount({ email: localAccount.email, username: profile.username, password, profile })
            } catch {
              // Keep local sign-in available when the online account cannot be established.
            }
          }
        }
      }
      router.replace('/')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not sign you in. Check your username or email and password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="signin-title">
        <Link className="sf-brand auth-brand" href="/" aria-label="Stay Fit home"><span className="sf-mark">S</span><span>STAY FIT<span className="sf-brand-dot">.</span></span></Link>
        <div className="auth-kicker"><LockKeyhole size={14} /> YOUR PRIVATE SPACE</div>
        <h1 id="signin-title">Welcome back.</h1>
        <p className="auth-subtitle">Pick up where you left off. Your progress is waiting.</p>
        <form className="auth-form" onSubmit={submit}>
          <label>Username or email<input autoComplete="username" value={usernameOrEmail} onChange={(event) => setUsernameOrEmail(event.target.value)} required /></label>
          <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-action" disabled={busy} type="submit">{busy ? 'Signing you in…' : 'Log in'} <ArrowRight size={16} /></button>
        </form>
        <p className="auth-switch">New to Stay Fit? <Link href="/onboarding">Create your account</Link></p>
        <p className="auth-privacy">Your profile and activity stay on this device first. A matching online session enables backup, AI features, and friends.</p>
      </section>
    </main>
  )
}
