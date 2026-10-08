// Configures the matching worker without placing credentials in source or CLI arguments.
// Prefer a dedicated backend Mapbox token in MAPBOX_ROUTING_TOKEN.
// --use-existing-map-token reuses the existing public maps token; rotate to a dedicated token for production.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const existing=process.argv.includes('--use-existing-map-token');
const env=Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}));
const token=process.env.MAPBOX_ROUTING_TOKEN||(existing?env.VITE_MAPBOX_TOKEN:null);
if(!token)throw new Error('Set MAPBOX_ROUTING_TOKEN, or choose --use-existing-map-token explicitly.');
const file='.env.routing-temp';
try{
 fs.writeFileSync(file,'MAPBOX_TOKEN='+token+'\n',{mode:0o600});
 const command='npx --yes supabase secrets set --env-file .env.routing-temp --project-ref kdjzevtryezwbjdgyqaf';
 execFileSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c',command],{stdio:'pipe'});
 console.log('Routing secret configured'+(existing?' using the existing maps token.':' using a dedicated backend token.'));
}finally{fs.rmSync(file,{force:true})}

