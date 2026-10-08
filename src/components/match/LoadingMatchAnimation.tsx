import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/Icon'

export const MATCH_STAGES = [
  'Analysing route',
  'Checking pickup distance',
  'Comparing driver routes',
  'Checking available seats',
  'Calculating deviation',
  'Comparing schedules',
  'Preparing best matches',
]

/**
 * Radar-style loading. `done` completes every stage; otherwise stages advance
 * on a timer purely for pacing (real progress is just "request in flight").
 */
export function LoadingMatchAnimation({ done, headline = 'Finding your lift clubs…', body = "We're comparing your commute with verified drivers already travelling similar routes." }: { done?: boolean; headline?: string; body?: string }) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (done) {
      setStep(MATCH_STAGES.length)
      return
    }
    const t = setInterval(() => setStep((s) => Math.min(s + 1, MATCH_STAGES.length - 1)), 520)
    return () => clearInterval(t)
  }, [done])

  return (
    <div className="finding">
      <div className="radar" aria-hidden>
        <span className="ring r1" />
        <span className="ring r2" />
        <span className="ring r3" />
        <svg className="radar-routes" viewBox="0 0 200 200">
          <path d="M20 150 C 60 120, 80 160, 110 110 S 160 70, 185 40" fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="2" strokeDasharray="2 6" strokeLinecap="round" />
          <path d="M30 60 C 70 70, 90 40, 120 80 S 170 130, 180 160" fill="none" stroke="rgba(0,179,134,.55)" strokeWidth="2" strokeLinecap="round" className="route-run" />
        </svg>
        <span className="dot d1" />
        <span className="dot d2" />
        <span className="dot d3" />
        <span className="radar-core">
          <Icon name="car" size={34} />
        </span>
      </div>

      <h1>{headline}</h1>
      <p className="finding-body">{body}</p>

      <ul className="stages" aria-label="Matching progress">
        {MATCH_STAGES.map((s, i) => {
          const state = i < step ? 'done' : i === step ? 'active' : 'todo'
          return (
            <li key={s} className={state}>
              <span className="st-mark">{state === 'done' ? <Icon name="check" size={14} strokeWidth={3} /> : state === 'active' ? <span className="spinner tiny" /> : null}</span>
              {s}
              <span className="sr-only">{state === 'done' ? ' complete' : state === 'active' ? ' in progress' : ''}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
