'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import useSWR from 'swr'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import {
  Activity, Apple, ArrowDownRight, ArrowRight, Bell, Check, ChevronRight, CircleHelp, Download, Dumbbell,
  Flame, Footprints, Home, LogOut, Medal, Moon, Play, Plus, ScanLine, Settings, Smartphone, Sparkles, Sun, Target,
  TrendingUp, Trophy, UserPlus, Users, X,
} from 'lucide-react'
import {
  cacheLocalMealPlan, cacheLocalWorkoutPlan, changeLocalPassword, DEFAULT_APPEARANCE, getDashboardData,
  getLocalAppearancePreferences, getLocalMealPlan, getLocalNotificationsEnabled, getLocalWorkoutPlan,
  markLocalMealSynced, saveLocalMeal, saveLocalSteps, saveLocalWorkout, signOutLocal,
  updateLocalAppearancePreferences, updateLocalNotificationsEnabled, updateLocalProfile,
  type AppearancePreferences, type DashboardData, type FriendsData, type Meal, type MealPlan, type Profile, type WorkoutPlan,
} from '@/lib/local-store'
import { apiRequest, checkBackendAndSync, type BackendStatus } from '@/lib/api-client'
import { authClient } from '@/lib/auth-client'
import { startStepTracking } from '@/lib/step-counter'
import { ActivityInsights } from '@/components/activity-insights'

type Section = 'Today' | 'Workouts' | 'Nutrition' | 'Leaderboard' | 'Settings' | 'Download'

const navItems: { label: Section; icon: typeof Home }[] = [
  { label: 'Today', icon: Home },
  { label: 'Workouts', icon: Dumbbell },
  { label: 'Nutrition', icon: Apple },
  { label: 'Leaderboard', icon: Trophy },
]
const categories = ['strength', 'cardio', 'walking', 'yoga', 'cycling', 'mobility'] as const

type OfflineWorkout = {
  title: string
  category: (typeof categories)[number]
  durationMinutes: number
  focus: string
  exercises: string[]
}

type WorkoutCoachMessage = { role: 'user' | 'assistant'; text: string }

const OFFLINE_WORKOUTS: OfflineWorkout[] = [
  { title: 'Full-body strength', category: 'strength', durationMinutes: 20, focus: 'A simple bodyweight circuit at your own pace.', exercises: ['Bodyweight squats', 'Wall push-ups', 'Glute bridges'] },
  { title: 'Brisk walk', category: 'walking', durationMinutes: 15, focus: 'Build a comfortable walking rhythm.', exercises: ['Easy warm-up', 'Steady walk', 'Gentle cool-down'] },
  { title: 'Mobility reset', category: 'mobility', durationMinutes: 10, focus: 'Move gently through a comfortable range.', exercises: ['Shoulder circles', 'Hip hinges', 'Supported balance'] },
  { title: 'Recovery yoga', category: 'yoga', durationMinutes: 20, focus: 'A gentle sequence for an easy recovery day.', exercises: ['Cat-cow', 'Low lunge stretch', 'Child’s pose'] },
]

function formatWorkoutTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const localWeek = () => {
  const monday = new Date()
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return localDay(monday)
}
const goalLabels: Record<string, string> = {
  lose_weight: 'build steady habits', stay_fit: 'stay fit', build_muscle: 'build strength', prioritize_nutrition: 'eat well',
}

