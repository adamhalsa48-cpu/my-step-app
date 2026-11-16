'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { StayFitDashboard } from '@/components/stay-fit-dashboard'
import { getCurrentProfile, type Profile } from '@/lib/local-store'

export default function Page() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const localProfile = getCurrentProfile()
    if (localProfile) setProfile(localProfile)
    else router.replace('/auth')
    setReady(true)
  }, [router])

  if (!ready || !profile) return <main className="sf-loading" aria-live="polite"><span className="sf-loading-mark">S</span><p>Opening your on-device account…</p></main>
  return <StayFitDashboard initialProfile={profile} userName={profile.username} />
}
