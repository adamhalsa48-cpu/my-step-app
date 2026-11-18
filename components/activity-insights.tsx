'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import useSWR from 'swr'
import { Activity, Apple, CalendarDays, Check, ChevronLeft, ChevronRight, Clipboard, Flame, Footprints, HeartPulse, RefreshCw, ShieldCheck, Watch } from 'lucide-react'
import { apiRequest } from '@/lib/api-client'
import {
  getLocalActivity,
  getLocalSteps,
  saveLocalSteps,
  saveSyncedActivity,
  saveWeeklyGoals,
  type DailyActivity,
  type Profile,
} from '@/lib/local-store'

type HistoryDay = { day: string; steps: number; source: string; activity: DailyActivity | null }
type SyncResponse = { history: HistoryDay[]; goals?: Goals | null }
type Props = { day: string; profile: Profile; canSyncOnline: boolean; onNotice: (message: string) => void }
type Goals = { weeklyStepGoal: number; weeklyActiveDaysGoal: number; weeklyCalorieGoal: number }

const localDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const dateAtNoon = (day: string) => new Date(`${day}T12:00:00`)
const mondayOf = (date: Date) => {
  const monday = new Date(date)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return monday
}
const isoDay = (date: Date) => localDay(date)
const formatDate = (day: string, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) => dateAtNoon(day).toLocaleDateString(undefined, options)
const metricNumber = (value: number) => Number(value || 0).toLocaleString()

