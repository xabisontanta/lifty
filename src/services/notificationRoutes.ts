export function notificationDestination(value:unknown):string {
 if(typeof value!=='string'||!/^\/(p|d|chat|history|safety)(\/|\?|$)/.test(value)||value.includes('\\')||value.startsWith('//'))return '/'
 return value
}
