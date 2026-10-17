import type {ChatMessage} from '@/services/api'
export function mergeMessages(current:ChatMessage[],incoming:ChatMessage[]):ChatMessage[]{
 const byId=new Map(current.map(m=>[m.id,m]))
 for(const m of incoming){
  const existing=byId.get(m.id)
  byId.set(m.id,{...existing,...m,senderName:m.senderName||existing?.senderName||''})
 }
 return [...byId.values()].sort((a,b)=>Number.isFinite(a.sequence)&&Number.isFinite(b.sequence)?a.sequence!-b.sequence!:a.createdAt-b.createdAt||a.id.localeCompare(b.id))
}

export interface OutgoingMessage extends ChatMessage {
 status:'sending'|'failed'|'sent'
 error?:string
}

/** A retry retains this id, even when the first response was lost after committing. */
export function outgoingMessage(id:string,body:string,senderId:string,createdAt:number):OutgoingMessage {
 return {id,body:body.trim(),senderId,senderName:'',createdAt,mine:true,status:'sending'}
}

/** Realtime and history are authoritative, including after an ambiguous send failure. */
export function unconfirmedMessages(pending:OutgoingMessage[],received:ChatMessage[]):OutgoingMessage[]{
 const delivered=new Set(received.map(m=>m.id))
 return pending.filter(m=>!delivered.has(m.id))
}
