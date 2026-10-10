import {beforeEach, describe, expect, it, vi} from 'vitest'
import type {LiftyApi} from '@/services/api'

const config = vi.hoisted(()=>({configured:true}))
vi.mock('@/lib/env',()=>({get hasSupabase(){return config.configured}}))

beforeEach(()=>{
  vi.resetModules()
  config.configured=true
  for(const name of ['localStorage','sessionStorage']) {
    const stored=new Map([['lifty.source','demo'],['lifty.simulate','offline']])
    vi.stubGlobal(name,{getItem:(key:string)=>stored.get(key)??null,removeItem:(key:string)=>stored.delete(key)})
  }
})

describe('backend-only app data',()=>{
  it('ignores and clears old demo flags and submits sign-up to the actual backend',async()=>{
    const {api,registerLiveApi}=await import('@/services/api')
    const signUp=vi.fn().mockResolvedValue({resendInSeconds:30})
    registerLiveApi({signUp} as unknown as LiftyApi)
    const input={fullName:'Test Passenger',phone:'+27820000000',role:'passenger' as const}
    await expect(api.signUp(input)).resolves.toEqual({resendInSeconds:30})
    expect(signUp).toHaveBeenCalledWith(input)
    expect(localStorage.getItem('lifty.source')).toBeNull()
    expect(sessionStorage.getItem('lifty.source')).toBeNull()
  })

  it('fails clearly with no configured backend instead of creating a fake account',async()=>{
    config.configured=false
    const {api,registerLiveApi}=await import('@/services/api')
    const signUp=vi.fn()
    registerLiveApi({signUp} as unknown as LiftyApi)
    expect(()=>api.signUp({fullName:'Test Passenger',phone:'+27820000000',role:'passenger'})).toThrow('backend')
    expect(signUp).not.toHaveBeenCalled()
  })
})