function useCurrentDay() {
  const [today, setToday] = useState(() => localDay(new Date()))
  useEffect(() => {
    const timer = window.setInterval(() => setToday(localDay(new Date())), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return today
}

export function ActivityInsights({ day, profile, canSyncOnline, onNotice }: Props) {
  const today = useCurrentDay()
  const [month, setMonth] = useState(() => new Date(`${day}T12:00:00`))
  const [selectedDay, setSelectedDay] = useState(day)
  const [showGuide, setShowGuide] = useState(false)
  const [busy, setBusy] = useState(false)
  const [syncToken, setSyncToken] = useState('')
  const [goals, setGoals] = useState<Goals>({
    weeklyStepGoal: profile.weeklyStepGoal ?? 70000,
    weeklyActiveDaysGoal: profile.weeklyActiveDaysGoal ?? 5,
    weeklyCalorieGoal: profile.weeklyCalorieGoal ?? 3500,
  })

  const calendarDays = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1, 12)
    const start = mondayOf(first)
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start)
      date.setDate(start.getDate() + index)
      return isoDay(date)
    })
  }, [month])
  const monday = mondayOf(dateAtNoon(today))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const rangeStart = calendarDays[0]
  const rangeEnd = calendarDays[41]
  const syncKey = canSyncOnline ? `stay-fit-apple-health-${rangeStart}-${rangeEnd}` : null
  const { data: remote, isValidating, mutate } = useSWR<SyncResponse>(
    syncKey,
    () => apiRequest<SyncResponse>(`apple-watch/sync?from=${rangeStart}&to=${rangeEnd}`),
    { revalidateOnFocus: true, revalidateOnReconnect: true, refreshInterval: 300000 },
  )
  const weekStart = isoDay(monday)
  const weekEnd = isoDay(sunday)
  const weekSyncKey = canSyncOnline ? `stay-fit-apple-health-week-${weekStart}` : null
  const { data: remoteWeek, isValidating: isWeekValidating, mutate: mutateWeek } = useSWR<SyncResponse>(
    weekSyncKey,
    () => apiRequest<SyncResponse>(`apple-watch/sync?from=${weekStart}&to=${weekEnd}`),
    { revalidateOnFocus: true, revalidateOnReconnect: true, refreshInterval: 300000 },
  )
  const syncing = isValidating || isWeekValidating
  useEffect(() => {
    if (remote?.goals) {
      setGoals(remote.goals)
      saveWeeklyGoals(remote.goals)
    }
    const remoteHistory = [...(remote?.history ?? []), ...(remoteWeek?.history ?? [])]
    for (const entry of remoteHistory) {
      if (entry.activity) saveSyncedActivity(entry.day, entry.steps, entry.activity)
      else if (entry.steps > 0) saveLocalSteps(entry.day, entry.steps, entry.source)
    }
  }, [remote, remoteWeek])

  useEffect(() => {
    if (!showGuide) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = document.querySelector<HTMLElement>('[data-activity-dialog]')
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])
    focusable()[0]?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowGuide(false)
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items.length) return
      if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault()
        items[items.length - 1].focus()
      } else if (!event.shiftKey && document.activeElement === items[items.length - 1]) {
        event.preventDefault()
        items[0].focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus()
    }
  }, [showGuide])

  useEffect(() => {
    setGoals({
      weeklyStepGoal: profile.weeklyStepGoal ?? 70000,
      weeklyActiveDaysGoal: profile.weeklyActiveDaysGoal ?? 5,
      weeklyCalorieGoal: profile.weeklyCalorieGoal ?? 3500,
    })
  }, [profile.weeklyStepGoal, profile.weeklyActiveDaysGoal, profile.weeklyCalorieGoal])

  const historyByDay = useMemo(() => new Map([...(remote?.history ?? []), ...(remoteWeek?.history ?? [])].map((entry) => [entry.day, entry])), [remote, remoteWeek])
  const stepsFor = (date: string) => Math.max(historyByDay.get(date)?.steps ?? 0, getLocalSteps(date))
  const activityFor = (date: string) => historyByDay.get(date)?.activity ?? getLocalActivity(date)
  const selectedSteps = stepsFor(selectedDay)
  const selectedActivity = activityFor(selectedDay)
  const yesterday = new Date(`${today}T12:00:00`)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayKey = isoDay(yesterday)
  const yesterdaySteps = stepsFor(yesterdayKey)
  const yesterdayActivity = activityFor(yesterdayKey)
  const yesterdayHitGoal = yesterdaySteps >= profile.dailyStepGoal
  const currentMonth = month.getMonth()

  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + index)
    return isoDay(date)
  })
  const weekSteps = weekDays.reduce((sum, date) => sum + stepsFor(date), 0)
  const weekCalories = weekDays.reduce((sum, date) => sum + activityFor(date).activeCalories, 0)
  const activeDays = weekDays.filter((date) => stepsFor(date) > 0 || activityFor(date).workoutMinutes > 0).length
  const remainingDays = Math.max(weekDays.filter((date) => date >= today).length, 1)
  const stepsRemaining = Math.max(goals.weeklyStepGoal - weekSteps, 0)
  const dailyPace = Math.ceil(stepsRemaining / remainingDays)
  const goalStreak = (() => {
    let count = 0
    const cursor = dateAtNoon(today)
    if (stepsFor(today) < profile.dailyStepGoal) cursor.setDate(cursor.getDate() - 1)
    for (let index = 0; index < 366; index += 1) {
      if (stepsFor(isoDay(cursor)) < profile.dailyStepGoal) break
      count += 1
      cursor.setDate(cursor.getDate() - 1)
    }
    return count
  })()

  async function syncNow() {
    if (!canSyncOnline) return onNotice('Sign in to your online account to sync Apple Health data.')
    setBusy(true)
    try {
      await Promise.all([mutate(), mutateWeek()])
      onNotice('Latest Apple Health data synced to this device.')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Could not sync Apple Health data.')
    } finally {
      setBusy(false)
    }
  }

  async function createSyncToken() {
    if (!canSyncOnline) return onNotice('Sign in online before creating a secure Shortcut token.')
    setBusy(true)
    try {
      const result = await apiRequest<{ token: string }>('apple-watch/sync', { method: 'POST', body: JSON.stringify({ action: 'create-token' }) })
      setSyncToken(result.token)
      onNotice('New sync token created. Copy it into your Shortcut now; it is only shown once.')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Could not create a sync token.')
    } finally {
      setBusy(false)
    }
  }

  async function copyText(value: string, success: string) {
    try {
      await navigator.clipboard.writeText(value)
      onNotice(success)
    } catch {
      onNotice('Clipboard access is unavailable. Select and copy the text instead.')
    }
  }

  async function saveGoals(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const next = {
      weeklyStepGoal: Number(form.get('weeklyStepGoal')),
      weeklyActiveDaysGoal: Number(form.get('weeklyActiveDaysGoal')),
      weeklyCalorieGoal: Number(form.get('weeklyCalorieGoal')),
    }
    if (!Number.isInteger(next.weeklyStepGoal) || next.weeklyStepGoal < 10000 || next.weeklyStepGoal > 500000
      || !Number.isInteger(next.weeklyActiveDaysGoal) || next.weeklyActiveDaysGoal < 1 || next.weeklyActiveDaysGoal > 7
      || !Number.isInteger(next.weeklyCalorieGoal) || next.weeklyCalorieGoal < 500 || next.weeklyCalorieGoal > 50000) {
      return onNotice('Choose valid weekly targets and try again.')
    }
    setGoals(next)
    saveWeeklyGoals(next)
    if (canSyncOnline) {
      try {
        await apiRequest('profile', { method: 'PATCH', body: JSON.stringify(next) })
      } catch {
        onNotice('Goals saved offline; online sync will retry when available.')
        return
      }
    }
    onNotice('Weekly goals saved on this device.')
  }

  function changeMonth(offset: number) {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1, 12))
  }

  return (
    <div className="activity-insights-stack">
      <section className="activity-hub sf-card" aria-labelledby="apple-health-title">
        <div className="activity-hub-heading">
          <div>
            <span className="sf-card-kicker">APPLE HEALTH · PRIVATE BY DEFAULT</span>
            <h2 id="apple-health-title">Your movement, in one place</h2>
            <p>Use Apple Shortcuts to send daily Health totals securely to Stay Fit.</p>
          </div>
          <span className="activity-watch-mark" aria-hidden="true"><Watch /></span>
        </div>
        <div className="activity-actions">
          <button className="primary-action" type="button" onClick={() => setShowGuide(true)}><Apple size={15} /> Connect Apple Watch</button>
          <button className="secondary-action" type="button" disabled={busy || syncing || !canSyncOnline} onClick={() => void syncNow()}><RefreshCw size={15} /> {busy || syncing ? 'Syncing…' : 'Sync now'}</button>
          {!canSyncOnline && <span className="activity-online-note">Sign in online to refresh saved Health data.</span>}
        </div>
        <div className="activity-metric-grid">
          <Metric icon={<Footprints />} label="Health steps" value={metricNumber(stepsFor(today))} detail="Watch + iPhone total" />
          <Metric icon={<Flame />} label="Active calories" value={metricNumber(activityFor(today).activeCalories)} detail="kcal from Apple Health" />
          <Metric icon={<HeartPulse />} label="Heart rate" value={activityFor(today).averageHeartRate ? `${activityFor(today).averageHeartRate} bpm` : '—'} detail={activityFor(today).restingHeartRate ? `Resting ${activityFor(today).restingHeartRate} bpm` : 'No reading yet'} />
          <Metric icon={<Activity />} label="Workouts" value={`${metricNumber(activityFor(today).workoutMinutes)} min`} detail={`${(activityFor(today).distanceMeters / 1000).toFixed(2)} km distance`} />
        </div>
        <div className="activity-sync-footer"><span><span className={`activity-sync-dot ${activityFor(today).syncedAt ? 'is-synced' : ''}`} />{activityFor(today).syncedAt ? `LAST SYNCED ${new Date(activityFor(today).syncedAt as string).toLocaleString()}` : 'NO APPLE HEALTH SYNC YET'}</span><span><ShieldCheck size={13} /> Token is stored as a hash</span></div>
      </section>

      <section className={`yesterday-recap ${yesterdayHitGoal ? 'goal-met' : 'goal-missed'}`} aria-labelledby="yesterday-recap-title">
        <div className="recap-icon"><CalendarDays /></div>
        <div className="recap-copy"><span className="sf-card-kicker">YESTERDAY · {formatDate(yesterdayKey, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}</span><h2 id="yesterday-recap-title">Yesterday&apos;s recap</h2><p>{yesterdayHitGoal ? 'Daily step goal reached. Nice work.' : 'Every day is a fresh start—keep building your rhythm.'}</p></div>
        <div className="recap-stat"><strong>{metricNumber(yesterdaySteps)}</strong><span>steps</span></div>
        <div className="recap-stat"><strong>{metricNumber(yesterdayActivity.activeCalories)}</strong><span>active kcal</span></div>
        <div className="recap-stat"><strong>{(yesterdayActivity.distanceMeters / 1000).toFixed(2)} km</strong><span>distance</span></div>
        <span className="recap-badge">{yesterdayHitGoal ? <><Check size={13} /> GOAL MET</> : 'IN PROGRESS'}</span>
      </section>

      <div className="activity-detail-grid">
        <section className="sf-card activity-calendar-card" aria-labelledby="step-history-title">
          <div className="sf-card-heading"><div><span className="sf-card-kicker">YOUR DAILY MOVEMENT</span><h2 id="step-history-title">Step history</h2></div><span className="activity-mini-icon"><CalendarDays /></span></div>
          <div className="calendar-toolbar"><button className="calendar-nav" type="button" aria-label="Previous month" onClick={() => changeMonth(-1)}><ChevronLeft /></button><strong>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong><button className="calendar-nav" type="button" aria-label="Next month" onClick={() => changeMonth(1)}><ChevronRight /></button></div>
          <div className="activity-calendar" role="grid" aria-label="Step history calendar">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, index) => <span className="calendar-weekday" role="columnheader" key={`${label}-${index}`}>{label}</span>)}
            {calendarDays.map((date) => {
              const count = stepsFor(date)
              const status = count >= profile.dailyStepGoal ? 'complete' : count > 0 ? 'partial' : 'empty'
              const inMonth = dateAtNoon(date).getMonth() === currentMonth
              return <button key={date} type="button" role="gridcell" aria-label={`${formatDate(date, { weekday: 'long', month: 'long', day: 'numeric' })}: ${metricNumber(count)} steps${count >= profile.dailyStepGoal ? ', goal met' : ''}`} aria-pressed={selectedDay === date} className={`calendar-day ${status} ${inMonth ? '' : 'outside-month'} ${date === today ? 'is-today' : ''}`} onClick={() => setSelectedDay(date)}><span>{dateAtNoon(date).getDate()}</span>{count > 0 && <i aria-hidden="true" />}</button>
            })}
          </div>
          <div className="calendar-legend"><span><i className="legend-complete" /> Goal met</span><span><i className="legend-partial" /> Steps logged</span><span><i className="legend-empty" /> No steps</span></div>
          <div className="selected-day-summary"><div><span className="sf-card-kicker">{formatDate(selectedDay, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}</span><strong>{metricNumber(selectedSteps)} <small>steps</small></strong></div><span className={`recap-badge ${selectedSteps >= profile.dailyStepGoal ? 'selected-met' : 'selected-progress'}`}>{selectedSteps >= profile.dailyStepGoal ? 'GOAL MET' : 'IN PROGRESS'}</span><p>{metricNumber(selectedActivity.activeCalories)} active kcal <i /> {(selectedActivity.distanceMeters / 1000).toFixed(2)} km</p></div>
        </section>

        <section className="sf-card weekly-goals-card" aria-labelledby="weekly-goals-title">
          <div className="sf-card-heading"><div><span className="sf-card-kicker">MONDAY–SUNDAY</span><h2 id="weekly-goals-title">Weekly goals</h2></div><span className="activity-mini-icon"><Activity /></span></div>
          <form className="weekly-goals-form" onSubmit={(event) => void saveGoals(event)}>
            <label>Steps per week<input name="weeklyStepGoal" type="number" min="10000" max="500000" step="1000" defaultValue={goals.weeklyStepGoal} /></label>
            <label>Active days<input name="weeklyActiveDaysGoal" type="number" min="1" max="7" defaultValue={goals.weeklyActiveDaysGoal} /></label>
            <label>Active calories (kcal)<input name="weeklyCalorieGoal" type="number" min="500" max="50000" step="100" defaultValue={goals.weeklyCalorieGoal} /></label>
            <button className="secondary-action" type="submit">Save weekly goals</button>
          </form>
          <GoalProgress label="Steps" value={weekSteps} goal={goals.weeklyStepGoal} suffix="steps" />
          <div className="weekly-pace-note">{stepsRemaining ? `${metricNumber(stepsRemaining)} steps left · about ${metricNumber(dailyPace)} per day across ${remainingDays} remaining day${remainingDays === 1 ? '' : 's'}` : 'Weekly step target reached.'}</div>
          <GoalProgress label="Active days" value={activeDays} goal={goals.weeklyActiveDaysGoal} suffix="days" />
          <GoalProgress label="Active calories" value={weekCalories} goal={goals.weeklyCalorieGoal} suffix="kcal" />
          <div className="streak-card"><span className="streak-flame"><Flame /></span><div><span className="sf-card-kicker">CURRENT DAILY STREAK</span><strong>{goalStreak} day{goalStreak === 1 ? '' : 's'}</strong><small>Consecutive days meeting your step goal</small></div><span className="streak-count">{goalStreak}</span></div>
        </section>
      </div>

      {showGuide && <div className="activity-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowGuide(false) }}><section className="activity-modal" data-activity-dialog role="dialog" aria-modal="true" aria-labelledby="activity-modal-title"><button className="activity-modal-close" type="button" aria-label="Close Apple Health setup" onClick={() => setShowGuide(false)}>×</button><span className="activity-modal-mark"><Apple /></span><span className="sf-card-kicker">FREE · BUILT INTO IPHONE</span><h2 id="activity-modal-title">Connect Apple Watch</h2><p>Apple Watch activity already appears in Apple Health. A personal Shortcut can send your daily totals to Stay Fit without a paid sync app.</p><ol className="shortcut-steps"><li><strong>Create a private token.</strong><span>Sign in online, then create a token below. It is shown once and cannot be recovered.</span></li><li><strong>Build a Shortcut.</strong><span>Add <b>Find Health Samples</b> for Step Count, Active Energy, Walking + Running Distance, Heart Rate, Resting Heart Rate, and Workouts. Sum each daily result.</span></li><li><strong>Send the totals.</strong><span>Add <b>Get Contents of URL</b>, use the sync URL below, set method to POST, and choose JSON request body.</span></li><li><strong>Authorize it.</strong><span>In request headers, add <code>Authorization</code> with value <code>Bearer YOUR_TOKEN</code>. Run it once and allow the Health access prompts.</span></li><li><strong>Automate daily.</strong><span>In Shortcuts → Automation, run the Shortcut at a time you choose. Apple may ask for confirmation depending on your iOS version.</span></li></ol><div className="shortcut-field"><span className="sf-card-kicker">SYNC URL</span><code>{(process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '')}/api/apple-watch/sync</code><button type="button" aria-label="Copy sync URL" onClick={() => void copyText(`${(process.env.NEXT_PUBLIC_API_URL || window.location.origin).replace(/\/$/, '')}/api/apple-watch/sync`, 'Sync URL copied.')}><Clipboard /></button></div><button className="primary-action token-button" type="button" disabled={busy || !canSyncOnline} onClick={() => void createSyncToken()}><ShieldCheck size={15} /> {syncToken ? 'Rotate sync token' : 'Create Shortcut token'}</button>{syncToken && <div className="shortcut-token"><span className="sf-card-kicker">COPY THIS NOW · ONLY SHOWN ONCE</span><code>{syncToken}</code><button type="button" onClick={() => void copyText(syncToken, 'Sync token copied. Add it to the Shortcut Authorization header.')}>Copy token</button></div>}{!canSyncOnline && <p className="token-requirement">Sign in to your online account to create a Shortcut token. Local step history still works offline.</p>}<div className="shortcut-payload"><span className="sf-card-kicker">JSON BODY SHAPE</span><pre>{`{\n  "day": "${today}",\n  "steps": 8420,\n  "activeCalories": 415,\n  "restingHeartRate": 58,\n  "averageHeartRate": 92,\n  "workoutMinutes": 34,\n  "distanceMeters": 6120\n}`}</pre></div></section></div>}
    </div>
  )
}

function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return <div className="activity-metric"><span className="activity-metric-icon">{icon}</span><span className="sf-card-kicker">{label}</span><strong>{value}</strong><small>{detail}</small></div>
}

function GoalProgress({ label, value, goal, suffix }: { label: string; value: number; goal: number; suffix: string }) {
  const percentage = goal > 0 ? Math.min((value / goal) * 100, 100) : 0
  return <div className="goal-progress"><div className="goal-progress-label"><span>{label}</span><strong>{metricNumber(value)} <small>/ {metricNumber(goal)} {suffix}</small></strong></div><div className="goal-progress-track" role="progressbar" aria-label={`${label} weekly goal`} aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.min(value, goal)}><span style={{ width: `${percentage}%` }} /></div></div>
}
