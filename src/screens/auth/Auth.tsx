import { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Logo } from '@/components/brand'
import { Icon } from '@/components/ui/Icon'
import { Banner, LiftyButton, ProgressStepper, Screen, ScreenBody, ScreenFooter, ScreenHeader, SecondaryButton, TextButton, TextField, useToast } from '@/components/ui/kit'
import type { Role } from '@/domain/types'
import { hasSupabase } from '@/lib/env'
import { clearNotice, peekNotice } from '@/lib/notice'
import { api, ApiError, getDataSource, isLive, setDataSource } from '@/services/api'
import { useApp } from '@/store/app'

/* ---------- 01 Welcome (photo carousel per design 01) ---------- */
const SLIDES = [
  { img: '/images/hero-commute.webp', title: ['Shared Journeys.', 'Brighter Tomorrow.'], body: 'Find trusted commuters already travelling your route — and commute together, every week.' },
  { img: '/images/slide-community.webp', title: ['Same Routes.', 'Real People.'], body: 'Verified drivers who already make your trip. Join their lift club with a fixed monthly contribution.' },
  { img: '/images/slide-city.webp', title: ['Know where your', 'lift is — always.'], body: 'Live tracking around pickup time, so nobody waits in the dark.' },
]

export function Welcome() {
  const nav = useNavigate()
  const { state } = useApp()
  const [i, setI] = useState(0)
  const startX = useRef<number | null>(null)
  useEffect(() => {
    if (state.lowData) return
    const t = setInterval(() => setI((x) => (x + 1) % SLIDES.length), 5000)
    return () => clearInterval(t)
  }, [state.lowData])
  const s = SLIDES[i]
  return (
    <Screen dark>
      <div
        className="hero"
        onTouchStart={(e) => (startX.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (startX.current == null) return
          const dx = e.changedTouches[0].clientX - startX.current
          if (Math.abs(dx) > 40) setI((x) => (x + (dx < 0 ? 1 : SLIDES.length - 1)) % SLIDES.length)
          startX.current = null
        }}
      >
        <div className="hero-art-wrap">
          {!state.lowData && SLIDES.map((sl, k) => <div key={sl.img} className={`welcome-slide ${k === i ? 'on' : ''}`} style={{ backgroundImage: `url(${sl.img})` }} role="img" aria-label={k === 0 ? 'A commuter car on the coastal highway near Umhlanga' : ''} />)}
          <div className="welcome-shade" />
          <div className="hero-logo"><Logo light /></div>
        </div>
        <div className="hero-content" aria-live="polite">
          <h1>
            {s.title[0]}
            <br />
            {s.title[1]}
          </h1>
          <p>{s.body}</p>
          <div className="dots" role="tablist" aria-label="Welcome slides">
            {SLIDES.map((sl, k) => (
              <button key={sl.img} role="tab" aria-selected={k === i} aria-label={`Slide ${k + 1}`} className={k === i ? 'on' : ''} onClick={() => setI(k)} />
            ))}
          </div>
        </div>
      </div>
      <ScreenFooter>
        <SessionNotice />
        <LiftyButton onClick={() => nav('/role')}>Get Started</LiftyButton>
        <TextButton style={{ color: '#fff' }} onClick={() => nav('/signin')}>
          I already have an account · Sign In
        </TextButton>
      </ScreenFooter>
    </Screen>
  )
}

/* ---------- 02 Role (only Passenger / Driver — there is no "both") ---------- */
export function ChooseRole() {
  const nav = useNavigate()
  const { state, update } = useApp()
  const [role, setRole] = useState<Role | null>(state.role)
  if(isLive()&&state.verified&&state.user) return <Navigate to={state.user.role==='driver'?'/d/home':'/p/home'} replace/>
  const options: { id: Role; title: string; body: string; img: string }[] = [
    { id: 'passenger', title: "I'm a Passenger", body: 'Find and join lift clubs for your regular commute.', img: '/images/role-passenger.webp' },
    { id: 'driver', title: "I'm a Driver", body: 'Offer spare seats along your existing commute.', img: '/images/role-driver.webp' },
  ]
  return (
    <Screen>
      <ScreenHeader title="" />
      <ScreenBody>
        <div className="center" style={{ marginBottom: 16 }}>
          <Logo />
        </div>
        <div className="title-block center">
          <h1>How would you like to join Lifty?</h1>
          <p>Choose your role. Each pilot account has one role.</p>
        </div>
        <div className="stack-3" role="radiogroup" aria-label="Choose your role">
          {options.map((o) => (
            <button key={o.id} type="button" role="radio" aria-checked={role === o.id} className={`role-card ${o.id} ${role === o.id ? 'on' : ''}`} onClick={() => setRole(o.id)}>
              {state.lowData ? <span className="role-ic"><Icon name={o.id === 'driver' ? 'car' : 'user'} size={30} /></span> : <img className="role-photo" src={o.img} alt="" />}
              <span className="grow">
                <strong className="h3" style={{ display: 'block' }}>{o.title}</strong>
                <span className="muted small">{o.body}</span>
              </span>
              <Icon name={role === o.id ? 'check' : 'chevron'} size={20} className="row-chev" />
            </button>
          ))}
        </div>
      </ScreenBody>
      <ScreenFooter>
        <LiftyButton
          disabled={!role}
          onClick={() => {
            update({ role })
            nav('/signup')
          }}
        >
          Continue
        </LiftyButton>
      </ScreenFooter>
    </Screen>
  )
}

