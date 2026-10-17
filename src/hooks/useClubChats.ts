import {useEffect} from 'react'
import {useAsync} from '@/hooks/useAsync'
import {api} from '@/services/api'
import {useApp} from '@/store/app'

/** Realtime notifications prompt a refresh; foreground polling also repairs missed events. */
export function useClubChats(){
 const {state}=useApp()
 const accountId=state.user?.id
 const query=useAsync(async()=>({accountId,clubs:accountId?await api.listChatSummaries():[]}),[accountId])
 const refresh=query.retry
 useEffect(()=>{
  const visibleRefresh=()=>{if(document.visibilityState!=='hidden')refresh()}
  const unsubscribe=api.subscribeNotifications(visibleRefresh)
  window.addEventListener('focus',visibleRefresh)
  window.addEventListener('online',visibleRefresh)
  window.addEventListener('lifty:chat-read',visibleRefresh)
  document.addEventListener('visibilitychange',visibleRefresh)
  const timer=window.setInterval(visibleRefresh,30_000)
  return ()=>{
   unsubscribe();window.clearInterval(timer)
   window.removeEventListener('focus',visibleRefresh)
   window.removeEventListener('online',visibleRefresh)
   window.removeEventListener('lifty:chat-read',visibleRefresh)
   document.removeEventListener('visibilitychange',visibleRefresh)
  }
 },[state.user?.id,refresh])
 const data=query.data?.accountId===accountId?query.data?.clubs??null:null
 return {...query,data,totalUnread:(data??[]).reduce((sum,club)=>sum+club.unreadCount,0)}
}
