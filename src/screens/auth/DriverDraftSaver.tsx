import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Banner } from '@/components/ui/kit'
import { api, type DriverOnboardingDraft } from '@/services/api'
import { useApp } from '@/store/app'

/** Account-scoped server drafts survive reloads without trusting local role/approval flags. */
export function DriverDraftSaver() {
  const { state } = useApp()
  const { pathname } = useLocation()
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const step = Number(pathname.match(/^\/onboarding\/driver\/([1-4])$/)?.[1])
  const enabled = !!state.user && state.role === 'driver' && !state.onboarded && !!step
  const driver = state.driver
  const payload = JSON.stringify({ step, vehicle: driver.vehicle, commute: driver.commute, seatsOpen: driver.seatsOpen, monthlyContribution: driver.monthlyContribution })
  useEffect(() => {
    if (!enabled) return
    let active = true
    const timer = window.setTimeout(() => {
      void api.saveDriverOnboardingDraft(JSON.parse(payload) as DriverOnboardingDraft)
        .then(() => { if (active) setError(false) })
        .catch(() => { if (active) setError(true) })
    }, 650)
    return () => { active = false; window.clearTimeout(timer) }
  }, [enabled, payload, attempt, state.user?.id])
  if (!enabled || !error) return null
  return <Banner tone="warning" action={<button className="btn-text" onClick={() => setAttempt(n => n + 1)}>Retry saving</button>}>Setup progress could not be saved. Keep this page open and retry before leaving.</Banner>
}