/** Shown only when the live backend has phone sign-in switched off — keeps the user moving. */
function DemoFallback({ onDemo }: { onDemo: () => void }) {
  return (
    <Banner tone="warning" icon="info" action={<TextButton onClick={onDemo}>Use demo</TextButton>}>
      <strong>Phone sign-in isn’t switched on yet</strong>
      You can explore the full Lifty experience in demo mode meanwhile.
    </Banner>
  )
}

/** One-time explanation after the app had to sign the user out (e.g. an expired login), instead of a silent bounce to the welcome screen. */
function SessionNotice() {
  const [message] = useState(peekNotice)
  useEffect(() => { if (message) clearNotice() }, [message])
  if (!message) return null
  return <Banner tone="info" icon="info">{message}</Banner>
}

/**
 * Demo mode is a per-tab choice. Without a visible reminder, someone who tapped "Use demo" once keeps
 * "signing up" into a sandbox where nothing is saved and no real account is ever created.
 */
function DemoModeNotice() {
  const { reset } = useApp()
  if (!hasSupabase || getDataSource() !== 'demo') return null
  return (
    <Banner
      tone="warning"
      icon="info"
      action={<TextButton onClick={() => { setDataSource('live'); reset(); window.location.assign('/welcome') }}>Use real accounts</TextButton>}
    >
      <strong>Demo mode is on</strong>
      Nothing you enter is saved or sent. Switch to real accounts to sign up for real.
    </Banner>
  )
}

/** Error banner for the code-request screens; each failure gets the right wording and next step. */
function AuthError({ err, onDemo, onCreate }: { err: Error; onDemo: () => void; onCreate?: () => void }) {
  const code = err instanceof ApiError ? err.code : undefined
  if (code === 'not-configured') return <DemoFallback onDemo={onDemo} />
  if (code === 'no-account' && onCreate)
    return (
      <Banner tone="info" icon="info" action={<TextButton onClick={onCreate}>Create account</TextButton>}>
        <strong>No account for this number</strong>
        Create one first — it only takes a minute.
      </Banner>
    )
  return <Banner tone="error">{err.message}</Banner>
}

const digitsOf = (phone: string) => phone.replace(/\D/g, '').replace(/^27/, '').replace(/^0/, '')
const prettyPhone = (d: string) => `+27 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`

