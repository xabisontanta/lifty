export async function shareCommute(text:string){
 if(navigator.share){await navigator.share({title:'My Lifty commute',text});return 'shared'}
 if(navigator.clipboard){await navigator.clipboard.writeText(text);return 'copied'}
 throw new Error('Sharing is unavailable on this device')
}
