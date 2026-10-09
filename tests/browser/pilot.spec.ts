import {test,expect,type Page} from '@playwright/test'
const project='kdjzevtryezwbjdgyqaf'
const id='11111111-1111-4111-8111-111111111111'
const second='22222222-2222-4222-8222-222222222222'
const user=(uid:string)=>({id:uid,aud:'authenticated',role:'authenticated',email:'browser-fixture@example.invalid',phone:'27000000000',app_metadata:{provider:'phone',providers:['phone']},user_metadata:{},created_at:'2026-10-08T00:00:00Z'})
function session(uid:string){return {access_token:[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:uid,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'test-signature'].join('.'),refresh_token:'browser-fixture',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user:user(uid)}}
function snapshot(uid:string,role='passenger'){return {
 profile:{id:uid,role,first_name:uid===id?'Browser':'Second',last_initial:'Q',created_at:'2026-10-08T00:00:00Z',onboarding_completed_at:'2026-10-08T00:00:00Z'},private:{phone:'27000000000',last_name:'Fixture',location_consent_at:null,low_data_mode:true},vehicle:null,legs:[],commutes:[],documents:[],exceptions:[],requests:[],memberCount:0,verification:{identity:'pending',licence:'pending',vehicle:'pending',insurance:'pending'}
}}
async function backend(page:Page,role='passenger'){
 const exceptions:any[]=[]
 const deleted:string[]=[]
 await page.route('**/'+project+'.supabase.co/**',async route=>{
  const path=new URL(route.request().url()).pathname
  const claims=route.request().headers().authorization?.split(' ')[1]?.split('.')[1]
  let uid=id;try{uid=JSON.parse(Buffer.from(claims??'','base64url').toString()).sub??id}catch{}
  let body:any=[]
  if(path==='/auth/v1/user')body=user(uid)
  else if(path==='/rest/v1/rpc/get_account_snapshot')body={...snapshot(uid,role),exceptions:[...exceptions]}
  else if(path==='/rest/v1/rpc/get_my_clubs')body={asPassenger:[],asDriver:[]}
  else if(path==='/rest/v1/rpc/get_current_instance')body=null
  else if(path==='/rest/v1/rpc/is_admin')body=false
  else if(path==='/auth/v1/logout')body={}
  else if(path==='/rest/v1/schedule_exceptions'){
   if(route.request().method()==='POST'){
    const row={...route.request().postDataJSON(),id:'33333333-3333-4333-8333-333333333333',created_at:'2026-10-08T00:00:00Z'}
    exceptions.push(row);body={id:row.id}
   }else if(route.request().method()==='DELETE'){
    const requested=new URL(route.request().url()).searchParams.get('id')?.replace(/^eq\./,'')??''
    deleted.push(requested);const index=exceptions.findIndex(e=>e.id===requested);if(index>=0)exceptions.splice(index,1)
    body=null
   }else body=[...exceptions]
  }
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)})
 })
 return {exceptions,deleted}
}
test('unauthenticated live routing ignores saved roles and sample accounts',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('lifty.source',JSON.stringify('live'));localStorage.setItem('lifty.state.v1',JSON.stringify({role:'driver',onboarded:true,verified:true,user:{id:'me',fullName:'Stale sample'}}))})
 await page.goto('/d/home');await expect(page).toHaveURL(/\/welcome$/)
 await page.goto('/onboarding/driver/1');await expect(page).toHaveURL(/\/welcome$/)
 await expect(page.getByText('Stale sample')).toHaveCount(0)
})
test('SMS signup has no password or WhatsApp delivery promise; demo fallback lasts for this tab only',async({page})=>{
 await page.route('**/auth/v1/otp',r=>r.fulfill({status:422,contentType:'application/json',body:JSON.stringify({error_code:'phone_provider_disabled',msg:'Phone signups are disabled'})}))
 await page.goto('/role');await page.getByRole('radio',{name:/Passenger/}).click();await page.getByRole('button',{name:'Continue',exact:true}).click()
 await expect(page.locator('input[type=password]')).toHaveCount(0);await expect(page.getByText(/WhatsApp/)).toHaveCount(0)
 await page.getByLabel('Full name').fill('Browser Fixture');await page.getByLabel('Mobile number',{exact:true}).fill('0000000000')
 await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Create Account',exact:true}).click()
 await expect(page.getByText('Phone sign-in isn’t switched on yet')).toBeVisible()
 await page.getByRole('button',{name:'Use demo'}).click();await expect(page).toHaveURL(/\/otp$/)
 await page.getByLabel('Digit 1',{exact:true}).fill('123456');await page.getByRole('button',{name:/^(Continue|Verify & Continue)$/}).click()
 await expect(page).toHaveURL(/\/onboarding\/passenger\/1$/)
 // demo is a per-tab choice: never saved permanently, or a normal tab would stay stuck in it (private tabs worked, normal ones did not)
 expect(await page.evaluate(()=>[sessionStorage.getItem('lifty.source'),localStorage.getItem('lifty.source')])).toEqual(['demo',null])
})
test('mocked returning account restores server role and preferences and clears logout',async({page})=>{
 await backend(page)
 await page.addInitScript(({session,project})=>{if(localStorage.getItem('lifty.browser.fixture.seeded'))return;localStorage.setItem('lifty.browser.fixture.seeded','true');localStorage.setItem('lifty.source',JSON.stringify('live'));localStorage.setItem('sb-'+project+'-auth-token',JSON.stringify(session));localStorage.setItem('lifty.state.v1',JSON.stringify({role:'driver',onboarded:true,user:{id:'me',fullName:'Stale sample'}}))},{session:session(id),project})
 await page.goto('/p/profile');await expect(page.getByRole('heading',{name:'Browser Fixture'})).toBeVisible()
 await expect(page.getByRole('switch',{name:'Live location during commutes'})).not.toBeChecked()
 await expect(page.getByText('Become a driver')).toHaveCount(0)
 await page.getByRole('button',{name:'Sign out'}).click();await expect(page).toHaveURL(/\/welcome$/)
 await page.goto('/p/profile');await expect(page).toHaveURL(/\/welcome$/)
 await page.evaluate(({s,p})=>localStorage.setItem('sb-'+p+'-auth-token',JSON.stringify(s)),{s:session(second),p:project})
 await page.goto('/p/profile');await expect(page.getByRole('heading',{name:'Second Fixture'})).toBeVisible();await expect(page.getByText('Browser Fixture')).toHaveCount(0)
})
test('mocked live pilot pages contain no sample payment methods and persist exception IDs',async({page})=>{
 const fixture=await backend(page)
 await page.addInitScript(({s,p})=>{localStorage.setItem('lifty.source',JSON.stringify('live'));localStorage.setItem('sb-'+p+'-auth-token',JSON.stringify(s))},{s:session(id),p:project})
 await page.goto('/p/payments');await expect(page.getByRole('heading',{name:'Contribution ledger'})).toBeVisible()
 await expect(page.getByText('No contributions yet')).toBeVisible();await expect(page.getByText(/Visa|Mastercard|••••|Add card/)).toHaveCount(0)
 await page.goto('/p/exceptions');await expect(page.getByRole('heading',{name:'Schedules & exceptions'})).toBeVisible()
 await page.getByLabel('Note (optional)',{exact:true}).fill('Browser absence fixture')
 await page.getByRole('button',{name:'Save availability',exact:true}).click()
 await expect(page.getByText('Browser absence fixture',{exact:true})).toBeVisible()
 expect(fixture.exceptions).toHaveLength(1)
 await page.reload();await expect(page.getByText('Browser absence fixture',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Undo',exact:true}).click()
 await expect(page.getByText('Browser absence fixture',{exact:true})).toHaveCount(0)
 expect(fixture.deleted).toEqual(['33333333-3333-4333-8333-333333333333'])
 await page.reload();await expect(page.getByText('Browser absence fixture',{exact:true})).toHaveCount(0)
 await page.goto('/history');await expect(page.getByRole('heading',{name:'Commute history'})).toBeVisible();await expect(page.getByText('No trips yet')).toBeVisible()
 await page.goto('/p/rate');await expect(page.getByRole('button',{name:'Submit Review'})).toBeDisabled()
})
test('driver exceptions use the same persistent workflow',async({page})=>{
 await backend(page,'driver')
 await page.addInitScript(({s,p})=>{localStorage.setItem('lifty.source',JSON.stringify('live'));localStorage.setItem('sb-'+p+'-auth-token',JSON.stringify(s))},{s:session(id),p:project})
 await page.goto('/d/exceptions');await expect(page.getByRole('heading',{name:'Schedules & exceptions'})).toBeVisible();await expect(page.getByRole('button',{name:'Save availability'})).toBeVisible()
 await page.goto('/d/today');await expect(page.getByText('No active commute. Upcoming trips appear in your history.')).toBeVisible()
})

test('expired refresh token clears saved roles and returns to sign-in',async({page})=>{
 await backend(page)
 await page.route('**/auth/v1/token*',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'invalid_grant',error_code:'refresh_token_not_found',msg:'Refresh token expired'})}))
 const expired=session(id)
 expired.expires_at=Math.floor(Date.now()/1000)-3600
 expired.expires_in=-3600
 await page.addInitScript(({s,p})=>{
  localStorage.setItem('lifty.source',JSON.stringify('live'))
  localStorage.setItem('sb-'+p+'-auth-token',JSON.stringify(s))
  localStorage.setItem('lifty.state.v1',JSON.stringify({role:'driver',verified:true,onboarded:true,user:{id:'me',fullName:'Expired account'}}))
 },{s:expired,p:project})
 await page.goto('/p/profile');await expect(page).toHaveURL(/\/welcome$/)
 await expect(page.getByText('Expired account')).toHaveCount(0)
 expect(await page.evaluate(p=>localStorage.getItem('sb-'+p+'-auth-token'),project)).toBeNull()
})

