import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Banner } from '@/components/ui/kit'
import { api, type DriverOnboardingDraft } from '@/services/api'
import { useApp } from '@/store/app'

/** Explicit Continue saves take priority over a pending debounce from the previous step. */
export function suspendDriverDraftAutosave(suspended: boolean) {
  window.dispatchEvent(new CustomEvent('lifty:driver-draft-transition', { detail: suspended }))
}

/** Account-scoped server drafts survive reloads without trusting local role/approval flags. */
export function DriverDraftSaver() {
  const { state } = useApp()
  const { pathname } = useLocation()
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const suspended = useRef(false)
  const pendingTimer = useRef<number>()
  useEffect(() => {
    const transition = (event: Event) => {
      suspended.current = (event as CustomEvent<boolean>).detail
      window.clearTimeout(pendingTimer.current)
      if (!suspended.current) setAttempt(n => n + 1)
    }
    window.addEventListener('lifty:driver-draft-transition', transition)
    return () => window.removeEventListener('lifty:driver-draft-transition', transition)
  }, [])
  const step = Number(pathname.match(/^\/onboarding\/driver\/([1-4])$/)?.[1])
  const enabled = !!state.user && state.role === 'driver' && !state.onboarded && !!step
  const driver = state.driver
  const payload = JSON.stringify({ step, vehicle: driver.vehicle, commute: driver.commute, seatsOpen: driver.seatsOpen, monthlyContribution: driver.monthlyContribution })
  useEffect(() => {
    if (!enabled || suspended.current) return
    let active = true
    const timer = window.setTimeout(() => {
      if (suspended.current) return
      void api.saveDriverOnboardingDraft(JSON.parse(payload) as DriverOnboardingDraft)
        .then(() => { if (active) setError(false) })
        .catch(() => { if (active) setError(true) })
    }, 650)
    pendingTimer.current = timer
    return () => { active = false; window.clearTimeout(timer) }
  }, [enabled, payload, attempt, state.user?.id])
  if (!enabled || !error) return null
  return <Banner tone="warning" action={<button className="btn-text" onClick={() => setAttempt(n => n + 1)}>Retry saving</button>}>Setup progress could not be saved. Keep this page open and retry before leaving.</Banner>
}
