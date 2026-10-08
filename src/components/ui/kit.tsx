import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { WEEKDAYS, type Weekday } from '@/domain/types'
import { initials } from '@/lib/format'
import { Icon, type IconName } from './Icon'

/* ============ Buttons ============ */

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean
  icon?: IconName
  block?: boolean
  size?: 'md' | 'sm'
}

export const LiftyButton = forwardRef<HTMLButtonElement, BtnProps>(function LiftyButton(
  { loading, icon, block = true, size = 'md', children, disabled, className = '', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`btn btn-primary ${size === 'sm' ? 'btn-sm' : ''} ${block ? 'btn-block' : ''} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden /> : icon ? <Icon name={icon} size={20} /> : null}
      <span>{children}</span>
    </button>
  )
})

export const SecondaryButton = forwardRef<HTMLButtonElement, BtnProps & { tone?: 'default' | 'danger' }>(
  function SecondaryButton({ loading, icon, block = true, size = 'md', tone = 'default', children, disabled, className = '', ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={`btn btn-secondary ${tone === 'danger' ? 'btn-danger' : ''} ${size === 'sm' ? 'btn-sm' : ''} ${block ? 'btn-block' : ''} ${className}`}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...rest}
      >
        {loading ? <span className="spinner dark" aria-hidden /> : icon ? <Icon name={icon} size={20} /> : null}
        <span>{children}</span>
      </button>
    )
  },
)

export function TextButton({ children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`btn-text ${className}`} {...rest}>
      {children}
    </button>
  )
}

export function IconButton({ icon, label, ...rest }: { icon: IconName; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className="icon-btn" aria-label={label} {...rest}>
      <Icon name={icon} size={22} />
    </button>
  )
}

/* ============ Layout ============ */

export function Screen({ children, className = '', dark = false }: { children: ReactNode; className?: string; dark?: boolean }) {
  return <div className={`screen ${dark ? 'screen-dark' : ''} ${className}`}>{children}</div>
}

export function ScreenBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <main className={`screen-body ${className}`}>{children}</main>
}

/** Sticky footer that always clears the safe area / home indicator. */
export function ScreenFooter({ children }: { children: ReactNode }) {
  return <footer className="screen-footer">{children}</footer>
}

export function ScreenHeader({
  title,
  subtitle,
  onBack,
  back = true,
  right,
  transparent,
}: {
  title?: string
  subtitle?: string
  onBack?: () => void
  back?: boolean
  right?: ReactNode
  transparent?: boolean
}) {
  const nav = useNavigate()
  return (
    <header className={`screen-header ${transparent ? 'transparent' : ''}`}>
      {back ? (
        <IconButton icon="back" label="Go back" onClick={onBack ?? (() => nav(-1))} />
      ) : (
        <span className="icon-btn-spacer" />
      )}
      <div className="screen-header-title">
        {title && <h1>{title}</h1>}
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="screen-header-right">{right ?? <span className="icon-btn-spacer" />}</div>
    </header>
  )
}

export function ProgressStepper({ step, total, label }: { step: number; total: number; label?: string }) {
  return (
    <div className="stepper" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={step} aria-label={label ?? `Step ${step} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < step ? 'on' : ''} />
      ))}
    </div>
  )
}

/* ============ Navigation ============ */

export interface NavItem {
  to: string
  label: string
  icon: IconName
  badge?: number
}

