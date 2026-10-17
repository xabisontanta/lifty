import { describe, expect, it } from 'vitest'
import { ownedFilePath } from '@/lib/storagePaths'
const owner='11111111-1111-4111-8111-111111111111'
const base='https://project.supabase.co'
const path=`${owner}/vehicle-123.jpg`
const url=`${base}/storage/v1/object/public/vehicle-photos/${path}`
describe('owned draft photos',()=>{
  it('preserves an uploaded car photo as an owned storage path across setup reload',()=>expect(ownedFilePath(url,'vehicle-photos',owner,base)).toBe(path))
  it.each([url.replace(base,'https://tracker.example'),url.replace(owner,'other'),url+'?track=1',url.replace('vehicle-photos','kyc'),url.replace('vehicle-123.jpg','%2e%2e%2fother.jpg')])('rejects foreign or unsafe photo %s',value=>expect(ownedFilePath(value,'vehicle-photos',owner,base)).toBeUndefined())
})
