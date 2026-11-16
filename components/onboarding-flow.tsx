'use client'

import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Check, Dumbbell, Salad, Sparkles, UserRound } from 'lucide-react'
import { createLocalAccount, type Profile } from '@/lib/local-store'
import { establishOnlineAccount } from '@/lib/api-client'

type Goal = 'lose_weight' | 'stay_fit' | 'build_muscle' | 'prioritize_nutrition'
type ProfileDraft = {
  displayName: string
  gender: string
  customGender: string
  birthDate: string
  weightKg: string
  heightCm: string
  fitnessGoal: Goal
  bodyGoal: 'bulk' | 'cut' | null
  muscleFocus: Array<'upper_body' | 'lower_body'>
  dietaryPreferences: string[]
  username: string
  email: string
  password: string
  consent: boolean
}

const initial: ProfileDraft = {
  displayName: '', gender: 'prefer_not_to_say', customGender: '', birthDate: '', weightKg: '', heightCm: '',
  fitnessGoal: 'stay_fit', bodyGoal: null, muscleFocus: [], dietaryPreferences: [], username: '', email: '', password: '', consent: false,
}
const goalChoices: Array<{ value: Goal; title: string; detail: string; icon: typeof Sparkles }> = [
  { value: 'lose_weight', title: 'Lose weight', detail: 'Build steady, sustainable habits.', icon: Sparkles },
  { value: 'stay_fit', title: 'Stay fit', detail: 'Feel good and keep moving.', icon: UserRound },
  { value: 'build_muscle', title: 'Build muscle', detail: 'Make strength part of your routine.', icon: Dumbbell },
  { value: 'prioritize_nutrition', title: 'Prioritize food', detail: 'Make meals work for your goals.', icon: Salad },
]
const dietaryOptions = ['Vegetarian', 'Vegan', 'Gluten-free', 'Dairy-free', 'Halal', 'Kosher']