export function BottomNavigation({ items }: { items: NavItem[] }) {
  return (
    <nav className="bottom-nav" aria-label="Main">
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
          <span className="bn-icon">
            <Icon name={it.icon} size={24} />
            {it.badge ? <span className="bn-badge" aria-label={`${it.badge} new`}>{it.badge}</span> : null}
          </span>
          <span className="bn-label">{it.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

/* ============ Cards, badges, avatars ============ */

export function Card({ children, className = '', onClick, as = 'div', ...rest }: { children: ReactNode; className?: string; onClick?: () => void; as?: 'div' | 'section' | 'button' } & Record<string, unknown>) {
  const Tag = as as 'div'
  return (
    <Tag className={`card ${onClick ? 'card-press' : ''} ${className}`} onClick={onClick} {...(onClick && as === 'button' ? { type: 'button' } : {})} {...rest}>
      {children}
    </Tag>
  )
}

export function Avatar({ first, last = '', hue, size = 48, src }: { first: string; last?: string; hue: number; size?: number; src?: string }) {
  if (src) return <img className="avatar" src={src} alt="" width={size} height={size} style={{ width: size, height: size, objectFit: 'cover' }} />
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(145deg, hsl(${hue} 55% 52%), hsl(${(hue + 30) % 360} 60% 38%))` }}
      aria-hidden
    >
      {initials(first, last)}
    </span>
  )
}

type Tone = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'teal'

export function StatusBadge({ tone = 'neutral', icon, children }: { tone?: Tone; icon?: IconName; children: ReactNode }) {
  return (
    <span className={`badge badge-${tone}`}>
      {icon && <Icon name={icon} size={14} strokeWidth={2.4} />}
      {children}
    </span>
  )
}

export function VerificationBadge({ label = 'Verified Driver', status = 'verified' }: { label?: string; status?: 'verified' | 'pending' | 'unverified' }) {
  if (status === 'verified') return <StatusBadge tone="success" icon="shieldCheck">{label}</StatusBadge>
  if (status === 'pending') return <StatusBadge tone="warning" icon="clock">{label.replace('Verified', 'Pending')}</StatusBadge>
  return <StatusBadge tone="neutral" icon="info">Not verified</StatusBadge>
}

export function Rating({ value, count, size = 'md' }: { value: number; count?: number; size?: 'sm' | 'md' }) {
  return (
    <span className={`rating rating-${size}`} aria-label={`Rated ${value} out of 5${count != null ? ` from ${count} ratings` : ''}`}>
      <Icon name="star" size={size === 'sm' ? 13 : 16} filled />
      <strong>{value.toFixed(1)}</strong>
      {count != null && <span className="muted">({count})</span>}
    </span>
  )
}

export function StarInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="stars" role="radiogroup" aria-label="Star rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} className={n <= value ? 'on' : ''} onClick={() => onChange(n)}>
          <Icon name="star" size={40} filled={n <= value} />
        </button>
      ))}
    </div>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'teal' | 'amber' | 'blue' }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  )
}

export function ProfileRow({ icon, title, subtitle, onClick, right, danger }: { icon?: IconName; title: string; subtitle?: string; onClick?: () => void; right?: ReactNode; danger?: boolean }) {
  const inner = (
    <>
      {icon && (
        <span className={`row-icon ${danger ? 'danger' : ''}`}>
          <Icon name={icon} size={20} />
        </span>
      )}
      <span className="row-text">
        <span className="row-title">{title}</span>
        {subtitle && <span className="row-sub">{subtitle}</span>}
      </span>
      {right ?? (onClick ? <Icon name="chevron" size={18} className="row-chev" /> : null)}
    </>
  )
  return onClick ? (
    <button type="button" className="row" onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className="row">{inner}</div>
  )
}
export const SettingsRow = ProfileRow

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="section-title">
      <h2>{children}</h2>
      {action}
    </div>
  )
}

/* ============ Form ============ */

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'prefix'> {
  label: string
  value: string
  onChange: (v: string) => void
  error?: string
  hint?: string
  valid?: boolean
  icon?: IconName
  prefix?: ReactNode
}

export function TextField({ label, value, onChange, error, hint, valid, icon, prefix, disabled, ...rest }: FieldProps) {
  const id = useId()
  return (
    <div className={`field ${error ? 'is-error' : ''} ${valid && !error ? 'is-valid' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="field-box">
        {icon && <Icon name={icon} size={20} className="field-icon" />}
        {prefix && <span className="field-prefix">{prefix}</span>}
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-invalid={!!error} aria-describedby={error || hint ? `${id}-d` : undefined} {...rest} />
        {valid && !error && <Icon name="check" size={18} className="field-ok" />}
      </div>
      {(error || hint) && (
        <p id={`${id}-d`} className={error ? 'field-error' : 'field-hint'} role={error ? 'alert' : undefined}>
          {error ?? hint}
        </p>
      )}
    </div>
  )
}

export function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="field-box">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

export function DayPicker({ value, onChange }: { value: Weekday[]; onChange: (d: Weekday[]) => void }) {
  return (
    <div className="days" role="group" aria-label="Commute days">
      {WEEKDAYS.map((d, i) => {
        const on = value.includes(i as Weekday)
        return (
          <button
            key={d}
            type="button"
            className={`day ${on ? 'on' : ''}`}
            aria-pressed={on}
            aria-label={d}
            onClick={() => onChange(on ? value.filter((x) => x !== i) : [...value, i as Weekday].sort())}
          >
            {d.charAt(0)}
            <span className="sr-only">{d}</span>
          </button>
        )
      })}
    </div>
  )
}

export function Segmented<T extends string | number>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  )
}

/* ============ Feedback ============ */

export function Skeleton({ h = 16, w = '100%', r = 10 }: { h?: number; w?: number | string; r?: number }) {
  return <span className="skeleton" style={{ height: h, width: w, borderRadius: r }} aria-hidden />
}

export function CardSkeleton() {
  return (
    <div className="card" aria-busy aria-label="Loading">
      <div className="row-flex">
        <Skeleton h={48} w={48} r={24} />
        <div className="grow stack-2">
          <Skeleton h={16} w="50%" />
          <Skeleton h={12} w="70%" />
        </div>
      </div>
      <div className="row-flex" style={{ marginTop: 16 }}>
        <Skeleton h={56} />
        <Skeleton h={56} />
        <Skeleton h={56} />
      </div>
    </div>
  )
}

export function EmptyState({ icon = 'route', title, body, action, secondary }: { icon?: IconName; title: string; body: string; action?: ReactNode; secondary?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={30} />
      </span>
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
      {secondary}
    </div>
  )
}

export function ErrorState({ title = 'Something went wrong', message, onRetry, offline }: { title?: string; message: string; onRetry?: () => void; offline?: boolean }) {
  return (
    <div className="empty" role="alert">
      <span className={`empty-icon ${offline ? 'amber' : 'red'}`}>
        <Icon name={offline ? 'wifiOff' : 'alert'} size={30} />
      </span>
      <h2>{offline ? "You're offline" : title}</h2>
      <p>{message}</p>
      {onRetry && (
        <SecondaryButton block={false} icon="refresh" onClick={onRetry}>
          Try again
        </SecondaryButton>
      )}
    </div>
  )
}

export function Banner({ tone = 'info', icon, children, action }: { tone?: 'info' | 'warning' | 'error' | 'success'; icon?: IconName; children: ReactNode; action?: ReactNode }) {
  const defaults: Record<string, IconName> = { info: 'info', warning: 'alert', error: 'alert', success: 'check' }
  return (
    <div className={`banner banner-${tone}`} role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}>
      <Icon name={icon ?? defaults[tone]} size={20} />
      <div className="banner-text">{children}</div>
      {action}
    </div>
  )
}

