import { expect, test, type Page } from '@playwright/test'
test.use({viewport:{width:390,height:844}})
const project='kdjzevtryezwbjdgyqaf',id='11111111-1111-4111-8111-111111111111'
const user={id,aud:'authenticated',role:'authenticated',phone:'27000000000',app_metadata:{provider:'phone',providers:['phone']},user_metadata:{},created_at:'2026-10-01T00:00:00Z'}
const jwt=[Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),Buffer.from(JSON.stringify({sub:id,role:'authenticated',exp:1_900_000_000})).toString('base64url'),'fixture'].join('.')
const vehicle={registration:'ND TEST123',make:'Toyota',model:'Corolla',year:'2024',colour:'Blue',seats:3,bodyType:'sedan'}
const commute={origin:'Draft home',destination:'Draft work',originPlace:{label:'Draft home',lng:31.2,lat:-29.5},destinationPlace:{label:'Draft work',lng:31.08,lat:-29.74},offerReturn:true,departure:'06:30',returnTime:'17:00',days:[0,1,2,3,4],maxDeviationMin:8}
async function backend(page:Page,initial:any=null,documents:any[]=[]) {
  let draft=initial
  const saves:any[]=[]
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}))
  await page.route(`**/${project}.supabase.co/**`,async r=>{
    const path=new URL(r.request().url()).pathname
    let value:any=[]
    if(path==='/auth/v1/user')value=user
    else if(path.endsWith('/rpc/get_account_snapshot'))value={profile:{...user,role:'driver',first_name:'New',last_initial:'D',onboarding_completed_at:null},private:{phone:user.phone},vehicle:null,legs:[],commutes:[],documents,exceptions:[],requests:[],verification:{identity:'pending',licence:'pending',vehicle:'pending',insurance:'pending'}}
    else if(path.endsWith('/rpc/get_driver_onboarding_draft'))value=draft
    else if(path.endsWith('/rpc/save_driver_onboarding_draft')){draft=r.request().postDataJSON().p_draft;saves.push(draft);value=null}
    await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)})
  })
  await page.addInitScript(({project,user,jwt})=>{localStorage.setItem(`sb-${project}-auth-token`,JSON.stringify({access_token:jwt,refresh_token:'onboarding-fixture',token_type:'bearer',expires_at:1_900_000_000,expires_in:3600,user}))},{project,user,jwt})
  return {saves}
}
test('new driver vehicle progress survives reload using an account-scoped server draft',async({page})=>{
  const fixture=await backend(page)
  await page.goto('/')
  await expect(page.getByRole('heading',{name:'Vehicle information'})).toBeVisible()
  await page.getByLabel('Registration number').fill(vehicle.registration)
  await page.getByLabel('Make',{exact:true}).fill(vehicle.make)
  await page.getByLabel('Model',{exact:true}).fill(vehicle.model)
  await page.getByLabel('Year',{exact:true}).fill(vehicle.year)
  await page.getByLabel('Colour',{exact:true}).fill(vehicle.colour)
  await expect.poll(()=>fixture.saves.at(-1)?.vehicle.colour).toBe('Blue')
  expect(fixture.saves.at(-1)).not.toHaveProperty('verification')
  await page.reload()
  await expect(page.getByLabel('Registration number')).toHaveValue(vehicle.registration)
  await expect(page.getByLabel('Colour',{exact:true})).toHaveValue('Blue')
})
test('returning unfinished driver resumes the server step and real mapped locations',async({page})=>{
  await backend(page,{step:2,vehicle,commute,seatsOpen:2,monthlyContribution:300})
  await page.goto('/')
  await expect(page).toHaveURL(/\/onboarding\/driver\/2$/)
  await expect(page.getByLabel('Home address',{exact:true})).toHaveValue('Draft home')
  await expect(page.getByLabel('Work address',{exact:true})).toHaveValue('Draft work')
  await page.reload()
  await expect(page.getByLabel('Home address',{exact:true})).toHaveValue('Draft home')
})
test('document review notes and expiry survive reload without treating uploaded documents as approved',async({page})=>{
  await backend(page,{step:3,vehicle,commute,seatsOpen:2,monthlyContribution:300},[
    {id:'doc-id',kind:'id',status:'pending'},
    {id:'doc-licence',kind:'licence',status:'rejected',review_note:'Please upload both sides',expires_on:'2025-01-01'},
  ])
  await page.goto('/')
  await expect(page.getByRole('heading',{name:'Verification documents'})).toBeVisible()
  await expect(page.getByText('Reviewer: Please upload both sides')).toBeVisible()
  await expect(page.getByText('Expiry date not recorded',{exact:true})).toBeVisible()
  await expect(page.getByText('Approved by reviewer')).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeDisabled()
  await page.reload()
  await expect(page.getByText('Reviewer: Please upload both sides')).toBeVisible()
})