/* ---------- 03 Sign up ---------- */
export function SignUp() {
  const nav = useNavigate()
  const { state, update } = useApp()
  const [name, setName] = useState(state.user?.fullName ?? '')
  const [phone, setPhone] = useState(digitsOf(state.phone))
  const [agree, setAgree] = useState(false)
  const [loading, setLoading] = useState(false)
  const [touched, setTouched] = useState(false)
  const [err, setErr] = useState<ApiError | Error | null>(null)

  const digits = digitsOf(phone)
  const nameOk = name.trim().split(/\s+/).length >= 2
  const phoneOk = digits.length === 9
  const valid = nameOk && phoneOk && agree

  const keepUser = () => {
    const [first, ...rest] = name.trim().split(/\s+/)
    const last = rest[rest.length - 1] ?? ''
    update({
      phone: prettyPhone(digits),
      user: isLive()?null:{ id: 'demo-user', firstName: first, lastInitial: last.charAt(0).toUpperCase(), fullName: name.trim(), phone: `+27${digits}`, role: state.role ?? 'passenger', avatarHue: 160, memberSince: new Date().toISOString().slice(0, 10) },
    })
  }

  const submit = async () => {
    setTouched(true)
    if (!valid) return
    setLoading(true)
    setErr(null)
    try {
      await api.signUp({ fullName: name.trim(), phone: `+27${digits}`, role: state.role ?? 'passenger' })
      keepUser()
      nav('/otp')
    } catch (e) {
      setErr(e instanceof Error ? e : new Error('Could not send your code.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Screen>
      <ScreenHeader />
      <ScreenBody>
        <div className="center" style={{ marginBottom: 8 }}>
          <Logo size={34} />
        </div>
        <div className="title-block center">
          <h1>Create your account</h1>
          <p>Let’s get you started on Lifty as a {state.role ?? 'passenger'}.</p>
        </div>
        <SessionNotice />
        <DemoModeNotice />
        <form className="stack-4" onSubmit={(e) => { e.preventDefault(); void submit() }} noValidate>
          <TextField label="Full name" value={name} onChange={setName} autoComplete="name" placeholder="e.g. Ayesha Khan" valid={nameOk} error={touched && !nameOk ? 'Enter your first and last name.' : undefined} />
          <TextField label="Mobile number" value={phone} onChange={setPhone} inputMode="tel" autoComplete="tel-national" prefix="🇿🇦 +27" placeholder="82 123 4567" valid={phoneOk} error={touched && !phoneOk ? 'Enter a valid 9-digit South African number.' : undefined} hint="We’ll send a 6-digit code to verify it. Your number is never shown to other members." />
          <label className="row-flex" style={{ alignItems: 'flex-start', minHeight: 44 }}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ width: 22, height: 22, accentColor: 'var(--teal)', marginTop: 2 }} />
            <span className="small muted">
              I agree to Lifty’s <a href="/terms" target="_blank">Terms of Service</a> and <a href="/privacy" target="_blank">Privacy Policy</a>.
              {touched && !agree && <span className="field-error" role="alert"> Please accept to continue.</span>}
            </span>
          </label>
          {err && <AuthError err={err} onDemo={() => { setDataSource('demo'); keepUser(); nav('/otp') }} />}
        </form>
      </ScreenBody>
      <ScreenFooter>
        <LiftyButton loading={loading} onClick={submit}>Create Account</LiftyButton>
        <p className="center small muted">
          Already have an account? <button className="btn-text" style={{ minHeight: 32, padding: 0 }} onClick={() => nav('/signin')}>Sign In</button>
        </p>
      </ScreenFooter>
    </Screen>
  )
}

/* ---------- Sign in (existing account → OTP) ---------- */
export function SignIn() {
  const nav = useNavigate()
  const { state, update } = useApp()
  const [phone, setPhone] = useState(digitsOf(state.phone))
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<Error | null>(null)
  const digits = digitsOf(phone)
  const go = async () => {
    setLoading(true)
    setErr(null)
    try {
      await api.sendOtp(`+27${digits}`)
      update({ phone: prettyPhone(digits) })
      nav('/otp', { state: { signIn: true } })
    } catch (e) {
      setErr(e instanceof Error ? e : new Error('Could not send your code'))
    } finally {
      setLoading(false)
    }
  }
  return (
    <Screen>
      <ScreenHeader />
      <ScreenBody>
        <div className="center" style={{ marginBottom: 8 }}><Logo size={34} /></div>
        <div className="title-block center">
          <h1>Welcome back</h1>
          <p>We’ll send a code to your mobile number.</p>
        </div>
        <SessionNotice />
        <DemoModeNotice />
        <div className="stack-4">
          <TextField label="Mobile number" value={phone} onChange={setPhone} inputMode="tel" prefix="🇿🇦 +27" placeholder="82 123 4567" valid={digits.length === 9} />
          {err && <AuthError err={err} onCreate={() => nav('/role')} onDemo={() => { setDataSource('demo'); update({ phone: prettyPhone(digits) }); nav('/otp', { state: { signIn: true } }) }} />}
        </div>
      </ScreenBody>
      <ScreenFooter>
        <LiftyButton disabled={digits.length !== 9} loading={loading} onClick={go}>Send code</LiftyButton>
        <TextButton onClick={() => nav('/role')}>New to Lifty? Create an account</TextButton>
      </ScreenFooter>
    </Screen>
  )
}

/* ---------- 04 OTP ---------- */
export function Otp() {
  const nav = useNavigate()
  const loc = useLocation()
  const toast = useToast()
  const { state, update, refreshAccount } = useApp()
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [left, setLeft] = useState(30)
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const signIn = (loc.state as { signIn?: boolean } | null)?.signIn

  useEffect(() => {
    if (left <= 0) return
    const t = setTimeout(() => setLeft((l) => l - 1), 1000)
    return () => clearTimeout(t)
  }, [left])

  useEffect(() => {
    refs.current[0]?.focus()
  }, [])

  const setAt = (i: number, v: string) => {
    const clean = v.replace(/\D/g, '')
    if (clean.length > 1) {
      const next = clean.slice(0, 6).split('')
      setDigits([...next, ...Array(6 - next.length).fill('')])
      refs.current[Math.min(next.length, 5)]?.focus()
      return
    }
    const next = [...digits]
    next[i] = clean
    setDigits(next)
    setError(null)
    if (clean && i < 5) refs.current[i + 1]?.focus()
  }

  const code = digits.join('')
  const verify = async () => {
    setLoading(true)
    setError(null)
    try {
      const profile = await api.verifyOtp(state.phone, code)
      const role = profile?.user.role ?? state.role ?? 'passenger'
      const onboarded = profile?.onboarded ?? false
      if (profile) await refreshAccount()
      else update({verified:true,role,onboarded:false})
      nav(onboarded ? (role === 'driver' ? '/d/home' : '/p/home') : role === 'driver' ? '/onboarding/driver/1' : '/onboarding/passenger/1', { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not verify your code.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Screen>
      <ScreenHeader />
      <ScreenBody>
        <div className="center" style={{ marginBottom: 8 }}>
          <Logo size={34} />
        </div>
        <div className="title-block center">
          <h1>Verify your number</h1>
          <p>We sent a 6-digit code to <strong style={{ color: 'var(--text)' }}>{state.phone || 'your phone'}</strong></p>
          <button className="btn-text" onClick={() => nav(signIn ? '/signin' : '/signup')}>Change number</button>
        </div>
        <div className={`otp ${error ? 'error' : ''}`} role="group" aria-label="6-digit verification code">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => { refs.current[i] = el }}
              value={d}
              inputMode="numeric"
              autoComplete={i === 0 ? 'one-time-code' : 'off'}
              aria-label={`Digit ${i + 1}`}
              maxLength={6}
              onChange={(e) => setAt(i, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus() }}
            />
          ))}
        </div>
        {error && <p className="field-error center" role="alert" style={{ marginTop: 14 }}>{error}</p>}
        <p className="center small muted" style={{ marginTop: 20 }}>
          {left > 0 ? (
            <>Didn’t receive the code? Resend in {left}s</>
          ) : (
            <>
              Didn’t receive the code?{' '}
              <button
                className="btn-text"
                style={{ minHeight: 32, padding: 0 }}
                onClick={async () => {
                  try {
                    await api.sendOtp(state.phone)
                    setLeft(30)
                    toast('New code sent', 'success')
                  } catch (e) {
                    toast(e instanceof Error ? e.message : 'Could not resend', 'error')
                  }
                }}
              >
                Resend code
              </button>
            </>
          )}
        </p>
        {getDataSource() === 'demo' && <p className="center small muted" style={{ marginTop: 8 }}>Demo mode: any 6 digits work (000000 shows the error state).</p>}
      </ScreenBody>
      <ScreenFooter>
        <LiftyButton disabled={code.length !== 6} loading={loading} onClick={verify}>Continue</LiftyButton>
      </ScreenFooter>
    </Screen>
  )
}

/* ---------- shared onboarding chrome ---------- */
export function OnboardShell({ step, total, title, subtitle, onBack, children, cta, onNext, loading, disabled, secondary }: { step: number; total: number; title: string; subtitle: string; onBack?: () => void; children: React.ReactNode; cta: string; onNext: () => void; loading?: boolean; disabled?: boolean; secondary?: React.ReactNode }) {
  return (
    <Screen>
      <ScreenHeader onBack={onBack} title={`Step ${step} of ${total}`} />
      <ProgressStepper step={step} total={total} />
      <ScreenBody>
        <div className="title-block">
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {children}
      </ScreenBody>
      <ScreenFooter>
        <LiftyButton onClick={onNext} loading={loading} disabled={disabled}>{cta}</LiftyButton>
        {secondary}
      </ScreenFooter>
    </Screen>
  )
}

export { SecondaryButton }
