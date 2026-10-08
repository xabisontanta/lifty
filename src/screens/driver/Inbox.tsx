import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CardSkeleton, ErrorState, ProfileRow, ScreenBody, SectionTitle } from '@/components/ui/kit'
import { timeAgo } from '@/lib/format'
import { useAsync } from '@/hooks/useAsync'
import { useDriverLegs } from '@/hooks/useClubs'
import { api, type AppNotification } from '@/services/api'

export function DriverInbox() {
  const nav = useNavigate()
  const { legs } = useDriverLegs()
  const { data, loading, error, retry } = useAsync(() => api.listNotifications(), [])
  const [items, setItems] = useState<AppNotification[]>([])
  useEffect(() => {
    if (data) setItems(data)
    if (data?.some((n) => !n.read)) void api.markNotificationsRead()
  }, [data])
  useEffect(() => api.subscribeNotifications((n) => setItems((x) => [n, ...x])), [])
  const clubs = legs.filter((l) => l.members.length > 0)
  return (
    <ScreenBody>
      <div className="title-block"><h1>Messages</h1><p>Your lift club chat, requests and updates.</p></div>
      {clubs.length > 0 && (
        <>
          <SectionTitle>Lift club chat</SectionTitle>
          <div className="list">
            {clubs.map((l) => (
              <ProfileRow key={l.legId} icon="message" title={`${l.direction === 'to_home' ? 'Evening' : 'Morning'} lift club`} subtitle={l.members.map((m) => m.firstName).join(', ')} onClick={() => nav(`/chat/${l.legId}`, { state: { name: `${l.direction === 'to_home' ? 'Evening' : 'Morning'} lift club` } })} />
            ))}
          </div>
        </>
      )}
      <SectionTitle>Updates</SectionTitle>
      {loading ? <CardSkeleton /> : error ? <ErrorState message={error.message} onRetry={retry} /> : items.length === 0 ? (
        <p className="muted small">No updates yet. New passenger requests appear here.</p>
      ) : (
        <div className="list">
          {items.map((n) => (
            <ProfileRow key={n.id} icon={n.kind === 'request' ? 'users' : 'bell'} title={n.title} subtitle={n.body} onClick={n.link ? () => nav(n.link!) : undefined} right={<span className="row-flex" style={{ gap: 6 }}>{!n.read && <i className="notif-dot" aria-label="unread" />}<span className="small muted">{timeAgo(n.createdAt)}</span></span>} />
          ))}
        </div>
      )}
    </ScreenBody>
  )
}
