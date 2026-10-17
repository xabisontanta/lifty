import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CardSkeleton, ErrorState, ProfileRow, ScreenBody, SectionTitle } from '@/components/ui/kit'
import { timeAgo } from '@/lib/format'
import { useAsync } from '@/hooks/useAsync'
import { ClubChats } from '@/components/chat/ClubChats'
import { api, type AppNotification } from '@/services/api'
import { notificationDestination } from '@/services/notificationRoutes'
import {useApp} from '@/store/app'

export function DriverInbox() {
  const nav = useNavigate()
  const {state}=useApp()
  const { data, loading, error, retry } = useAsync(() => api.listNotifications(), [state.user?.id])
  const [items, setItems] = useState<AppNotification[]>([])
  const [readError,setReadError]=useState('')
  useEffect(() => {
    if (data) setItems(data)
    if (data?.some((n) => !n.read)) void api.markNotificationsRead().then(()=>setReadError('')).catch(()=>setReadError('Could not mark updates as read. They will remain in your inbox.'))
  }, [data])
  useEffect(() => {
    setItems([])
    const refresh=()=>{if(document.visibilityState!=='hidden')retry()}
    const stop=api.subscribeNotifications(n=>{setItems(current=>[n,...current.filter(item=>item.id!==n.id)]);refresh()})
    window.addEventListener('focus',refresh);window.addEventListener('online',refresh);document.addEventListener('visibilitychange',refresh)
    const timer=window.setInterval(refresh,30_000)
    return ()=>{stop();window.clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);document.removeEventListener('visibilitychange',refresh)}
  }, [state.user?.id,retry])
  return (
    <ScreenBody>
      <div className="title-block"><h1>Messages</h1><p>Your lift club chat, requests and updates.</p></div>
      <ClubChats/>
      <SectionTitle>Updates</SectionTitle>
      {readError&&<p className="small muted" role="status">{readError}</p>}
      {loading ? <CardSkeleton /> : error ? <ErrorState message={error.message} onRetry={retry} /> : items.length === 0 ? (
        <p className="muted small">No updates yet. New passenger requests appear here.</p>
      ) : (
        <div className="list">
          {items.map((n) => (
            <ProfileRow key={n.id} icon={n.kind === 'request' ? 'users' : 'bell'} title={n.title} subtitle={n.body} onClick={n.link ? () => nav(notificationDestination(n.link)) : undefined} right={<span className="row-flex" style={{ gap: 6 }}>{!n.read && <i className="notif-dot" aria-label="unread" />}<span className="small muted">{timeAgo(n.createdAt)}</span></span>} />
          ))}
        </div>
      )}
    </ScreenBody>
  )
}
