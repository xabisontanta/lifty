import { expect, test, type Page } from '@playwright/test'
test.use({viewport:{width:390,height:844}})
const project='kdjzevtryezwbjdgyqaf',id='11111111-1111-4111-8111-111111111111'
const user={id,aud:'authenticated',role:'authenticated',phone:'27000000000',app_metadata:{provider:'phone',providers:['phone']},user_metadata:{},created_at:'2026-10-01T00:00:00Z'}
const jwt=[Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),Buffer.from(JSON.stringify({sub:id,role:'authenticated',exp:1_900_000_000})).toString('base64url'),'fixture'].join('.')
const vehicle={registration:'ND TEST123',make:'Toyota',model:'Corolla',year:'2024',colour:'Blue',seats:3,bodyType:'sedan'}
const commute={origin:'Draft home',destination:'Draft work',originPlace:{label:'Draft home',lng:31.2,lat:-29.5},destinationPlace:{label:'Draft work',lng:31.08,lat:-29.74},offerReturn:true,departure:'06:30',returnTime:'17:00',days:[0,1,2,3,4],maxDeviationMin:8}
async function backend(page:Page,initial:any=null,documents:any[]=[]) {
  let draft=initial
  let fullName='New Driver'
  const saves:any[]=[],names:string[]=[]
  const verification={identity:'pending',licence:'pending',vehicle:'pending',insurance:'pending'}
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}))
  await page.route(`**/${project}.supabase.co/**`,async r=>{
    const path=new URL(r.request().url()).pathname
    let value:any=[]
    if(path==='/auth/v1/user')value=user
    else if(path.endsWith('/rpc/get_account_snapshot'))value={profile:{...user,role:'driver',first_name:fullName.split(' ')[0],last_initial:fullName.split(' ')[1]?.slice(0,1),onboarding_completed_at:null},private:{phone:user.phone,last_name:fullName.split(' ').slice(1).join(' ')},vehicle:null,legs:[],commutes:[],documents,exceptions:[],requests:[],verification}
    else if(path.endsWith('/rpc/get_driver_onboarding_draft'))value=draft
    else if(path.endsWith('/rpc/save_driver_onboarding_draft')){draft=r.request().postDataJSON().p_draft;saves.push(draft);value=null}
    else if(path.endsWith('/rpc/update_profile_name')){fullName=r.request().postDataJSON().p_full_name;names.push(fullName);value=verification}
    await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)})
  })
  await page.addInitScript(({project,user,jwt})=>{localStorage.setItem(`sb-${project}-auth-token`,JSON.stringify({access_token:jwt,refresh_token:'onboarding-fixture',token_type:'bearer',expires_at:1_900_000_000,expires_in:3600,user}))},{project,user,jwt})
  return {saves,names}
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
test('driver confirms their real name before continuing and pickup choices survive reload',async({page})=>{
  const fixture=await backend(page,{step:1,vehicle,commute,seatsOpen:2,monthlyContribution:300})
  await page.goto('/',{waitUntil:'domcontentloaded'})
  await page.getByLabel('Full name',{exact:true}).fill('  Thandi   Ndlovu ')
  await page.getByRole('button',{name:'Continue',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Your regular commute'})).toBeVisible()
  expect(fixture.names).toEqual(['Thandi Ndlovu'])
  await page.getByLabel('How would you like to pick passengers up?').selectOption('meeting_point')
  await page.getByRole('slider',{name:'Maximum detour for pickups'}).fill('12')
  await page.getByRole('button',{name:'Continue',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Verification documents'})).toBeVisible()
  expect(fixture.saves.at(-1).step).toBe(3)
  expect(fixture.saves.at(-1).commute.maxDeviationMin).toBe(12)
  expect(fixture.saves.at(-1).commute.pickupPolicy).toBe('meeting_point')
  await page.reload({waitUntil:'domcontentloaded'})
  await expect(page.getByRole('heading',{name:'Verification documents'})).toBeVisible()
  await page.getByRole('button',{name:'Go back',exact:true}).click()
  await expect(page.getByLabel('How would you like to pick passengers up?')).toHaveValue('meeting_point')
  await expect(page.getByRole('slider',{name:'Maximum detour for pickups'})).toHaveValue('12')
  await page.getByRole('button',{name:'Go back',exact:true}).click()
  await expect(page.getByLabel('Full name',{exact:true})).toHaveValue('Thandi Ndlovu')
})
test('driver setup rejects an incomplete name or impossible model year before publishing',async({page})=>{
  await backend(page,{step:1,vehicle,commute,seatsOpen:2,monthlyContribution:300})
  await page.goto('/',{waitUntil:'domcontentloaded'})
  await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeEnabled()
  await page.getByLabel('Full name',{exact:true}).fill(' ')
  await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeDisabled()
  await page.getByLabel('Full name',{exact:true}).fill('New Driver')
  await page.getByLabel('Year',{exact:true}).fill('2099')
  await expect(page.getByText(/Enter a model year from 1980 to/)).toBeVisible()
  await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeDisabled()
  await page.getByLabel('Year',{exact:true}).fill('1979')
  await expect(page.getByText(/Enter a model year from 1980 to/)).toBeVisible()
  await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeDisabled()
})
test('vehicle illustration cannot keep showing a silver Polo Vivo after model details change',async({page})=>{
  await backend(page,{step:1,vehicle:{...vehicle,make:'Volkswagen',model:'Polo Vivo',year:'2022',colour:'Silver',bodyType:'hatchback'},commute,seatsOpen:2,monthlyContribution:300})
  await page.goto('/',{waitUntil:'domcontentloaded'})
  await expect(page.getByRole('img',{name:/Silver 2022 Volkswagen Polo Vivo.*AI model illustration/})).toBeVisible()
  await page.getByLabel('Colour',{exact:true}).fill('Blue')
  await expect(page.getByRole('img',{name:/Silver 2022 Volkswagen Polo Vivo.*AI model illustration/})).toHaveCount(0)
  await expect(page.getByText('No exact model illustration available yet')).toBeVisible()
  await page.getByLabel('Colour',{exact:true}).fill('Silver')
  await page.getByLabel('Year',{exact:true}).fill('2012')
  await expect(page.getByRole('img',{name:/AI model illustration/})).toHaveCount(0)
})
test('driver vehicle onboarding fits a phone without horizontal clipping',async({page})=>{
  await backend(page,{step:1,vehicle:{...vehicle,make:'Volkswagen',model:'Polo Vivo',year:'2022',colour:'Silver',bodyType:'hatchback'},commute,seatsOpen:2,monthlyContribution:300})
  await page.goto('/',{waitUntil:'domcontentloaded'})
  await expect(page.getByLabel('Full name',{exact:true})).toBeVisible()
  for(const width of [320,390]){
    await page.setViewportSize({width,height:844})
    const layout=await page.locator('.screen-body').evaluate(body=>({
      width:body.clientWidth,scrollWidth:body.scrollWidth,
      overflow:[...body.querySelectorAll('*')].map(element=>({tag:element.tagName,className:element.className,x:element.getBoundingClientRect().x,width:element.getBoundingClientRect().width})).filter(element=>element.x+element.width>body.getBoundingClientRect().right+1),
    }))
    expect(layout.scrollWidth,JSON.stringify(layout)).toBeLessThanOrEqual(layout.width)
    expect(layout.overflow).toEqual([])
  }
  await page.screenshot({path:test.info().outputPath('driver-onboarding-mobile.png'),fullPage:true})
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