export function StayFitDashboard({ initialProfile, userName }: { initialProfile: Profile; userName: string }) {
  const router = useRouter()
  const [section, setSection] = useState<Section>('Today')
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState(false)
  const [tracking, setTracking] = useState(false)
  const [workoutCategory, setWorkoutCategory] = useState<(typeof categories)[number]>('strength')
  const [workoutMinutes, setWorkoutMinutes] = useState('25')
  const [friendUsername, setFriendUsername] = useState('')
  const [scanResult, setScanResult] = useState<Meal | null>(null)
  const [data, setData] = useState<DashboardData | null>(null)
  const [browserOnline, setBrowserOnline] = useState(true)
  const [activeWorkout, setActiveWorkout] = useState<{ title: string; category: OfflineWorkout['category']; durationMinutes: number; endsAt: number } | null>(null)
  const [remainingWorkoutSeconds, setRemainingWorkoutSeconds] = useState(0)
  const [workoutCompletion, setWorkoutCompletion] = useState<{ title: string } | null>(null)
  const [coachMessages, setCoachMessages] = useState<WorkoutCoachMessage[]>([])
  const [coachQuestion, setCoachQuestion] = useState('')
  const [coachBusy, setCoachBusy] = useState(false)
  const [appearance, setAppearance] = useState<AppearancePreferences>(DEFAULT_APPEARANCE)
  const [notificationsEnabled, setNotificationsEnabled] = useState(false)
  const [planData, setPlanData] = useState<{ plan: MealPlan | null; day: string }>({ plan: null, day: '' })
  const [workoutPlanData, setWorkoutPlanData] = useState<{ plan: WorkoutPlan | null; weekOf: string }>({ plan: null, weekOf: '' })
  const stopTrackingRef = useRef<(() => Promise<void>) | null>(null)
  const workoutTimerRef = useRef<number | null>(null)
  const workoutCompletionAudioRef = useRef<HTMLAudioElement | null>(null)
  const workoutAttemptsRef = useRef<number[]>([])
  const day = useMemo(localDay, [])
  const weekOf = useMemo(localWeek, [])
  const { data: backendStatus, mutate: refreshBackend } = useSWR<BackendStatus>(
    browserOnline ? 'stay-fit-backend-status' : null,
    checkBackendAndSync,
    { refreshInterval: 60000, revalidateOnFocus: true, revalidateOnReconnect: true },
  )
  const canUseOnlineFeatures = browserOnline && backendStatus?.reachable === true && backendStatus.authenticated
  const friendsKey = canUseOnlineFeatures && section === 'Leaderboard' ? `stay-fit-friends-${day}` : null
  const { data: remoteFriends, mutate: refreshFriends } = useSWR<FriendsData>(
    friendsKey,
    () => apiRequest<FriendsData>(`friends?day=${day}`),
    { revalidateOnFocus: true },
  )
  const friends = remoteFriends ?? { leaderboard: [], incoming: [] }

  function refreshLocalData() {
    setData(getDashboardData(day))
    setPlanData({ plan: getLocalMealPlan(day), day })
    setWorkoutPlanData({ plan: getLocalWorkoutPlan(weekOf), weekOf })
    setAppearance(getLocalAppearancePreferences())
    setNotificationsEnabled(getLocalNotificationsEnabled())
    void refreshBackend()
  }

  useEffect(() => {
    refreshLocalData()
  }, [day, weekOf])

  useEffect(() => {
    const updateConnection = () => setBrowserOnline(navigator.onLine)
    updateConnection()
    const markApiOffline = () => setBrowserOnline(false)
    window.addEventListener('online', updateConnection)
    window.addEventListener('offline', updateConnection)
    window.addEventListener('stay-fit-api-unreachable', markApiOffline)
    return () => {
      window.removeEventListener('online', updateConnection)
      window.removeEventListener('offline', updateConnection)
      window.removeEventListener('stay-fit-api-unreachable', markApiOffline)
    }
  }, [])

  useEffect(() => () => {
    if (stopTrackingRef.current) void stopTrackingRef.current()
    if (workoutTimerRef.current !== null) window.clearInterval(workoutTimerRef.current)
  }, [])

  const profile = data?.profile ?? initialProfile
  const steps = data?.stepsToday ?? 0
  const target = profile.dailyStepGoal || 8000
  const workoutCalories = data?.stats.caloriesBurnedToday ?? 0
  const meals = data?.mealsToday ?? []
  const totalCalories = data?.stats.caloriesConsumedToday ?? 0
  const totalProtein = data?.stats.proteinToday ?? 0

  function notify(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(''), 3000)
  }

  async function logSteps(nextSteps: number, source = 'manual') {
    try {
      saveLocalSteps(day, nextSteps, source)
      refreshLocalData()
      notify(source === 'manual' ? 'Step count saved on this device.' : 'Phone steps synced locally.')
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Could not update steps.')
    }
  }

  async function toggleStepTracking() {
    if (stopTrackingRef.current) {
      await stopTrackingRef.current()
      stopTrackingRef.current = null
      setTracking(false)
      notify('Step tracking paused.')
      return
    }
    setBusy(true)
    try {
      stopTrackingRef.current = await startStepTracking((count) => {
        try {
          saveLocalSteps(day, count, 'phone')
          setData(getDashboardData(day))
          void refreshBackend()
        } catch (cause) {
          notify(cause instanceof Error ? cause.message : 'Could not save phone steps.')
        }
      }, steps)
      setTracking(true)
      notify('Step tracking is on for this session.')
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Step tracking is unavailable.')
    } finally {
      setBusy(false)
    }
  }

  async function logWorkout(title: string, category = workoutCategory, minutes = Number(workoutMinutes), showSavedNotice = true): Promise<boolean> {
    const now = Date.now()
    const recentAttempts = workoutAttemptsRef.current.filter((timestamp) => now - timestamp < 1000)
    if (recentAttempts.length >= 5) {
      workoutAttemptsRef.current = recentAttempts
      notify('Slow down')
      return false
    }
    workoutAttemptsRef.current = [...recentAttempts, now]
    setBusy(true)
    try {
      saveLocalWorkout({ title, category, durationMinutes: minutes })
      refreshLocalData()
      if (showSavedNotice) notify('Workout saved on this device.')
      return true
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Could not save your workout.')
      return false
    } finally {
      setBusy(false)
    }
  }

  function startWorkoutTimer(title: string, category: OfflineWorkout['category'], minutes: number) {
    setWorkoutCompletion(null)
    const durationMinutes = Math.round(minutes)
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 300) {
      notify('Choose a workout duration from 1 to 300 minutes.')
      return
    }
    if (activeWorkout) {
      notify('Finish or cancel your current workout before starting another.')
      return
    }

    const endsAt = Date.now() + durationMinutes * 60 * 1000
    setActiveWorkout({ title, category, durationMinutes, endsAt })
    setRemainingWorkoutSeconds(durationMinutes * 60)
    notify(`${title} started. Your ${durationMinutes}-minute timer is running.`)
    workoutTimerRef.current = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
      setRemainingWorkoutSeconds(remaining)
      if (remaining === 0) {
        if (workoutTimerRef.current !== null) window.clearInterval(workoutTimerRef.current)
        workoutTimerRef.current = null
        setActiveWorkout(null)
        setWorkoutCompletion({ title })
        void workoutCompletionAudioRef.current?.play().catch(() => undefined)
        void logWorkout(title, category, durationMinutes, false).then((saved) => {
          notify(saved ? 'Workout complete and saved.' : 'Timer complete, but the workout was not saved.')
        })
      }
    }, 1000)
  }

  function cancelWorkoutTimer() {
    if (workoutTimerRef.current !== null) window.clearInterval(workoutTimerRef.current)
    workoutTimerRef.current = null
    setActiveWorkout(null)
    setRemainingWorkoutSeconds(0)
    setWorkoutCompletion(null)
    notify('Workout stopped. No workout was logged.')
  }

  async function askWorkoutCoach(question: string) {
    const trimmedQuestion = question.trim()
    if (trimmedQuestion.length < 3 || trimmedQuestion.length > 500) return notify('Enter a question between 3 and 500 characters.')
    if (!canUseOnlineFeatures) return notify('Connect to the internet and sign in online to ask the workout coach.')

    setCoachQuestion('')
    setCoachBusy(true)
    setCoachMessages((messages) => [...messages, { role: 'user', text: trimmedQuestion }])
    try {
      const result = await apiRequest<{ answer: string }>('workout-coach', { method: 'POST', body: JSON.stringify({ question: trimmedQuestion }) })
      setCoachMessages((messages) => [...messages, { role: 'assistant', text: result.answer }])
    } catch (cause) {
      setCoachMessages((messages) => [...messages, { role: 'assistant', text: cause instanceof Error ? cause.message : 'The workout coach could not reply right now.' }])
    } finally {
      setCoachBusy(false)
    }
  }

  async function logMeal(meal: Omit<Meal, 'id' | 'loggedAt'>) {
    try {
      saveLocalMeal(meal)
      refreshLocalData()
      notify('Meal saved on this device. It will sync when online.')
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Could not save that meal.')
    }
  }

  async function saveManualMeal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const submittedForm = event.currentTarget
    const form = new FormData(submittedForm)
    const title = String(form.get('mealName') ?? '').trim()
    const caloriesKcal = Number(form.get('mealCalories'))
    const proteinGrams = Number(form.get('mealProtein'))
    const mealType = String(form.get('mealType') ?? 'meal') as Meal['mealType']
    if (!title || title.length > 100 || !Number.isFinite(caloriesKcal) || caloriesKcal < 0 || !Number.isFinite(proteinGrams) || proteinGrams < 0) {
      return notify('Enter a meal name and valid non-negative nutrition values.')
    }
    await logMeal({ title, mealType, caloriesKcal, proteinGrams, carbsGrams: 0, fatGrams: 0, ingredients: [], aiNotes: null })
    submittedForm.reset()
  }

  async function scanPhoto(file: File | undefined) {
    if (!file) return
    if (!canUseOnlineFeatures) return notify('Internet required for AI & Friends. Connect and sign in online to scan a meal.')
    setBusy(true)
    setScanResult(null)
    try {
      const form = new FormData()
      form.set('photo', file)
      const result = await apiRequest<{ meal: Omit<Meal, 'id' | 'loggedAt'> & { id: number; loggedAt: string } }>('meal-scan', { method: 'POST', body: form })
      const meal = saveLocalMeal(result.meal)
      markLocalMealSynced(meal.id)
      setScanResult(meal)
      refreshLocalData()
      notify('Meal estimate saved on this device and online.')
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'The photo could not be scanned. Your other tracking still works offline.')
    } finally {
      setBusy(false)
    }
  }

  async function generatePlan() {
    if (!canUseOnlineFeatures) return notify('Internet required for AI & Friends. Connect and sign in online to create a plan.')
    setBusy(true)
    try {
      const result = await apiRequest<{ plan: MealPlan; day: string }>('meal-plan', { method: 'POST', body: JSON.stringify({ day }) })
      const plan = cacheLocalMealPlan(day, result.plan)
      setPlanData({ plan, day })
      notify('Your meal plan is ready and saved on this device.')
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Your meal plan could not be created right now.')
    } finally {
      setBusy(false)
    }
  }

  async function generateWorkoutPlan() {
    if (!canUseOnlineFeatures) return notify('Internet required for AI & Friends. Connect and sign in online to create a plan.')
    setBusy(true)
    try {
      const result = await apiRequest<{ plan: WorkoutPlan; weekOf: string }>('workout-plan', { method: 'POST', body: JSON.stringify({ weekOf }) })
      const plan = cacheLocalWorkoutPlan(weekOf, result.plan)
      setWorkoutPlanData({ plan, weekOf })
      notify('Your workout plan is ready and saved on this device.')
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Your workout plan could not be created right now.')
    } finally {
      setBusy(false)
    }
  }

  async function addFriend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canUseOnlineFeatures) return notify('Internet required for AI & Friends. Connect and sign in online to find friends.')
    setBusy(true)
    try {
      const result = await apiRequest<{ message: string }>('friends', { method: 'POST', body: JSON.stringify({ username: friendUsername }) })
      setFriendUsername('')
      await refreshFriends()
      notify(result.message)
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Could not send that friend request.')
    } finally {
      setBusy(false)
    }
  }

  async function answerFriendRequest(id: number, accept: boolean) {
    if (!canUseOnlineFeatures) return notify('Internet required for AI & Friends. Connect and sign in online to update friend requests.')
    setBusy(true)
    try {
      const result = await apiRequest<{ message: string }>('friends', { method: 'PATCH', body: JSON.stringify({ id, accept }) })
      await refreshFriends()
      notify(result.message)
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Could not update that friend request.')
    } finally {
      setBusy(false)
    }
  }

  async function toggleLeaderboard() {
    updateLocalProfile({ leaderboardOptIn: !profile.leaderboardOptIn })
    refreshLocalData()
    notify(profile.leaderboardOptIn ? 'Your local stats are now private.' : 'Your local profile is visible to connected profiles on this device.')
  }

  async function changeStepGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const dailyStepGoal = Number(form.get('dailyStepGoal'))
    if (!Number.isInteger(dailyStepGoal) || dailyStepGoal < 1000 || dailyStepGoal > 50000) return notify('Choose a step goal from 1,000 to 50,000.')
    updateLocalProfile({ dailyStepGoal })
    refreshLocalData()
    notify('Daily step goal saved on this device.')
  }

  async function toggleReminders() {
    if (notificationsEnabled) {
      updateLocalNotificationsEnabled(false)
      setNotificationsEnabled(false)
      notify('Notifications disabled in Stay Fit on this device.')
      return
    }
    if (!('Notification' in window)) return notify('Notifications are not supported in this browser.')
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
    if (permission !== 'granted') return notify('Notifications are off. You can change this in your browser settings.')
    updateLocalNotificationsEnabled(true)
    setNotificationsEnabled(true)
    new Notification('Stay Fit reminders are on', { body: 'We’ll keep you updated while Stay Fit is open on this device.' })
    notify('Notifications enabled for this device.')
  }

  function saveAppearance(patch: Partial<AppearancePreferences>) {
    const nextAppearance = updateLocalAppearancePreferences(patch)
    setAppearance(nextAppearance)
    notify('Appearance saved on this device.')
  }

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const submittedForm = event.currentTarget
    const form = new FormData(submittedForm)
    const currentPassword = String(form.get('currentPassword') ?? '')
    const newPassword = String(form.get('newPassword') ?? '')
    const confirmPassword = String(form.get('confirmPassword') ?? '')
    if (newPassword.length < 8 || newPassword.length > 128) return notify('Choose a new password between 8 and 128 characters.')
    if (newPassword !== confirmPassword) return notify('The new passwords do not match.')

    setBusy(true)
    try {
      if (canUseOnlineFeatures) {
        const result = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: false })
        if (result.error) throw new Error('We could not verify your current password or update your account password.')
      }
      await changeLocalPassword(currentPassword, newPassword)
      submittedForm.reset()
      notify(canUseOnlineFeatures ? 'Password changed for your account and this device.' : 'Password changed on this device. Connect online to update your account password.')
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'The password could not be changed.')
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    if (browserOnline) {
      try {
        await apiRequest('auth/sign-out', { method: 'POST', body: JSON.stringify({}), signal: AbortSignal.timeout(3000) })
      } catch {
        // A local sign-out must still work if the backend is unavailable.
      }
    }
    signOutLocal()
    router.replace('/auth')
  }

  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening'
  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const weeklyBars = data?.stepsLastSevenDays ?? []
  const maxSteps = Math.max(target, ...weeklyBars.map((item) => item.steps), 1)
  const suggestedSession = workoutPlanData?.plan?.sessions[0]
  const suggestedCategory = suggestedSession?.category ?? (profile.fitnessGoal === 'build_muscle' ? 'strength' : 'walking')
  const suggestedTitle = suggestedSession?.title ?? (profile.fitnessGoal === 'build_muscle' ? 'Strength & balance' : 'A steady walk')
  const suggestedMinutes = suggestedSession?.durationMinutes ?? 25
  const cachedOfflineWorkouts: OfflineWorkout[] = (workoutPlanData.plan?.sessions ?? [])
    .filter((session) => !OFFLINE_WORKOUTS.some((workout) => workout.title === session.title))
    .map((session) => ({ title: session.title, category: session.category, durationMinutes: session.durationMinutes, focus: session.focus, exercises: session.exercises }))
  const offlineWorkouts = [...OFFLINE_WORKOUTS, ...cachedOfflineWorkouts]

  if (!data) return <main className="sf-loading" aria-live="polite"><Image className="sf-loading-wordmark" src="/stay-fit-wordmark.png" alt="Stay Fit" width={282} height={180} priority /><p>Opening your on-device dashboard…</p></main>

  return (
    <main className="sf-shell" data-theme={appearance.theme} data-accent={appearance.accent}>
      <aside className="sf-sidebar">
        <a className="sf-brand" href="#today" aria-label="Stay Fit home"><Image className="sf-wordmark" src="/stay-fit-wordmark.png" alt="Stay Fit" width={282} height={180} priority /></a>
        <div className="sf-side-label">YOUR SPACE</div>
        <nav className="sf-nav" aria-label="Main navigation">
          {navItems.map(({ label, icon: Icon }) => <button key={label} className={`sf-nav-link ${section === label ? 'active' : ''}`} onClick={() => setSection(label)}><Icon size={19} strokeWidth={1.8} /><span>{label}</span>{label === 'Today' && <span className="sf-nav-indicator" />}</button>)}
        </nav>
        <div className="sf-sidebar-bottom"><div className="sf-coach-card"><span className="sf-coach-icon"><Sparkles size={17} /></span><p>{canUseOnlineFeatures ? 'Your coach is ready.' : 'AI coach works online.'}</p><span>Small steps. Big change.</span><button onClick={() => setSection('Nutrition')}>Get a meal plan <ArrowRight size={14} /></button></div><button className={`sf-nav-link ${section === 'Settings' ? 'active' : ''}`} onClick={() => setSection('Settings')}><Settings size={18} /><span>Settings</span></button><div className="sf-user"><div className="sf-avatar">{profile.displayName.charAt(0).toUpperCase()}</div><div><strong>{profile.displayName}</strong><span>@{profile.username}</span></div><button aria-label="Sign out" onClick={signOut}><LogOut size={17} /></button></div></div>
      </aside>

      <section className="sf-main" id="today">
        <header className="sf-topbar"><a className="sf-mobile-brand" href="#today" aria-label="Stay Fit home"><Image src="/stay-fit-wordmark.png" alt="Stay Fit" width={282} height={108} /></a><div className="sf-breadcrumb"><span>MY SPACE</span><ChevronRight size={14} /><strong>{section.toUpperCase()}</strong></div><div className="sf-top-actions"><span className="sf-date">{dateLabel.toUpperCase()}</span><button className="sf-download-button" onClick={() => setSection('Download')} aria-label="Get Stay Fit for Android or iPhone"><Download size={15} /><span>Get the app</span></button><span className={`connection-badge ${!browserOnline || backendStatus?.reachable === false ? 'offline' : canUseOnlineFeatures ? 'online' : 'checking'}`} role="status">{!browserOnline || backendStatus?.reachable === false ? 'OFFLINE MODE' : canUseOnlineFeatures ? 'ONLINE SYNC' : backendStatus?.reachable ? 'ONLINE SIGN-IN NEEDED' : 'CHECKING CONNECTION'}</span><button className={`sf-icon-button notification-button ${notificationsEnabled ? 'is-enabled' : ''}`} aria-label={notificationsEnabled ? 'Disable notifications' : 'Enable notifications'} aria-pressed={notificationsEnabled} onClick={toggleReminders}><Bell size={18} /></button><div className="sf-avatar sf-avatar-small" aria-label={profile.displayName}>{profile.displayName.charAt(0).toUpperCase()}</div></div></header>

        <div className="sf-content">
          {section === 'Today' && <>
            <div className="sf-greeting-row"><div><div className="sf-eyebrow"><span className="sf-live-dot" /> YOUR DAILY CHECK-IN</div><h1>{greeting}, {profile.displayName}<span className="sf-period">.</span></h1><p className="sf-subtitle">A little progress each day adds up to big results.</p></div><button className="sf-outline-button" onClick={() => setSection('Workouts')}><TrendingUp size={16} /> Weekly report</button></div>
            <ActivityInsights day={day} profile={profile} canSyncOnline={canUseOnlineFeatures} onNotice={notify} />
            <div className="sf-grid">
              <section className="sf-card sf-steps-card"><div className="sf-card-heading"><div><span className="sf-card-kicker">DAILY MOVEMENT</span><h2>Steps</h2></div><button className="sf-more" onClick={() => logSteps(Math.min(steps + 500, 200000))} aria-label="Add 500 steps">+500</button></div><div className="sf-steps-body"><div className="sf-ring-wrap"><svg className="sf-ring" viewBox="0 0 120 120" role="img" aria-label={`${steps.toLocaleString()} of ${target.toLocaleString()} steps`}><circle className="sf-ring-track" cx="60" cy="60" r="51" /><circle className="sf-ring-progress" cx="60" cy="60" r="51" strokeDasharray={`${Math.min(steps / target, 1) * 320} 320`} /></svg><div className="sf-ring-center"><Footprints size={19} /><strong>{(steps / 1000).toFixed(1)}k</strong><span>STEPS</span></div></div><div className="sf-step-copy"><div className="sf-number">{steps.toLocaleString()}<span> / {target.toLocaleString()}</span></div><p>{steps >= target ? 'You hit your daily step goal. Great job showing up.' : <>You&apos;re building a good rhythm. <strong>{Math.max(target - steps, 0).toLocaleString()} more</strong> to hit your goal.</>}</p><button className="sf-text-link" onClick={() => logSteps(Math.min(steps + 250, 200000))}>Log a short walk <ArrowRight size={15} /></button></div></div><div className="sf-card-footer"><span><span className="sf-status-dot" /> {data.stepSource === 'apple-watch' ? 'APPLE HEALTH' : data.stepSource === 'manual' ? 'MANUAL ENTRY' : 'PHONE SYNC'}</span><span>{data.stepSource === 'apple-watch' ? 'Synced from Apple Health' : data.stepSource === 'manual' ? 'Health sync needs the native app' : 'Synced from your phone'}</span></div></section>

              <section className="sf-card sf-calories-card"><div className="sf-card-heading"><div><span className="sf-card-kicker">ESTIMATED ACTIVITY</span><h2>Calories burned</h2></div><span className="sf-round-icon"><Flame size={18} /></span></div><div className="sf-calorie-number">{workoutCalories.toLocaleString()} <span>kcal</span></div><div className="sf-calorie-meta"><span><ArrowDownRight size={14} /> {data.stats.workoutsThisWeek} workouts this week</span><span>Based on your logged activity · estimates only</span></div><div className="sf-bars" aria-label="Steps over the last seven days">{weeklyBars.map((item, index) => <div className="sf-bar-wrap" key={item.day}><div className={`sf-bar ${index === 6 ? 'highlight' : ''}`} style={{ height: `${Math.max(8, (item.steps / maxSteps) * 100)}%` }} /><span>{new Date(`${item.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' })}</span></div>)}</div></section>

              <section className="sf-card sf-workout-card"><div className="sf-card-heading"><div><span className="sf-card-kicker">MADE FOR YOUR GOAL</span><h2>Today&apos;s movement</h2></div><button className="sf-text-link sf-view-plan" onClick={() => setSection('Workouts')}>View workouts <ArrowRight size={15} /></button></div><div className="sf-workout-feature"><div className="sf-workout-art"><Dumbbell size={30} strokeWidth={1.3} /><span>{profile.fitnessGoal === 'build_muscle' ? 'STRENGTH' : 'MOVE'}</span></div><div className="sf-workout-info"><span className="sf-workout-tag">{profile.fitnessGoal.replaceAll('_', ' ').toUpperCase()}</span><h3>{suggestedTitle}</h3><p>{suggestedMinutes} min <span /> Beginner-friendly <span /> Flexible</p></div><button className="sf-start-button" onClick={() => startWorkoutTimer(suggestedTitle, suggestedCategory, suggestedMinutes)} disabled={busy || Boolean(activeWorkout)}><Play size={15} fill="currentColor" /> Start workout</button></div><div className="sf-workout-progress"><span style={{ width: `${Math.min((data.stats.workoutsThisWeek / 4) * 100, 100)}%` }} /></div><div className="sf-workout-foot"><span>{data.stats.workoutsThisWeek} WORKOUT{data.stats.workoutsThisWeek === 1 ? '' : 'S'} THIS WEEK</span><button onClick={() => setSection('Workouts')}>Log activity</button></div></section>

              <section className="sf-card sf-nutrition-card"><div className="sf-card-heading"><div><span className="sf-card-kicker">NUTRITION, MADE SIMPLE</span><h2>On your plate</h2></div><button className="sf-scan-button" onClick={() => setSection('Nutrition')}><ScanLine size={16} /> Scan meal</button></div><div className="sf-meal-feature"><div className="sf-meal-placeholder" aria-hidden="true"><Apple size={24} /></div><div className="sf-meal-copy"><span className="sf-meal-label">TODAY&apos;S LOG · {meals.length} MEAL{meals.length === 1 ? '' : 'S'}</span><h3>{meals[0]?.title ?? 'Start with what you enjoy'}</h3><p>{meals[0] ? `${meals[0].caloriesKcal} estimated kcal · ${meals[0].proteinGrams}g protein` : 'Build a flexible meal plan around your preferences.'}</p><div className="sf-macro-row"><span><b>{totalCalories}</b> kcal</span><i /><span><b>{Math.round(totalProtein)}g</b> protein</span></div></div></div><button className="sf-meal-plan-link" onClick={() => setSection('Nutrition')}>See your meal plan <ArrowRight size={15} /></button></section>

              <section className="sf-card sf-quote-card"><span className="sf-quote-mark">“</span><blockquote>The gym is not just a place for physical exercise, but also a sanctuary for mental well-being.</blockquote><div className="sf-quote-by"><span /> RUFUS STEWART <span className="sf-quote-caption">· PROFESSIONAL BODYBUILDER</span></div></section>
              <section className="sf-card sf-nudge-card"><span className="sf-round-icon"><Target size={18} /></span><span className="sf-card-kicker">YOUR NEXT SMALL STEP</span><h2>{steps === 0 && data.workoutsToday.length === 0 ? 'A short walk counts.' : 'Keep your rhythm going.'}</h2><p>{steps === 0 && data.workoutsToday.length === 0 ? 'A few minutes of movement can be a good way to start. Pick something that feels comfortable today.' : 'You are building a routine at your own pace. No perfect days required.'}</p><button className="sf-text-link" onClick={() => setSection('Workouts')}>Choose an activity <ArrowRight size={15} /></button></section>
            </div>
          </>}

          {section === 'Workouts' && <>
            <PageHeading eyebrow="MOVE YOUR WAY" title="Workouts" description={`Your plan is shaped around your goal to ${goalLabels[profile.fitnessGoal] ?? 'keep moving'}. Adjust it whenever you like.`} />
            <div className="content-columns"><section className="sf-card app-panel"><div className="sf-card-heading"><div><span className="sf-card-kicker">LOG AN ACTIVITY</span><h2>What did you do?</h2></div><span className="sf-round-icon"><Activity size={18} /></span></div><form className="app-form" onSubmit={(event) => { event.preventDefault(); void logWorkout(`${workoutCategory[0].toUpperCase()}${workoutCategory.slice(1)} session`) }}><label>Activity<select value={workoutCategory} onChange={(event) => setWorkoutCategory(event.target.value as typeof workoutCategory)}>{categories.map((category) => <option key={category} value={category}>{category[0].toUpperCase() + category.slice(1)}</option>)}</select></label><label>Duration (minutes)<input type="number" min="1" max="300" value={workoutMinutes} onChange={(event) => setWorkoutMinutes(event.target.value)} disabled={Boolean(activeWorkout)} required /></label>{activeWorkout && <div className="workout-timer" role="status" aria-live="polite"><div><span>WORKOUT IN PROGRESS</span><strong>{formatWorkoutTime(remainingWorkoutSeconds)}</strong><small>{activeWorkout.title} · {activeWorkout.durationMinutes} min</small></div><button className="secondary-action" type="button" onClick={cancelWorkoutTimer}>Cancel</button></div>}<div className="workout-form-actions"><button className="primary-action" type="button" onClick={() => startWorkoutTimer(`${workoutCategory[0].toUpperCase()}${workoutCategory.slice(1)} session`, workoutCategory, Number(workoutMinutes))} disabled={busy || Boolean(activeWorkout)}><Play size={15} fill="currentColor" /> Start workout</button><button className="secondary-action" type="submit" disabled={busy || Boolean(activeWorkout)}><Plus size={16} /> Save workout</button></div><p className="form-footnote">Calories are estimated from activity type, duration, and your profile. They are not a medical measurement.</p></form></section><section className="sf-card app-panel"><div className="sf-card-heading"><div><span className="sf-card-kicker">PERSONALIZED TO YOUR GOAL</span><h2>Weekly movement plan</h2></div><button className="sf-scan-button" disabled={busy || !canUseOnlineFeatures} onClick={generateWorkoutPlan}><Sparkles size={15} /> {workoutPlanData?.plan ? 'Refresh plan' : 'Create plan'}</button></div>{!canUseOnlineFeatures && <FeatureGate browserOnline={browserOnline} backendStatus={backendStatus} onConnect={() => router.push('/auth')} />} {workoutPlanData?.plan ? <><p className="panel-copy">{workoutPlanData.plan.summary}</p><div className="workout-plan-list">{workoutPlanData.plan.sessions.map((session) => <article className="workout-session" key={session.day}><span className="plan-time">{session.day} · {session.durationMinutes} MIN</span><h3>{session.title}</h3><p>{session.focus}</p><ul>{session.exercises.map((exercise) => <li key={exercise}>{exercise}</li>)}</ul><p className="workout-rest-note">{session.restNote}</p><button className="sf-text-link" disabled={busy} onClick={() => logWorkout(session.title, session.category, session.durationMinutes)}>Log this session <ArrowRight size={14} /></button></article>)}</div></> : <EmptyState icon={<Sparkles size={20} />} title="A plan shaped around your goal" text="Generate three flexible, beginner-friendly sessions based on your profile. You can switch to a fresh plan any time." action={<button className="primary-action" disabled={busy} onClick={generateWorkoutPlan}>Create my plan <ArrowRight size={15} /></button>} />}</section></div>
            <section className="sf-card app-panel offline-workout-panel" aria-labelledby="offline-workouts-title"><div className="sf-card-heading"><div><span className="sf-card-kicker">READY WITHOUT INTERNET</span><h2 id="offline-workouts-title">Offline workouts</h2></div><span className="history-total">{offlineWorkouts.length} available</span></div><p className="panel-copy">These routines are saved with the app and can be started without a connection.</p><div className="offline-workout-grid">{offlineWorkouts.map((workout, index) => <article className="offline-workout-card" key={`${workout.title}-${index}`}><div className="offline-workout-meta"><span className="offline-badge">OFFLINE</span><span>{workout.durationMinutes} min</span></div><h3>{workout.title}</h3><p>{workout.focus}</p><ul>{workout.exercises.map((exercise) => <li key={exercise}>{exercise}</li>)}</ul><button className="primary-action" type="button" disabled={busy || Boolean(activeWorkout)} onClick={() => startWorkoutTimer(workout.title, workout.category, workout.durationMinutes)}><Play size={14} fill="currentColor" /> Start workout</button></article>)}</div></section>
            <section className="sf-card app-panel workout-coach-panel"><div className="sf-card-heading"><div><span className="sf-card-kicker">ASK ABOUT MOVEMENT</span><h2>Workout coach</h2></div><span className="sf-round-icon"><Sparkles size={18} /></span></div><p className="panel-copy">Ask what an exercise is, which muscles it works, or for a beginner-friendly form tip.</p>{!canUseOnlineFeatures && <FeatureGate browserOnline={browserOnline} backendStatus={backendStatus} onConnect={() => router.push('/auth')} />}<div className="coach-quick-questions" aria-label="Example workout questions"><button type="button" onClick={() => void askWorkoutCoach('What are glute bridges, and what part of the body do they work?')}>What are glute bridges?</button><button type="button" onClick={() => void askWorkoutCoach('What muscles do bodyweight squats work?')}>What do squats work?</button></div><div className="coach-transcript" aria-live="polite" aria-label="Workout coach conversation">{coachMessages.length ? coachMessages.map((message, index) => <p className={`coach-message ${message.role}`} key={`${index}-${message.role}`}><strong>{message.role === 'user' ? 'You' : 'Coach'}</strong><span>{message.text}</span></p>) : <p className="coach-empty">Your questions and answers will appear here.</p>}{coachBusy && <p className="coach-thinking" role="status">Your coach is thinking…</p>}</div><form className="coach-composer" onSubmit={(event) => { event.preventDefault(); void askWorkoutCoach(coachQuestion) }}><label className="sr-only" htmlFor="workout-coach-question">Ask the workout coach</label><input id="workout-coach-question" value={coachQuestion} onChange={(event) => setCoachQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault() }} maxLength={500} placeholder="Ask about an exercise…" disabled={!canUseOnlineFeatures || coachBusy} /><button className="primary-action" type="submit" disabled={!canUseOnlineFeatures || coachBusy || coachQuestion.trim().length < 3}>{coachBusy ? 'Thinking…' : 'Ask'}</button></form><p className="form-footnote">General fitness education only—not medical advice. Stop if a movement causes pain.</p></section>
            <section className="sf-card app-panel history-panel"><div className="sf-card-heading"><div><span className="sf-card-kicker">YOUR MOVEMENT</span><h2>This week</h2></div><span className="history-total">{data.workoutsThisWeek.length} logged</span></div>{data.workoutsThisWeek.length ? <div className="history-list">{data.workoutsThisWeek.map((workout) => <div className="history-row" key={workout.id}><span className="history-icon"><Dumbbell size={16} /></span><div><strong>{workout.title}</strong><small>{workout.category} · {workout.durationMinutes} min · {new Date(workout.completedAt).toLocaleDateString()}</small></div><span>{workout.caloriesBurned} kcal est.</span></div>)}</div> : <EmptyState icon={<Dumbbell size={20} />} title="Your first workout starts here" text="Log an activity when you finish. It will stay in your personal history." />}</section>
          </>}

          {section === 'Nutrition' && <>
            <PageHeading eyebrow="FLEXIBLE FOOD IDEAS" title="Nutrition" description="Ideas and estimates to support your habits—not rules or medical advice." />
            <div className="nutrition-summary"><div className="sf-card summary-tile"><span className="sf-card-kicker">LOGGED TODAY</span><strong>{totalCalories.toLocaleString()} <small>kcal</small></strong><span>{meals.length} meals</span></div><div className="sf-card summary-tile"><span className="sf-card-kicker">PROTEIN ESTIMATE</span><strong>{Math.round(totalProtein)} <small>g</small></strong><span>Based on your entries</span></div><div className="sf-card summary-tile"><span className="sf-card-kicker">YOUR PREFERENCES</span><strong>{profile.dietaryPreferences.length ? profile.dietaryPreferences.length : 'No'} <small>set</small></strong><span>{profile.dietaryPreferences.join(', ') || 'Open to suggestions'}</span></div></div>
            <div className="content-columns"><section className="sf-card app-panel"><div className="sf-card-heading"><div><span className="sf-card-kicker">AI FOOD CAMERA</span><h2>Scan a meal</h2></div><span className="sf-round-icon"><ScanLine size={18} /></span></div><p className="panel-copy">Take a picture or choose one from your photo library. The online service estimates nutrition, then saves the result to this device and your account.</p>{!canUseOnlineFeatures && <FeatureGate browserOnline={browserOnline} backendStatus={backendStatus} onConnect={() => router.push('/auth')} />}<label className={`photo-picker ${busy || !canUseOnlineFeatures ? 'disabled' : ''}`}><input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy || !canUseOnlineFeatures} onChange={(event) => { void scanPhoto(event.target.files?.[0]); event.currentTarget.value = '' }} /><ScanLine size={19} /><strong>{busy ? 'Working on your estimate…' : 'Take or choose a photo'}</strong><span>JPG, PNG, or WebP · up to 5 MB</span></label>{scanResult && <div className="scan-result" role="status"><div><strong>{scanResult.title}</strong><span>{scanResult.caloriesKcal} kcal · {scanResult.proteinGrams}g protein · {scanResult.carbsGrams}g carbs</span></div><p>{scanResult.aiNotes}</p></div>}<p className="form-footnote">AI estimates can be inaccurate, especially for portions, sauces, and hidden ingredients. Review before relying on them.</p></section>
              <section className="sf-card app-panel"><div className="sf-card-heading"><div><span className="sf-card-kicker">WORKS OFFLINE</span><h2>Log a meal</h2></div><span className="sf-round-icon"><Apple size={18} /></span></div><form className="app-form" onSubmit={saveManualMeal}><label>Meal name<input name="mealName" maxLength={100} placeholder="e.g. Lentil soup" required /></label><label>Meal type<select name="mealType"><option value="breakfast">Breakfast</option><option value="lunch">Lunch</option><option value="dinner">Dinner</option><option value="snack">Snack</option><option value="meal">Other</option></select></label><label>Calories (kcal)<input name="mealCalories" type="number" min="0" max="10000" step="1" defaultValue="0" required /></label><label>Protein (g)<input name="mealProtein" type="number" min="0" max="500" step="0.1" defaultValue="0" required /></label><button className="primary-action" type="submit"><Plus size={16} /> Save meal</button></form></section>
              <section className="sf-card app-panel"><div className="sf-card-heading"><div><span className="sf-card-kicker">MADE AROUND YOU</span><h2>Today&apos;s meal plan</h2></div><button className="sf-scan-button" onClick={generatePlan} disabled={busy || !canUseOnlineFeatures}><Sparkles size={15} /> {planData?.plan ? 'Refresh' : 'Create plan'}</button></div>{!canUseOnlineFeatures && <FeatureGate browserOnline={browserOnline} backendStatus={backendStatus} onConnect={() => router.push('/auth')} />} {planData?.plan ? <><p className="panel-copy">{planData.plan.summary}</p><div className="plan-list">{planData.plan.meals.map((meal, index) => <article className="plan-meal" key={`${meal.type}-${index}`}><span className="plan-time">{meal.type}</span><div><h3>{meal.name}</h3><p>{meal.description}</p><span>{meal.caloriesKcal} kcal · {meal.proteinGrams}g protein</span><button className="sf-text-link" onClick={() => logMeal({ title: meal.name, mealType: meal.type as Meal['mealType'], caloriesKcal: meal.caloriesKcal, proteinGrams: meal.proteinGrams, carbsGrams: 0, fatGrams: 0, ingredients: meal.ingredients, aiNotes: 'From your generated meal plan. Nutrition values are approximate.' })}>Add to today&apos;s log <Plus size={14} /></button></div></article>)}</div></> : <EmptyState icon={<Sparkles size={20} />} title="A plan that fits your preferences" text="Generate four flexible meal ideas based on your goal and food preferences." action={<button className="primary-action" disabled={busy || !canUseOnlineFeatures} onClick={generatePlan}>Create my meal plan <ArrowRight size={15} /></button>} />}</section></div>
            <section className="sf-card app-panel history-panel"><div className="sf-card-heading"><div><span className="sf-card-kicker">YOUR FOOD JOURNAL</span><h2>Today&apos;s meals</h2></div><span className="history-total">{meals.length} entries</span></div>{meals.length ? <div className="history-list">{meals.map((meal) => <div className="history-row" key={meal.id}><span className="history-icon"><Apple size={16} /></span><div><strong>{meal.title}</strong><small>{meal.mealType} · {new Date(meal.loggedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small></div><span>{meal.caloriesKcal} kcal · {meal.proteinGrams}g protein</span></div>)}</div> : <EmptyState icon={<Apple size={20} />} title="Your food journal is ready" text="Scan a meal or add a meal from your plan to start tracking." />}</section>
          </>}

          {section === 'Leaderboard' && <>
            <PageHeading eyebrow="A LITTLE FRIENDLY MOTIVATION" title="Your circle" description="Connect with friends and compare today’s movement. Only your username, steps, and estimated activity calories are shared." />
            <div className="content-columns"><section className="sf-card app-panel"><div className="sf-card-heading"><div><span className="sf-card-kicker">FIND YOUR PEOPLE</span><h2>Add a friend</h2></div><span className="sf-round-icon"><UserPlus size={18} /></span></div>{!canUseOnlineFeatures && <FeatureGate browserOnline={browserOnline} backendStatus={backendStatus} onConnect={() => router.push('/auth')} />}<form className="friend-form" onSubmit={addFriend}><label className="sr-only" htmlFor="friend-username">Friend username</label><span>@</span><input id="friend-username" value={friendUsername} onChange={(event) => setFriendUsername(event.target.value)} placeholder="friend_username" minLength={3} maxLength={24} disabled={!canUseOnlineFeatures} required /><button className="primary-action" disabled={busy || !canUseOnlineFeatures} type="submit">Send request <ArrowRight size={15} /></button></form>{friends?.incoming.length ? <div className="request-list"><span className="sf-card-kicker">FRIEND REQUESTS</span>{friends.incoming.map((request) => <div className="request-row" key={request.id}><div><strong>{request.displayName}</strong><small>@{request.username}</small></div><button className="small-action" disabled={busy} onClick={() => answerFriendRequest(request.id, true)}>Accept</button><button className="small-quiet" disabled={busy} onClick={() => answerFriendRequest(request.id, false)}>Decline</button></div>)}</div> : null}</section>
              <section className="sf-card app-panel privacy-panel"><span className="sf-card-kicker">YOUR PRIVACY, YOUR CALL</span><h2>Share your daily activity?</h2><p className="panel-copy">Your stats are private until you opt in. Friends can only see your username, today&apos;s steps, and estimated activity calories. Your weight, birthday, meals, and goals stay private.</p><button className={`toggle-row ${profile.leaderboardOptIn ? 'is-on' : ''}`} role="switch" aria-checked={profile.leaderboardOptIn} onClick={toggleLeaderboard}><span><strong>{profile.leaderboardOptIn ? 'Sharing with friends' : 'Stats are private'}</strong><small>{profile.leaderboardOptIn ? 'Turn off to hide your activity.' : 'Turn on to appear on your friends’ board.'}</small></span><i /></button></section></div>
            <section className="sf-card app-panel history-panel"><div className="sf-card-heading"><div><span className="sf-card-kicker">TODAY</span><h2>Friends leaderboard</h2></div><span className="history-total"><Users size={14} /> {friends?.leaderboard.length ?? 0} friends sharing</span></div>{friends?.leaderboard.length ? <div className="leaderboard-list">{friends.leaderboard.map((friend, index) => <div className="leaderboard-row" key={friend.userId}><span className="rank-number">{String(index + 1).padStart(2, '0')}</span><span className="sf-avatar">{friend.displayName.charAt(0).toUpperCase()}</span><div><strong>{friend.displayName}</strong><small>@{friend.username}</small></div><span className="leader-stat"><Footprints size={14} /> {friend.steps.toLocaleString()}</span><span className="leader-stat"><Flame size={14} /> {friend.caloriesBurned} kcal</span></div>)}</div> : <EmptyState icon={<Medal size={20} />} title="Your circle starts with a friend" text="Send a request by username. Friends have to opt in before their daily activity appears here." />}</section>
          </>}

          {section === 'Settings' && <>
            <PageHeading eyebrow="YOUR ACCOUNT" title="Settings" description="Keep your goals and privacy choices up to date." />
            <div className="content-columns"><section className="sf-card app-panel"><span className="sf-card-kicker">DAILY MOVEMENT</span><h2>Your step goal</h2><p className="panel-copy">Choose a personal target that feels realistic for you. You can adjust it as your routine changes.</p><form className="app-form inline-setting" onSubmit={changeStepGoal}><label>Steps per day<input type="number" name="dailyStepGoal" min="1000" max="50000" step="500" defaultValue={profile.dailyStepGoal} required /></label><button className="primary-action" type="submit">Save goal <Check size={15} /></button></form></section><section className="sf-card app-panel"><span className="sf-card-kicker">DEVICE NOTIFICATIONS</span><h2>Gentle reminders</h2><p className="panel-copy">Allow notifications on this device for an in-session reminder. Browser background delivery depends on your platform and is not guaranteed.</p><button className="secondary-action" onClick={toggleReminders} aria-pressed={notificationsEnabled}><Bell size={16} /> {notificationsEnabled ? 'Disable notifications' : 'Enable notifications'}</button></section></div>
            <div className="content-columns settings-extra-panels"><section className="sf-card app-panel"><span className="sf-card-kicker">ACCOUNT SECURITY</span><h2>Change password</h2><p className="panel-copy">Use your current password to update the password for this device and your online account when connected.</p><form className="app-form" onSubmit={updatePassword}><label>Current password<input name="currentPassword" type="password" autoComplete="current-password" minLength={8} maxLength={128} required /></label><label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label><label>Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label><button className="primary-action" type="submit" disabled={busy}>Change password</button>{!canUseOnlineFeatures && <p className="form-footnote">You’re offline or not connected to your online account. The change will apply on this device only.</p>}</form></section><section className="sf-card app-panel"><span className="sf-card-kicker">PERSONALIZE YOUR SPACE</span><h2>Appearance</h2><p className="panel-copy">Choose a light or dark look and an accent color. Your choices are saved on this device.</p><fieldset className="appearance-fieldset"><legend>Color theme</legend><div className="appearance-options"><button type="button" className={`appearance-option ${appearance.theme === 'light' ? 'selected' : ''}`} aria-pressed={appearance.theme === 'light'} onClick={() => saveAppearance({ theme: 'light' })}><Sun size={16} /> Light</button><button type="button" className={`appearance-option ${appearance.theme === 'dark' ? 'selected' : ''}`} aria-pressed={appearance.theme === 'dark'} onClick={() => saveAppearance({ theme: 'dark' })}><Moon size={16} /> Dark</button></div></fieldset><fieldset className="appearance-fieldset"><legend>Accent color</legend><div className="appearance-swatches">{(['mono', 'sage', 'blue', 'coral'] as const).map((accent) => <button key={accent} type="button" className={`appearance-swatch ${appearance.accent === accent ? 'selected' : ''}`} data-accent-option={accent} aria-label={`Use ${accent} accent`} aria-pressed={appearance.accent === accent} onClick={() => saveAppearance({ accent })} />)}</div></fieldset><p className="appearance-current">Selected: {appearance.theme} theme · {appearance.accent} accent</p></section></div>
            <section className="sf-card app-panel signout-panel"><div><span className="sf-card-kicker">ACCOUNT</span><h2>{profile.displayName}</h2><p className="panel-copy">Signed in as {userName}. Your personal fitness records are scoped to this account.</p></div><button className="secondary-action" onClick={signOut}><LogOut size={16} /> Sign out</button></section>
          </>}

          {section === 'Download' && <>
            <PageHeading eyebrow="STAY FIT ON YOUR PHONE" title="Get the app" description="Install Stay Fit on your phone for a smoother daily tracking experience. Choose your device for download and setup instructions." />
            <DownloadInstructions />
          </>}
          <footer className="sf-footer"><span>SHOW UP FOR YOURSELF. THAT&apos;S ENOUGH.</span><span>STAY FIT<span className="sf-period">.</span> &nbsp;·&nbsp; YOUR PACE, YOUR PROGRESS</span></footer>
        </div>
      </section>

      <nav className="sf-mobile-nav" aria-label="Mobile navigation">{[...navItems, { label: 'Settings' as Section, icon: Settings }].map(({ label, icon: Icon }) => <button key={label} className={section === label ? 'active' : ''} onClick={() => setSection(label)}><Icon size={19} /><span>{label}</span></button>)}</nav>
      <audio ref={workoutCompletionAudioRef} src="/workout-complete.mp3" preload="auto" />
      {activeWorkout && <section className="workout-focus-screen" role="dialog" aria-modal="true" aria-labelledby="workout-focus-title" aria-describedby="workout-focus-description"><div className="workout-focus-content"><span className="sf-card-kicker">YOUR SESSION · {activeWorkout.category.toUpperCase()}</span><h1 id="workout-focus-title">{activeWorkout.title}</h1><p id="workout-focus-description">Stay present and move at a pace that feels right for you.</p><div className="workout-focus-timer" role="timer" aria-label={`${remainingWorkoutSeconds} seconds remaining`} aria-live="off">{formatWorkoutTime(remainingWorkoutSeconds)}</div><span className="workout-focus-caption">TIME REMAINING</span><button className="workout-stop-button" type="button" autoFocus onClick={cancelWorkoutTimer}>Stop workout</button></div></section>}
      {workoutCompletion && <section className="workout-completion-backdrop" role="dialog" aria-modal="true" aria-labelledby="workout-completion-title"><div className="workout-completion-card"><span className="workout-completion-icon"><Check size={24} /></span><span className="sf-card-kicker">SESSION COMPLETE</span><h2 id="workout-completion-title">You did great.</h2><p>{workoutCompletion.title} is done. Take a breath—you showed up for yourself.</p><button className="workout-sound-button" type="button" onClick={() => { const audio = workoutCompletionAudioRef.current; if (audio) { audio.currentTime = 0; void audio.play().catch(() => notify('Sound is unavailable on this device right now.')) } }}>Play celebration sound</button><div className="workout-next-options"><span className="sf-card-kicker">WHAT WOULD YOU LIKE TO DO NEXT?</span>{offlineWorkouts.filter((workout) => workout.title !== workoutCompletion.title).slice(0, 3).map((workout) => <button key={workout.title} type="button" onClick={() => startWorkoutTimer(workout.title, workout.category, workout.durationMinutes)}><span><strong>{workout.title}</strong><small>{workout.durationMinutes} min · {workout.category}</small></span><ArrowRight size={16} /></button>)}<button className="workout-dashboard-button" type="button" autoFocus onClick={() => { setWorkoutCompletion(null); setSection('Today') }}>Back to dashboard</button></div></div></section>}
      {toast && <div className="sf-toast" role="status"><Check size={17} />{toast}<button onClick={() => setToast('')} aria-label="Dismiss"><X size={16} /></button></div>}
    </main>
  )
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="app-page-heading"><span className="sf-card-kicker">{eyebrow}</span><h1>{title}<span className="sf-period">.</span></h1><p>{description}</p></div>
}

function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state"><span>{icon}</span><strong>{title}</strong><p>{text}</p>{action}</div>
}

function FeatureGate({ browserOnline, backendStatus, onConnect }: { browserOnline: boolean; backendStatus?: BackendStatus; onConnect: () => void }) {
  return <div className="feature-gate" role="status"><strong>Internet required for AI &amp; Friends</strong><span>Connect to the internet and sign in online to use meal scans, AI plans, and friend features. Your local tracking remains available.</span>{browserOnline && backendStatus?.reachable && !backendStatus.authenticated && <button className="small-action" type="button" onClick={onConnect}>Connect online account</button>}</div>
}

function DownloadInstructions() {
  return <>
    <div className="download-availability" role="status"><strong>Downloads are being prepared.</strong><span>The APK and IPA download buttons will be enabled when the files are added. iPhone IPA installs also need a supported signing and distribution method.</span></div>
    <div className="content-columns download-platforms">
      <section className="sf-card app-panel download-platform-card" aria-labelledby="android-download-title">
        <div className="download-platform-icon"><Smartphone size={20} /></div>
        <span className="sf-card-kicker">ANDROID</span>
        <h2 id="android-download-title">Android phone</h2>
        <p className="panel-copy">Android installs directly on your phone. No Windows PC or Mac is needed.</p>
        <button className="primary-action download-file-button" type="button" disabled aria-describedby="android-download-status"><Download size={15} /> APK download coming soon</button>
        <span className="download-status" id="android-download-status">The StayFit.apk link will appear here when the APK is provided.</span>
        <ol className="download-steps">
          <li>Tap the StayFit.apk download button and wait for the file to finish downloading.</li>
          <li>Open the APK from your notifications or your Files app.</li>
          <li>If Android asks, allow installs from the specific browser or file manager you used, then return to the installer.</li>
          <li>Review the install prompt and tap <strong>Install</strong>. If Play Protect shows a warning, stop and verify the APK came from the official Stay Fit download before deciding whether to continue. Do not bypass an unexpected warning.</li>
          <li>Open Stay Fit, create or sign in to your account, and allow Physical Activity and Camera access if you want step tracking and meal scanning.</li>
        </ol>
      </section>
      <section className="sf-card app-panel download-platform-card" aria-labelledby="iphone-download-title">
        <div className="download-platform-icon"><Apple size={20} /></div>
        <span className="sf-card-kicker">IPHONE</span>
        <h2 id="iphone-download-title">iPhone setup</h2>
        <p className="panel-copy">The IPA needs to be signed and installed through an iOS-supported method. Pick the computer you&apos;ll use:</p>
        <button className="primary-action download-file-button" type="button" disabled aria-describedby="iphone-download-status"><Download size={15} /> IPA download coming soon</button>
        <span className="download-status" id="iphone-download-status">The StayFit.ipa file and install link will appear here when they&apos;re ready.</span>
        <div className="iphone-guides">
          <details className="install-guide" open>
            <summary>Install with a Windows PC</summary>
            <ol className="download-steps">
              <li>Install the desktop version of iTunes from <a href="https://support.apple.com/downloads/itunes" target="_blank" rel="noreferrer">Apple&apos;s iTunes downloads</a>. Do not use the Microsoft Store version for this setup.</li>
              <li>Download Sideloadly for Windows from <a href="https://sideloadly.io" target="_blank" rel="noreferrer">the Sideloadly website</a> and install it.</li>
              <li>Connect your iPhone by USB, unlock it, and tap <strong>Trust</strong> if asked. Open Sideloadly and confirm your iPhone appears in the device list.</li>
              <li>Select the StayFit.ipa file in Sideloadly and follow its current installation and signing instructions.</li>
              <li>When installation completes, on iPhone open <strong>Settings → General → VPN &amp; Device Management</strong>. Trust the developer profile only if you initiated this install and recognize the signing account.</li>
              <li>Open Stay Fit and allow Motion &amp; Fitness and Camera permissions if you want those features.</li>
            </ol>
          </details>
          <details className="install-guide">
            <summary>Install with a Mac</summary>
            <ol className="download-steps">
              <li>Download Sideloadly for macOS from <a href="https://sideloadly.io" target="_blank" rel="noreferrer">the Sideloadly website</a>, open the .dmg file, and drag Sideloadly into Applications. No iTunes install is needed on Mac.</li>
              <li>If macOS blocks it, use Control-click → <strong>Open</strong> only after verifying you downloaded it from the official Sideloadly site and intend to use it.</li>
              <li>Connect your iPhone by USB, unlock it, and tap <strong>Trust</strong> if asked. Open Sideloadly and confirm your iPhone appears in the device list.</li>
              <li>Select the StayFit.ipa file in Sideloadly and follow its current installation and signing instructions.</li>
              <li>When installation completes, on iPhone open <strong>Settings → General → VPN &amp; Device Management</strong>. Trust the developer profile only if you initiated this install and recognize the signing account.</li>
              <li>Open Stay Fit and allow Motion &amp; Fitness and Camera permissions if you want those features.</li>
            </ol>
          </details>
        </div>
        <p className="install-security-note"><strong>Apple ID safety:</strong> Sideloadly is third-party software and may require account authentication to sign an app. Review its official guidance first; never share your password or verification code with another person, and stop if any prompt seems unexpected. Free-account signing may require reinstalling or refreshing the app about every 7 days.</p>
      </section>
    </div>
  </>
}

