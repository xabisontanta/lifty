import {describe,it,expect} from 'vitest'
import {mergeMessages,outgoingMessage,unconfirmedMessages} from '@/lib/chat'
import {notificationDestination} from '@/services/notificationRoutes'
const message=(id:string,time:number)=>({id,createdAt:time,senderId:'p',senderName:'',body:id,mine:false})
describe('chat catch-up',()=>{
 it('orders equal timestamps by server sequence rather than UUID so read cursors match rendered history',()=>{
  const messages=[{...message('a',100),sequence:12},{...message('z',100),sequence:11}]
  expect(mergeMessages([],messages).map(m=>m.id)).toEqual(['z','a'])
 })
 it('keeps messages received during the initial fetch',()=>expect(mergeMessages([message('live',30)],[message('old',10)]).map(m=>m.id)).toEqual(['old','live']))
 it('deduplicates reconnect delivery and enriches sender names',()=>expect(mergeMessages([message('one',10)],[{...message('one',10),senderName:'Rider'}])).toEqual([{...message('one',10),senderName:'Rider'}]))
 it('orders older pages before new messages',()=>expect(mergeMessages([message('latest',30)],[message('two',20),message('one',10)]).map(m=>m.id)).toEqual(['one','two','latest']))
 it('keeps a known sender name when reconnect delivers a bare realtime row',()=>expect(mergeMessages([{...message('one',10),senderName:'Rider'}],[message('one',10)])[0].senderName).toBe('Rider'))
 it('deduplicates an optimistic send when its committed message arrives',()=>{
  const pending=outgoingMessage('same-id',' Hello ','me',10)
  const received={...message('same-id',11),senderId:'me',body:'Hello',mine:true}
  expect(mergeMessages([pending],[received])).toHaveLength(1)
  expect(mergeMessages([pending],[received])[0].createdAt).toBe(11)
  expect(unconfirmedMessages([{...pending,status:'failed',error:'Lost response'}],[received])).toEqual([])
 })
 it('retains failed drafts and their stable id until the server confirms them',()=>{
  const pending={...outgoingMessage('retry-id','  Keep this text  ','me',10),status:'failed' as const}
  expect(unconfirmedMessages([pending],[message('different-id',11)])).toEqual([pending])
  expect(pending.id).toBe('retry-id');expect(pending.body).toBe('Keep this text')
 })
})
describe('notification destinations',()=>{
 it.each(['https://example.com','//example.com','/\\example.com','javascript:alert(1)','/d\\example.com','/admin'])('rejects unsafe/unexpected route %s',route=>expect(notificationDestination(route)).toBe('/'))
 it.each(['/p/track','/d/request/123','/p/rate?instance=123','/history'])('opens the intended app route %s',route=>expect(notificationDestination(route)).toBe(route))
})
