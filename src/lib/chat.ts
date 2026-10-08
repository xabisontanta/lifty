import type {ChatMessage} from '@/services/api'
export function mergeMessages(current:ChatMessage[],incoming:ChatMessage[]):ChatMessage[]{
 const byId=new Map(current.map(m=>[m.id,m]))
 for(const m of incoming)byId.set(m.id,{...byId.get(m.id),...m})
 return [...byId.values()].sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id))
}
