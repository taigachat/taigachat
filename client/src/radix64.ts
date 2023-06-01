import { radix64 } from './schema'

export function toRadix64(n: number) {
    if (n <= 0) {
        return '0'
    }
    let result = ''
    while (n > 0) {
        const d = n & 0b111111
        result = radix64[d] + result  
        n >>= 6
    }
    return result
}
