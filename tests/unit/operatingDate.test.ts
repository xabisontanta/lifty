import {describe,it,expect} from 'vitest'
import {isoDate} from '@/lib/format'
describe('Johannesburg operating dates',()=>{
 it('uses the new local date in the two hours before UTC midnight',()=>expect(isoDate(0,new Date('2026-10-16T22:30:00Z'))).toBe('2026-10-17'))
 it('applies calendar offsets correctly across a year boundary',()=>expect(isoDate(1,new Date('2026-12-31T10:00:00Z'))).toBe('2027-01-01'))
})
