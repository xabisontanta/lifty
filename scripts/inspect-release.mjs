import fs from 'node:fs';
import path from 'node:path';
const vars=Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&& !l.trimStart().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}));
const authSettings=await fetch(vars.VITE_SUPABASE_URL+'/auth/v1/settings',{headers:{apikey:vars.VITE_SUPABASE_ANON_KEY}}).then(async r=>({status:r.status,data:await r.json()}));
console.log(JSON.stringify({supabaseProject:new URL(vars.VITE_SUPABASE_URL).hostname.split('.')[0],phoneEnabled:authSettings.data.external?.phone,emailEnabled:authSettings.data.external?.email,status:authSettings.status}));
const authPath=path.join(process.env.APPDATA,'com.vercel.cli','Data','auth.json');
const token=JSON.parse(fs.readFileSync(authPath,'utf8')).token;
const globalPath=path.join(process.env.APPDATA,'com.vercel.cli','Data','config.json');
const config=fs.existsSync(globalPath)?JSON.parse(fs.readFileSync(globalPath,'utf8')):{};
const query=config.currentTeam?'?teamId='+encodeURIComponent(config.currentTeam):'';
async function get(url){const r=await fetch('https://api.vercel.com'+url,{headers:{Authorization:'Bearer '+token}});const body=await r.json();if(!r.ok)throw new Error('Vercel request status '+r.status);return body}
try{
 const alias=await get('/v4/aliases/lifty-ten.vercel.app'+query);
 const deployment=await get('/v13/deployments/'+alias.deployment.id+query);
 const project=await get('/v9/projects/'+deployment.projectId+query);
 console.log(JSON.stringify({projectId:project.id,projectName:project.name,orgId:project.accountId,framework:project.framework,alias:alias.alias,productionDeployment:deployment.id,gitSource:deployment.gitSource??null,buildCommand:project.buildCommand,environmentNames:(project.env??[]).map(x=>x.key)}));
}catch(e){console.log(JSON.stringify({vercelError:e.message,currentTeam:config.currentTeam??null}));}
const site=await fetch('https://lifty-ten.vercel.app');const html=await site.text();console.log(JSON.stringify({siteStatus:site.status,title:html.match(/<title>(.*?)<\/title>/)?.[1],script:html.match(/src="([^"]+\.js)"/)?.[1]}));