test('failed low-data save keeps the server preference and reports the error',async({page})=>{
 await backend(page)
 await page.route('**/rest/v1/profile_private*',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'Preference save failed'})}))
 await page.addInitScript(({s,p})=>{localStorage.setItem('lifty.source',JSON.stringify('live'));localStorage.setItem('sb-'+p+'-auth-token',JSON.stringify(s))},{s:session(id),p:project})
 await page.goto('/p/profile')
 const toggle=page.getByRole('switch',{name:'Low-data mode',exact:true})
 await expect(toggle).toBeChecked();await toggle.click()
 await expect(page.getByText('Preference save failed',{exact:true})).toBeVisible()
 await expect(toggle).toBeChecked()
})

test('an invalid selected commute cannot silently rate a different completed trip',async({page})=>{
 await backend(page)
 const available={id:'55555555-5555-4555-8555-555555555555',legId:'leg',direction:'to_work',date:'2026-10-07',departsAt:'2026-10-07T04:30:00Z',status:'completed',driverId:second,driverName:'Second',pickupLabel:'Pickup',destinationLabel:'Work',canRate:true,rated:false}
 await page.route('**/rest/v1/rpc/get_commute_history',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([available])}))
 await page.addInitScript(({s,p})=>{localStorage.setItem('lifty.source',JSON.stringify('live'));localStorage.setItem('sb-'+p+'-auth-token',JSON.stringify(s))},{s:session(id),p:project})
 await page.goto('/p/rate?instance=missing')
 await expect(page.getByText('Choose an unrated completed commute from your history.')).toBeVisible()
 await page.getByRole('radio',{name:'5 stars',exact:true}).click()
 await expect(page.getByRole('button',{name:'Submit Review',exact:true})).toBeDisabled()
})