export function OnboardingFlow() {
  const router = useRouter()
  const [draft, setDraft] = useState<ProfileDraft>(initial)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const steps = useMemo(() => [
    { title: 'What should we call you?', hint: 'A name makes your daily check-in feel a little more personal.' },
    { title: 'A little about you.', hint: 'This helps us keep your recommendations relevant.' },
    { title: 'When is your birthday?', hint: 'We use your age to keep suggestions more appropriate.' },
    { title: 'What is your current weight?', hint: 'This stays private and can be updated any time.' },
    { title: 'How tall are you?', hint: 'Used only to personalize general fitness guidance.' },
    { title: 'What are you working toward?', hint: 'Your plan can always change as you do.' },
    ...(draft.fitnessGoal === 'build_muscle' ? [
      { title: 'Bulk or cut?', hint: 'Choose the direction that best fits your current training focus.' },
      { title: 'Which area do you want to work on?', hint: 'Pick one or both. Your workouts will adapt.' },
    ] : []),
    { title: 'Any food preferences?', hint: 'Select anything you want your meal ideas to consider.' },
    { title: 'Make it yours.', hint: 'Your profile is saved on this device first, then synced when you are online.' }
  ], [draft.fitnessGoal])

  const update = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const index = (key: string) => steps.findIndex((item) => item.title === key)
  const muscleGoal = draft.fitnessGoal === 'build_muscle'
  const goalStep = index('What are you working toward?')
  const bulkStep = index('Bulk or cut?')
  const focusStep = index('Which area do you want to work on?')
  const foodStep = index('Any food preferences?')
  const accountStep = index('Make it yours.')
  const progress = Math.round(((step + 1) / steps.length) * 100)

  function validateStep() {
    if (step === 0 && !draft.displayName.trim()) return 'Add the name you would like us to use.'
    if (step === 1 && draft.gender === 'custom' && !draft.customGender.trim()) return 'Tell us how you would like to describe yourself.'
    if (step === 2 && !draft.birthDate) return 'Choose your date of birth.'
    if (step === 3 && (!Number.isFinite(Number(draft.weightKg)) || Number(draft.weightKg) < 25 || Number(draft.weightKg) > 400)) return 'Enter a weight between 25 and 400 kg.'
    if (step === 4 && (!Number.isFinite(Number(draft.heightCm)) || Number(draft.heightCm) < 100 || Number(draft.heightCm) > 250)) return 'Enter a height between 100 and 250 cm.'
    if (step === bulkStep && !draft.bodyGoal) return 'Choose bulk or cut to continue.'
    if (step === focusStep && draft.muscleFocus.length === 0) return 'Choose at least one focus area.'
    if (step === accountStep) {
      if (!/^[a-zA-Z0-9_]{3,24}$/.test(draft.username)) return 'Your username needs 3–24 letters, numbers, or underscores.'
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email)) return 'Enter a valid email address to use as your on-device sign-in.'
      if (draft.password.length < 8) return 'Choose a password with at least 8 characters.'
      if (!draft.consent) return 'Please agree to save your profile and activity on this device.'
    }
    return ''
  }

  function next() {
    const validation = validateStep()
    if (validation) return setError(validation)
    setError('')
    setStep((current) => Math.min(current + 1, steps.length - 1))
  }

  function toggleFocus(value: 'upper_body' | 'lower_body') {
    update('muscleFocus', draft.muscleFocus.includes(value) ? draft.muscleFocus.filter((item) => item !== value) : [...draft.muscleFocus, value])
  }

  function toggleDiet(value: string) {
    update('dietaryPreferences', draft.dietaryPreferences.includes(value) ? draft.dietaryPreferences.filter((item) => item !== value) : [...draft.dietaryPreferences, value])
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validation = validateStep()
    if (validation) return setError(validation)
    setBusy(true)
    setError('')
    try {
      const profile: Profile = {
        username: draft.username.trim().toLowerCase(),
        displayName: draft.displayName.trim(),
        gender: draft.gender === 'custom' ? draft.customGender.trim() : draft.gender,
        birthDate: draft.birthDate,
        weightKg: Number(draft.weightKg),
        heightCm: Number(draft.heightCm),
        fitnessGoal: draft.fitnessGoal,
        bodyGoal: muscleGoal ? draft.bodyGoal : null,
        muscleFocus: muscleGoal ? draft.muscleFocus : [],
        dietaryPreferences: draft.dietaryPreferences,
        dailyStepGoal: 8000,
        leaderboardOptIn: false,
      }
      await createLocalAccount({ email: draft.email, password: draft.password, profile })
      if (navigator.onLine) {
        try {
          await establishOnlineAccount({ email: draft.email, username: draft.username, password: draft.password, profile })
        } catch {
          // The local account stays usable when the backend is not reachable.
        }
      }
      router.replace('/')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not finish setting up your local account. Check your details and try again.')
    } finally {
      setBusy(false)
    }
  }

  const content: ReactNode = step === 0 ? (
    <label className="onboarding-field">Your name<input autoFocus autoComplete="name" maxLength={48} value={draft.displayName} onChange={(event) => update('displayName', event.target.value)} placeholder="e.g. Jordan" /></label>
  ) : step === 1 ? (
    <div className="choice-stack" role="group" aria-label="Gender">
      {['male', 'female', 'prefer_not_to_say', 'custom'].map((value) => <button key={value} type="button" className={`choice-row ${draft.gender === value ? 'selected' : ''}`} onClick={() => update('gender', value)}><span>{value === 'prefer_not_to_say' ? 'Prefer not to say' : value[0].toUpperCase() + value.slice(1).replaceAll('_', ' ')}</span><i>{draft.gender === value && <Check size={14} />}</i></button>)}
      {draft.gender === 'custom' && <label className="onboarding-field">How would you describe yourself?<input value={draft.customGender} maxLength={40} onChange={(event) => update('customGender', event.target.value)} /></label>}
    </div>
  ) : step === 2 ? (
    <label className="onboarding-field">Date of birth<input type="date" max={new Date().toISOString().slice(0, 10)} value={draft.birthDate} onChange={(event) => update('birthDate', event.target.value)} /></label>
  ) : step === 3 ? (
    <label className="onboarding-field">Weight in kilograms<div className="input-with-unit"><input type="number" min="25" max="400" step="0.1" value={draft.weightKg} onChange={(event) => update('weightKg', event.target.value)} placeholder="68" /><span>kg</span></div></label>
  ) : step === 4 ? (
    <label className="onboarding-field">Height in centimeters<div className="input-with-unit"><input type="number" min="100" max="250" step="0.1" value={draft.heightCm} onChange={(event) => update('heightCm', event.target.value)} placeholder="170" /><span>cm</span></div></label>
  ) : step === goalStep ? (
    <div className="goal-grid" role="group" aria-label="Fitness goal">{goalChoices.map(({ value, title, detail, icon: Icon }) => <button key={value} className={`goal-choice ${draft.fitnessGoal === value ? 'selected' : ''}`} type="button" onClick={() => { update('fitnessGoal', value); update('bodyGoal', null); update('muscleFocus', []) }}><Icon size={18} /><strong>{title}</strong><span>{detail}</span></button>)}</div>
  ) : step === bulkStep ? (
    <div className="goal-grid two" role="group" aria-label="Muscle goal">{(['bulk', 'cut'] as const).map((value) => <button key={value} className={`goal-choice ${draft.bodyGoal === value ? 'selected' : ''}`} type="button" onClick={() => update('bodyGoal', value)}><Dumbbell size={18} /><strong>{value === 'bulk' ? 'Build / bulk' : 'Cut / define'}</strong><span>{value === 'bulk' ? 'Focus on progressive strength.' : 'Focus on a leaner training phase.'}</span></button>)}</div>
  ) : step === focusStep ? (
    <div className="goal-grid two" role="group" aria-label="Muscle focus">{(['upper_body', 'lower_body'] as const).map((value) => <button key={value} className={`goal-choice ${draft.muscleFocus.includes(value) ? 'selected' : ''}`} type="button" onClick={() => toggleFocus(value)}><Dumbbell size={18} /><strong>{value === 'upper_body' ? 'Upper body' : 'Lower body'}</strong><span>{draft.muscleFocus.includes(value) ? 'Selected' : 'Tap to include this focus'}</span></button>)}</div>
  ) : step === foodStep ? (
    <div className="tag-grid" role="group" aria-label="Food preferences">{dietaryOptions.map((value) => <button key={value} className={`preference-tag ${draft.dietaryPreferences.includes(value) ? 'selected' : ''}`} type="button" onClick={() => toggleDiet(value)}>{draft.dietaryPreferences.includes(value) && <Check size={13} />}{value}</button>)}</div>
  ) : (
    <div className="onboarding-account-fields">
      <label className="onboarding-field">Username<input autoComplete="username" minLength={3} maxLength={24} value={draft.username} onChange={(event) => update('username', event.target.value)} placeholder="jordan_moves" /><span className="field-help">Friends will find you by this name.</span></label>
      <label className="onboarding-field">Email for account sign-in<input type="email" autoComplete="email" value={draft.email} onChange={(event) => update('email', event.target.value)} placeholder="you@example.com" /><span className="field-help">Saved on this device first; online account setup is attempted when connected.</span></label>
      <label className="onboarding-field">Password<input type="password" autoComplete="new-password" minLength={8} value={draft.password} onChange={(event) => update('password', event.target.value)} placeholder="At least 8 characters" /></label>
      <label className="consent-row"><input type="checkbox" checked={draft.consent} onChange={(event) => update('consent', event.target.checked)} /><span>I agree to store my profile and activity on this device first. When I sign in online, pending records may also sync to my Stay Fit account.</span></label>
    </div>
  )

  return (
    <main className="onboarding-page">
      <header className="onboarding-top"><Link className="sf-brand auth-brand" href="/auth"><span className="sf-mark">S</span><span>STAY FIT<span className="sf-brand-dot">.</span></span></Link><Link href="/auth" className="onboarding-login">Already have an account? <strong>Log in</strong></Link></header>
      <section className="onboarding-card" aria-labelledby="onboarding-title">
        <div className="onboarding-progress-meta"><span>YOUR STARTING POINT</span><strong>{step + 1} / {steps.length}</strong></div>
        <div className="onboarding-progress"><span style={{ width: `${progress}%` }} /></div>
        <div className="onboarding-question"><span className="onboarding-step-icon">{step === accountStep ? <LockKeyholeIcon /> : step === goalStep ? <Sparkles size={19} /> : <UserRound size={19} />}</span><h1 id="onboarding-title">{steps[step]?.title}</h1><p>{steps[step]?.hint}</p></div>
        <form onSubmit={step === accountStep ? submit : (event) => { event.preventDefault(); next() }}>
          {content}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="onboarding-actions">
            {step > 0 ? <button type="button" className="secondary-action" onClick={() => { setError(''); setStep((current) => Math.max(current - 1, 0)) }}><ArrowLeft size={15} /> Back</button> : <span />}
            {step === accountStep ? <button className="primary-action" disabled={busy} type="submit">{busy ? 'Setting up your plan…' : 'Create my account'} <ArrowRight size={16} /></button> : <button className="primary-action" type="submit">Continue <ArrowRight size={16} /></button>}
          </div>
        </form>
        <p className="onboarding-privacy">Your personal measurements stay private. Share only what you choose.</p>
      </section>
    </main>
  )
}

function LockKeyholeIcon() {
  return <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><circle cx="12" cy="15" r="1" /><path d="M12 16v2" /></svg>
}
