import {describe,it,expect} from 'vitest'
import {mergeMessages} from '@/lib/chat'
import {notificationDestination} from '@/services/notificationRoutes'
const message=(id:string,time:number)=>({id,createdAt:time,senderId:'p',senderName:'',body:id,mine:false})
describe('chat catch-up',()=>{
 it('keeps messages received during the initial fetch',()=>expect(mergeMessages([message('live',30)],[message('old',10)]).map(m=>m.id)).toEqual(['old','live']))
 it('deduplicates reconnect delivery and enriches sender names',()=>expect(mergeMessages([message('one',10)],[{...message('one',10),senderName:'Rider'}])).toEqual([{...message('one',10),senderName:'Rider'}]))
 it('orders older pages before new messages',()=>expect(mergeMessages([message('latest',30)],[message('two',20),message('one',10)]).map(m=>m.id)).toEqual(['one','two','latest']))
})
describe('notification destinations',()=>{
 it.each(['https://example.com','//example.com','/\\example.com','javascript:alert(1)','/d\\example.com','/admin'])('rejects unsafe/unexpected route %s',route=>expect(notificationDestination(route)).toBe('/'))
 it.each(['/p/track','/d/request/123','/p/rate?instance=123','/history'])('opens the intended app route %s',route=>expect(notificationDestination(route)).toBe(route))
})
