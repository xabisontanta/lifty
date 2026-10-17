import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { signInViaUi } from './auth-helpers'
import { PASSENGER, NEWBIE, enterCode, resetTestUsers, sql, startSignUp, userId } from './helpers'

const driver='e0000000-0000-4000-8000-000000000101'
const driverPhone={national:'820000101',code:'123456'}
async function coordinates(page:Page,index:number,label:string,lat:number,lng:number){
  await page.getByRole('button',{name:/^(Choose on map|Enter coordinates)$/}).nth(index).click()
  const manual=page.getByRole('button',{name:'Enter coordinates manually'})
  if(await manual.isVisible())await manual.click({timeout:3000}).catch(async()=>{await expect(page.getByLabel('Latitude',{exact:true})).toBeVisible()})
  await page.getByLabel('Location label',{exact:true}).fill(label)
  await page.getByLabel('Latitude',{exact:true}).fill(String(lat))
  await page.getByLabel('Longitude',{exact:true}).fill(String(lng))
  await page.getByRole('button',{name:'Use this spot'}).click()
}
async function request(page:Page,name:string,phone:typeof PASSENGER){
  await startSignUp(page,'passenger',`${name} Pilot`,phone)
  await enterCode(page,phone.code)
  await expect(page.getByText('Your commuting details')).toBeVisible()
  await coordinates(page,0,'Salt Rock Main Road',-29.488331,31.234003)
  await coordinates(page,1,'Umhlanga Ridge',-29.739187,31.076244)
  await page.getByRole('button',{name:'Continue',exact:true}).click()
  await page.getByLabel('Preferred arrival time').selectOption('08:00')
  await page.getByRole('button',{name:'Continue',exact:true}).click()
  await page.getByRole('button',{name:/Finish/}).click()
  await expect(page).toHaveURL(/\/p\/home/)
  await page.goto('/p/find',{waitUntil:'domcontentloaded'})
  await page.getByRole('button',{name:/Arrival time/}).click()
  await page.getByRole('radio',{name:'30 min',exact:true}).click()
  await page.getByRole('button',{name:'Done',exact:true}).click()
  await page.getByRole('button',{name:'Find Lift Clubs'}).click()
  await expect(page.getByText('Available Lift Clubs')).toBeVisible({timeout:60_000})
  await page.getByRole('button',{name:/View match with Sipho/}).click()
  await page.getByRole('button',{name:'Request to Join'}).click()
  await page.getByRole('button',{name:'Send Request'}).click()
  await expect(page.getByText('Request Sent!')).toBeVisible()
  const id=new URL(page.url()).searchParams.get('request')
  expect(id).toMatch(/^[0-9a-f-]{36}$/)
  return id!
}
test('real local driver and two passengers keep requests, group chat, settings and pickups consistent',async({browser})=>{
  test.setTimeout(600_000)
  const message=`Meet at the agreed pickup — driver pilot ${crypto.randomUUID()}.`
  resetTestUsers()
  const settings=JSON.parse(sql(`select json_build_object('auto',auto_respond,'delay',response_delay_seconds,'decline',decline_percent) from lifty_private.test_driver_settings where driver_id='${driver}'`))
  const leg=sql(`select id from public.driver_legs where driver_id='${driver}' and direction='to_work'`)
  const before=JSON.parse(sql(`select json_build_object('paused',requests_paused,'trip',(select to_jsonb(i) from public.commute_instances i where leg_id='${leg}' and service_date=(now() at time zone 'Africa/Johannesburg')::date),'riders',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.instance_riders r join public.commute_instances i on i.id=r.instance_id where i.leg_id='${leg}' and i.service_date=(now() at time zone 'Africa/Johannesburg')::date)) from public.driver_legs where id='${leg}'`))
  expect(before.riders,'This reserved fixture departure must be unused by other riders').toHaveLength(0)
  sql(`select public.configure_test_driver('${driver}',false,5,0);update public.driver_legs set requests_paused=false where id='${leg}'`)
  const contexts=await Promise.all([0,1,2].map(()=>browser.newContext({baseURL:'http://127.0.0.1:5180',viewport:{width:390,height:844},locale:'en-ZA',timezoneId:'Africa/Johannesburg'})))
  const [driverPage,p1,p2]=await Promise.all(contexts.map(c=>c.newPage()))
  contexts.forEach(c=>c.setDefaultTimeout(20_000))
  let trip:string|undefined
  const errors:string[]=[]
  try{
    for(const page of [driverPage,p1,p2]){
      page.on('pageerror',e=>errors.push(e.message))
      await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}))
      await page.route('https://fonts.gstatic.com/**',r=>r.abort())
      // Exercise the real coordinate fallback deterministically. Road matching
      // still calls the unmodified gateway and actual server routing provider.
      await page.route('https://api.mapbox.com/styles/**',r=>r.abort())
    }
    await signInViaUi(driverPage,driverPhone)
    await expect(driverPage).toHaveURL(/\/d\/home/)
    await driverPage.goto('/d/requests',{waitUntil:'domcontentloaded'})
    const requests:string[]=[]
    for(const [page,name,phone] of [[p1,'Alpha',PASSENGER],[p2,'Bravo',NEWBIE]] as const){
      requests.push(await request(page,name,phone))
      // The driver stays on this open inbox: no reload or explicit refresh.
      await expect(driverPage.getByText(`${name} P.`,{exact:true})).toBeVisible({timeout:30_000})
      await driverPage.getByText(`${name} P.`,{exact:true}).click()
      await driverPage.getByRole('button',{name:'Accept Passenger'}).click()
      await expect(driverPage).toHaveURL(/\/d\/requests/)
      await expect(page.getByText('You’re In!',{exact:true})).toBeVisible({timeout:30_000})
      await page.reload({waitUntil:'domcontentloaded'})
      await expect(page.getByText('You’re In!',{exact:true})).toBeVisible()
    }
    expect(sql(`select count(*) from public.club_members where leg_id='${leg}' and passenger_id in('${userId(PASSENGER)}','${userId(NEWBIE)}') and active`)).toBe('2')
    await driverPage.goto('/d/settings',{waitUntil:'domcontentloaded'})
    await driverPage.getByRole('button',{name:'Pause new requests',exact:true}).click()
    await expect(driverPage.getByRole('button',{name:'Reopen new requests',exact:true})).toBeVisible()
    await driverPage.reload({waitUntil:'domcontentloaded'})
    await driverPage.getByRole('button',{name:'Reopen new requests',exact:true}).click()
    await expect(driverPage.getByRole('button',{name:'Pause new requests',exact:true})).toBeVisible()
    expect(sql(`select count(*) from public.club_members where leg_id='${leg}' and active`)).toBe('2')

    await driverPage.goto(`/chat/${leg}`,{waitUntil:'domcontentloaded'})
    await driverPage.getByLabel('Message',{exact:true}).fill(message)
    await driverPage.getByRole('button',{name:'Send',exact:true}).click()
    await expect(driverPage.getByText(message,{exact:true})).toBeVisible()
    await p1.goto('/p/inbox',{waitUntil:'domcontentloaded'})
    await expect(p1.getByLabel(/\d+ unread messages/)).toBeVisible()
    await p1.getByRole('button',{name:/Morning lift club/}).click()
    await expect(p1.getByText(message,{exact:true})).toBeVisible()
    await p1.getByLabel('Message',{exact:true}).fill('Alpha is ready.')
    await p1.getByRole('button',{name:'Send',exact:true}).click()
    await expect(driverPage.getByText('Alpha is ready.',{exact:true})).toBeVisible({timeout:35_000})
    await p2.goto(`/chat/${leg}`,{waitUntil:'domcontentloaded'})
    await expect(p2.getByText('Alpha is ready.',{exact:true})).toBeVisible()

    // Only fixture setup changes the clock/window; all pickup transitions below
    // go through the signed-in driver's real API, never through owner SQL.
    trip=sql(`select public.begin_test_trip('${requests[0]}',1800)`)
    expect(sql(`select public.begin_test_trip('${requests[1]}',1800)`)).toBe(trip)
    await driverPage.goto('/d/today',{waitUntil:'domcontentloaded'})
    await expect(driverPage.getByRole('heading',{name:"Today's pickups"})).toBeVisible()
    const alpha=driverPage.getByRole('button',{name:/Alpha.*Expected/})
    await alpha.click()
    await driverPage.getByRole('button',{name:'Arrived at this pickup',exact:true}).click()
    await driverPage.getByRole('button',{name:'Confirm Alpha collected',exact:true}).click()
    expect(sql(`select status from public.instance_riders where instance_id='${trip}' and passenger_id='${userId(PASSENGER)}'`)).toBe('collected')
    expect(sql(`select status from public.instance_riders where instance_id='${trip}' and passenger_id='${userId(NEWBIE)}'`)).toBe('expected')
    await driverPage.getByRole('button',{name:/Bravo.*Expected/}).click()
    await driverPage.getByRole('button',{name:'Arrived at this pickup',exact:true}).click()
    await driverPage.getByRole('button',{name:'Confirm Bravo collected',exact:true}).click()
    await driverPage.reload({waitUntil:'domcontentloaded'})
    await expect(driverPage.getByRole('button',{name:'Finish commute',exact:true})).toBeEnabled()
    mkdirSync('docs/review/driver-pilot',{recursive:true})
    await driverPage.screenshot({path:'docs/review/driver-pilot/two-passenger-pickups.png'})
    await driverPage.getByRole('button',{name:'Finish commute',exact:true}).click()
    await expect(driverPage).toHaveURL(/\/history/)
    expect(sql(`select status from public.commute_instances where id='${trip}'`)).toBe('completed')
    expect(sql(`select count(*) from public.instance_riders where instance_id='${trip}' and status='dropped_off'`)).toBe('2')
    expect(errors).toEqual([])
  }finally{
    await Promise.all(contexts.map(c=>c.close()))
    resetTestUsers()
    sql(`delete from public.messages where leg_id='${leg}' and sender_id='${driver}' and body='${message}'`)
    if(trip&&!before.trip)sql(`delete from public.commute_instances where id='${trip}' and leg_id='${leg}'`)
    else if(before.trip){
      const json=JSON.stringify(before.trip).replace(/'/g,"''")
      sql(`delete from public.commute_instances where id='${before.trip.id}';insert into public.commute_instances select * from jsonb_populate_record(null::public.commute_instances,'${json}'::jsonb)`)
    }
    sql(`update public.driver_legs set requests_paused=${before.paused} where id='${leg}';select public.configure_test_driver('${driver}',${settings.auto},${settings.delay},${settings.decline})`)
  }
})
