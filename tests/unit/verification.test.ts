import {describe,it,expect} from 'vitest'
import {driverIsVerified} from '@/domain/verification'
const approved={identity:'verified',licence:'verified',vehicle:'verified',insurance:'verified'} as const
describe('driver approval badge',()=>{
 it('requires all four current approvals',()=>expect(driverIsVerified(approved)).toBe(true))
 it('never represents identity alone as full driver approval',()=>expect(driverIsVerified({...approved,insurance:undefined})).toBe(false))
 it('withdraws full approval immediately on expiry or replacement',()=>{
  expect(driverIsVerified({...approved,licence:'expired'})).toBe(false)
  expect(driverIsVerified({...approved,vehicle:'pending'})).toBe(false)
 })
})
