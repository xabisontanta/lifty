import {test,expect,type Page} from '@playwright/test'

test.use({viewport:{width:390,height:844},timezoneId:'Africa/Johannesburg'})
const project='kdjzevtryezwbjdgyqaf'
const driver='11111111-1111-4111-8111-111111111111'
const rider='22222222-2222-4222-8222-222222222222'
const leg='33333333-3333-4333-8333-333333333333'
const messageId=(n:number)=>`44444444-4444-4444-8444-${String(n).padStart(12,'0')}`
const user={id:driver,aud:'authenticated',role:'authenticated',phone:'27000000000',app_metadata:{provider:'phone',providers:['phone']},user_metadata:{},created_at:'2026-10-08T00:00:00Z'}
function session(){return {access_token:[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:driver,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'test-signature'].join('.'),refresh_token:'browser-fixture',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user}}
function incoming(n:number){return {id:messageId(n),sender_id:rider,body:`Pickup message ${n}`,created_at:new Date(Date.UTC(2026,9,16,4,n)).toISOString(),sender:{first_name:'Rider'}}}

async function fixture(page:Page,{initial=1,failFirst=false,commitOnFailure=false}={}){
 const messages=Array.from({length:initial},(_,i)=>incoming(i+1))
 const sends:{p_leg:string;p_message:string;p_body:string}[]=[]
 const reads:string[]=[]
 let unread=2
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}))
 await page.route('https://fonts.gstatic.com/**',r=>r.abort())
 await page.route(`**/${project}.supabase.co/**`,async route=>{
  const url=new URL(route.request().url()),path=url.pathname
  let body:unknown=[]
  if(path==='/auth/v1/user')body=user
  else if(path==='/rest/v1/rpc/get_account_snapshot')body={profile:{id:driver,role:'driver',first_name:'Driver',last_initial:'Q',created_at:'2026-10-08T00:00:00Z',onboarding_completed_at:'2026-10-08T00:00:00Z'},private:{phone:'27000000000',last_name:'Fixture',location_consent_at:null,low_data_mode:true},vehicle:null,legs:[],commutes:[],documents:[],exceptions:[],requests:[],memberCount:2,verification:{identity:'verified',licence:'verified',vehicle:'verified',insurance:'verified'}}
  else if(path==='/rest/v1/rpc/get_my_clubs')body={asPassenger:[],asDriver:[]}
  else if(path==='/rest/v1/rpc/get_current_instance')body=null
  else if(path==='/rest/v1/rpc/is_admin')body=false
  else if(path==='/rest/v1/rpc/list_chat_summaries')body=[{legId:leg,title:'Morning lift club',memberCount:3,unreadCount:unread,lastMessage:{id:messages.at(-1)?.id,senderId:rider,senderName:'Rider',body:'Meet at pickup',createdAt:Date.now(),mine:false}}]
  else if(path==='/rest/v1/rpc/mark_club_read'){reads.push(route.request().postDataJSON().p_message);unread=0;body=null}
  else if(path==='/rest/v1/messages'){
   const before=url.searchParams.get('created_at')?.replace(/^lt\./,'')
   body=messages.filter(m=>!before||m.created_at<before).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,100)
  }else if(path==='/rest/v1/rpc/send_club_message'){
   const input=route.request().postDataJSON();sends.push(input)
   const fail=failFirst&&sends.length===1
   if(!fail||commitOnFailure){if(!messages.some(m=>m.id===input.p_message))messages.push({id:input.p_message,sender_id:driver,body:input.p_body,created_at:new Date().toISOString(),sender:{first_name:'Driver'}})}
   if(fail){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Connection interrupted. Try again.'})});return}
   body=null
  }
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)})
 })
 await page.addInitScript(({s,p})=>localStorage.setItem('sb-'+p+'-auth-token',JSON.stringify(s)),{s:session(),p:project})
 return {messages,sends,reads}
}

test('group inbox shows unread messages and opens the correctly labelled audience',async({page})=>{
 const backend=await fixture(page)
 await page.goto('/d/inbox')
 await expect(page.getByRole('heading',{name:'Messages',exact:true})).toBeVisible()
 await expect(page.getByLabel('2 unread messages')).toBeVisible()
 await page.getByRole('button',{name:/Morning lift club/}).click()
 await expect(page).toHaveURL(new RegExp(`/chat/${leg}$`))
 await expect(page.getByText('Group chat · driver and accepted passengers',{exact:true})).toBeVisible()
 await expect(page.getByText('Pickup message 1',{exact:true})).toBeVisible()
 await expect.poll(()=>backend.reads).toContain(messageId(1))
 await page.goBack()
 await expect(page.getByLabel('2 unread messages')).toHaveCount(0)
})

test('failed sends expose retry, retain a separate draft and reuse the same id',async({page})=>{
 const backend=await fixture(page,{failFirst:true})
 await page.goto(`/chat/${leg}`)
 await expect(page.getByText('Pickup message 1',{exact:true})).toBeVisible()
 await page.getByLabel('Message',{exact:true}).fill('First message needs retry')
 await page.getByLabel('Send',{exact:true}).click()
 await page.getByLabel('Message',{exact:true}).fill('Keep my next draft')
 await expect(page.getByText('Not sent',{exact:true})).toBeVisible()
 await expect(page.getByText('Connection interrupted. Try again.',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Retry message',exact:true}).click()
 await expect(page.getByRole('button',{name:'Retry message',exact:true})).toHaveCount(0)
 await expect(page.getByText('First message needs retry',{exact:true})).toHaveCount(1)
 await expect(page.getByLabel('Message',{exact:true})).toHaveValue('Keep my next draft')
 expect(backend.sends).toHaveLength(2)
 expect(backend.sends[0].p_message).toBe(backend.sends[1].p_message)
 expect(backend.messages.filter(m=>m.body==='First message needs retry')).toHaveLength(1)
 await page.reload()
 await expect(page.getByText('First message needs retry',{exact:true})).toHaveCount(1)
})

test('foreground catch-up recovers an ambiguous committed send without sending twice',async({page})=>{
 const backend=await fixture(page,{failFirst:true,commitOnFailure:true})
 await page.goto(`/chat/${leg}`)
 await expect(page.getByText('Pickup message 1',{exact:true})).toBeVisible()
 await page.getByLabel('Message',{exact:true}).fill('Saved despite lost response')
 await page.getByLabel('Send',{exact:true}).click()
 await expect(page.getByRole('button',{name:'Retry message',exact:true})).toBeVisible()
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
 await expect(page.getByRole('button',{name:'Retry message',exact:true})).toHaveCount(0)
 await expect(page.getByText('Saved despite lost response',{exact:true})).toHaveCount(1)
 expect(backend.sends).toHaveLength(1)
})

test('history pagination and new messages survive a foreground reconnect together',async({page})=>{
 const backend=await fixture(page,{initial:102})
 await page.goto(`/chat/${leg}`)
 await expect(page.getByText('Pickup message 102',{exact:true})).toBeVisible()
 await expect(page.getByText('Pickup message 1',{exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:'Load older messages',exact:true}).click()
 await expect(page.getByText('Pickup message 1',{exact:true})).toBeVisible()
 backend.messages.push(incoming(103))
 await page.evaluate(()=>window.dispatchEvent(new Event('online')))
 await expect(page.getByText('Pickup message 103',{exact:true})).toBeVisible()
 await expect(page.getByText('Pickup message 1',{exact:true})).toHaveCount(1)
 await expect.poll(()=>backend.reads).toContain(messageId(103))
})
