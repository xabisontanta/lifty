import {zipSync,strToU8} from 'fflate'
import {api,isLive} from './api'
import {sb} from './supabase'
export async function exportArchive():Promise<Blob>{
 const data=await api.exportMyData() as {fileManifest?:{bucket:string;path:string}[]}
 const entries:Record<string,Uint8Array>={'my-data.json':strToU8(JSON.stringify(data,null,2))}
 if(isLive())for(const file of data.fileManifest??[]){
  const {data:blob,error}=await sb().storage.from(file.bucket).download(file.path)
  if(error||!blob)throw new Error('A stored file could not be exported. Retry before treating this archive as complete.')
  entries[`files/${file.bucket}/${file.path}`]=new Uint8Array(await blob.arrayBuffer())
 }
 return new Blob([zipSync(entries,{level:0}) as Uint8Array<ArrayBuffer>],{type:'application/zip'})
}
