import { parseQuotedStrings } from './config.ts'
import { assertEquals } from 'https://deno.land/std@0.161.0/testing/asserts.ts'

Deno.test('parseQuotedStrings', () => {
    assertEquals(parseQuotedStrings(''), [])
    assertEquals(parseQuotedStrings('chimpanzee'), ['chimpanzee'])
    assertEquals(parseQuotedStrings('let us "hello world" go'), [
        'let',
        'us',
        'hello world',
        'go',
    ])

})
