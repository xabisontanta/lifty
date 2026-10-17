import {useNavigate} from 'react-router-dom'
import {CardSkeleton,ErrorState,ProfileRow,SectionTitle} from '@/components/ui/kit'
import {useClubChats} from '@/hooks/useClubChats'

export function ClubChats(){
 const nav=useNavigate()
 const {data,loading,error,retry}=useClubChats()
 return <>
  <SectionTitle>Lift club group chats</SectionTitle>
  {loading&&!data?<CardSkeleton/>:null}
  {error?<ErrorState message={error.message} onRetry={retry}/>:null}
  {data?.length===0?<p className="muted small">Group chat becomes available when a lift arrangement is accepted.</p>:null}
  <div className="list">{data?.map(club=><ProfileRow key={club.legId} icon="message" title={club.title}
   subtitle={`${club.memberCount} members · ${club.lastMessage?`${club.lastMessage.senderName||'Member'}: ${club.lastMessage.body}`:'Agree on pickup details with your group'}`}
   right={club.unreadCount>0?<span className="badge" aria-label={`${club.unreadCount} unread messages`}>{club.unreadCount}</span>:undefined}
   onClick={()=>nav(`/chat/${club.legId}`,{state:{name:club.title}})}/>)}</div>
 </>
}