/* ============ Toast ============ */

interface ToastItem {
  id: number
  message: string
  tone: 'success' | 'error' | 'info'
}
const ToastCtx = createContext<(message: string, tone?: ToastItem['tone']) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((message: string, tone: ToastItem['tone'] = 'info') => {
    const id = Date.now() + Math.random()
    setItems((i) => [...i.slice(-1), { id, message, tone }]) // at most two on screen
    setTimeout(() => setItems((i) => i.filter((x) => x.id !== id)), 3600)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <Icon name={t.tone === 'success' ? 'check' : t.tone === 'error' ? 'alert' : 'info'} size={18} />
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/* ============ Modal / BottomSheet ============ */

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
}

export function BottomSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  useEscape(open, onClose)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open) ref.current?.focus()
  }, [open])
  if (!open) return null
  return (
    <div className="overlay" onClick={onClose}>
      <div ref={ref} tabIndex={-1} className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <span className="sheet-grab" aria-hidden />
        {title && <h2 className="sheet-title">{title}</h2>}
        {children}
      </div>
    </div>
  )
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEscape(open, onClose)
  if (!open) return null
  return (
    <div className="overlay center" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

/* ============ Utility ============ */

export function Divider() {
  return <hr className="divider" />
}

export function Timeline({ steps }: { steps: { label: string; sub?: string; state: 'done' | 'active' | 'todo' }[] }) {
  return (
    <ol className="timeline">
      {steps.map((s) => (
        <li key={s.label} className={s.state}>
          <span className="tl-dot">{s.state === 'done' ? <Icon name="check" size={14} strokeWidth={3} /> : null}</span>
          <span>
            <strong>{s.label}</strong>
            {s.sub && <small>{s.sub}</small>}
            <span className="sr-only">{s.state === 'done' ? ' (done)' : s.state === 'active' ? ' (in progress)' : ' (waiting)'}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}
