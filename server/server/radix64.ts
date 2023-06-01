import { assertStrictEquals } from 'https://deno.land/std@0.127.0/testing/asserts.ts';
import { radix64 } from './schema.ts'

const lookup = new Array(256)
for (let i = 0; i < radix64.length; i++) {
    lookup[radix64.charCodeAt(i)] = i
}

export function fromRadix64(txt: string): number {
    let result = 0
    for (let i = 0; i < txt.length; i++) {
        result <<= 6
        result += lookup[txt.charCodeAt(i)]
    }
    return result
}

export function unitTest() {
    assertStrictEquals(fromRadix64('0'), 0) 
    assertStrictEquals(fromRadix64('1'), 1) 
    assertStrictEquals(fromRadix64('_'), 63) 
    assertStrictEquals(fromRadix64('1_'), 127) 
    assertStrictEquals(fromRadix64('2-'), 190) 
}