test('rating submits the exact completed instance and its actual driver',async({page})=>{
 await backend(page)
 const trip={id:'55555555-5555-4555-8555-555555555555',legId:'66666666-6666-4666-8666-666666666666',direction:'to_work',date:'2026-10-07',departsAt:'2026-10-07T04:30:00Z',status:'completed',driverId:second,driverName:'Second',pickupLabel:'Pickup',destinationLabel:'Work',canRate:true,rated:false}
 let submitted:any=null
 await page.route('**/rest/v1/rpc/get_commute_history',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([trip])}))
 await page.route('**/rest/v1/profiles*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:second,role:'driver',first_name:'Second',last_initial:'D',rating:4.5,rating_count:1,created_at:'2026-10-01T00:00:00Z',vehicles:[{make:'Toyota',model:'Corolla',colour:'Silver',year:2020,seats_total:3,body_type:'sedan'}]})}))
 await page.route('**/rest/v1/rpc/driver_verification',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({identity:'verified',licence:'verified',vehicle:'verified',insurance:'verified'})}))
 await page.route('**/rest/v1/ratings*',async route=>{if(route.request().method()==='POST')submitted=route.request().postDataJSON();await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([])})})
 await page.addInitScript(({s,p})=>{localStorage.setItem('lifty.source',JSON.stringify('live'));localStorage.setItem('sb-'+p+'-auth-token',JSON.stringify(s))},{s:session(id),p:project})
 await page.goto('/p/rate?instance='+trip.id)
 await expect(page.getByRole('heading',{name:'Second D.'})).toBeVisible()
 await page.getByRole('radio',{name:'5 stars',exact:true}).click()
 await page.getByRole('button',{name:'Submit Review',exact:true}).click()
 await expect(page).toHaveURL(/\/p\/home$/)
 expect(submitted).toMatchObject({rater_id:id,ratee_id:second,leg_id:trip.legId,instance_id:trip.id,stars:5})
})

