import { updateGradually, insertUpdate, redactUpdate, detectInsanity } from './versioned.ts'
import { assertEquals } from 'https://deno.land/std@0.161.0/testing/asserts.ts';

// TODO: Keep in mind that since updateGradually is currently set to 1 (and not a higher value), all of these tests will fail

Deno.test('insertUpdate', () => {
    const store = {
        idKey: 'id' as 'id',
        data: [] as {id: string, name: string}[],
        startIndex: 0,
        length: 0
    }
    const into = {
        data: [],
        version: 0,
    }
    const idToIndex = new Map()

    insertUpdate(store, idToIndex, {
        id: '1',
        name: 'Gaandalf'
    })
    detectInsanity(idToIndex)
    updateGradually(store, into, 0)
    assertEquals(into, {
        data: [
            { id: "1", name: "Gaandalf" }
        ],
        version: 1,
    })
})

Deno.test('redactUpdate', () => {
    const store = {
        idKey: 'id' as 'id',
        data: [] as {id: string, name: string}[],
        startIndex: 0,
        length: 0
    }
    const into = {
        data: [],
        version: 0,
    }
    const idToIndex = new Map()

    insertUpdate(store, idToIndex, {
        id: '1',
        name: 'Gaandalf'
    })
    detectInsanity(idToIndex)
    redactUpdate(store, idToIndex, '1')
    detectInsanity(idToIndex)
    assertEquals(updateGradually(store, into, 0), false)
    assertEquals(into.data, [])
})

Deno.test('insertUpdate1', () => {
    //const debug = console.log
    const debug = (..._args: any[]) => {}

    const store = {
        idKey: 'id' as 'id',
        data: [] as {id: string, name: string}[],
        startIndex: 0,
        length: 0
    }
    const into = {
        data: [],
        version: 0,
    }
    const idToIndex = new Map()

    insertUpdate(store, idToIndex, {
        id: '1',
        name: 'Gaandalf'
    })
    detectInsanity(idToIndex)

    debug('id_to_index (0):', idToIndex)
    debug('store:', store)

    redactUpdate(store, idToIndex, 'nonsense')

    insertUpdate(store, idToIndex, {
        id: '2',
        name: 'Sauromoon',
    })
    detectInsanity(idToIndex)

    debug('id_to_index (1):', idToIndex)
    debug('store:', store)

    insertUpdate(store, idToIndex, {
        id: '3',
        name: 'Arragone',
    })
    detectInsanity(idToIndex)

    debug('id_to_index (2):', idToIndex)
    debug('store:', store)

    insertUpdate(store, idToIndex, {
        id: '2',
        name: 'Sauromoon the Cool',
    })
    detectInsanity(idToIndex)
    debug('id_to_index (3):', idToIndex)
    debug('store:', store)

    // The into result changes depending on how many results we allow updateGradually to include
    updateGradually(store, into, 0)
    detectInsanity(idToIndex)
    assertEquals(into, {
        data: [
            { id: "1", name: "Gaandalf" },
        ],
        version: 4,
    })
    updateGradually(store, into, 5)
    assertEquals(into, {
        data: [
            { id: "2", name: "Sauromoon the Cool" }
        ],
        version: 6,
    })
    updateGradually(store, into, 6)
    assertEquals(into, {
        data: [],
        version: 6,
    })
    debug(into)
})

Deno.test('insertUpdate2', () => {
    //const debug = console.log
    const debug = (..._args: any[]) => {}

    const store = {
        idKey: 'id' as 'id',
        data: [] as {id: string, name: string}[],
        startIndex: 0,
        length: 0
    }
    const into = {
        data: [],
        version: 0,
    }
    const idToIndex = new Map()

    insertUpdate(store, idToIndex, {
        id: '1',
        name: 'Gaandalf'
    })
    detectInsanity(idToIndex)
    redactUpdate(store, idToIndex, '1')

    debug('id_to_index (-3):', idToIndex)
    debug('store:', store)

    assertEquals(updateGradually(store, into, 0), false)
    assertEquals(into.data.length, 0)

    insertUpdate(store, idToIndex, {
        id: '1',
        name: 'Gaandalf'
    })
    detectInsanity(idToIndex)
    debug('id_to_index (-2):', idToIndex)
    debug('store:', store)

    updateGradually(store, into, 0)
    assertEquals(into, {
        data: [{id: '1', name: 'Gaandalf'}],
        version: 2,
    })

    insertUpdate(store, idToIndex, {
        id: '3',
        name: 'Arragone',
    })
    detectInsanity(idToIndex)
    debug('id_to_index (-1):', idToIndex)
    debug('store:', store)

    assertEquals(store.data, [{ id: "3", name: "Arragone" }, { id: "1", name: "Gaandalf" }])
})

Deno.test('insertUpdate3', () => {
    //const debug = console.log
    const debug = (..._args: any[]) => {}

    const store = {
        idKey: 'id' as 'id',
        data: [] as {id: string, name: string}[],
        startIndex: 0,
        length: 0
    }
    const into = {
        data: [],
        version: 0,
    }
    const idToIndex = new Map()

    insertUpdate(store, idToIndex, {
        id: '1',
        name: 'Gaandalf'
    })
    detectInsanity(idToIndex)
    redactUpdate(store, idToIndex, '1')

    debug('id_to_index (-3):', idToIndex)
    debug('store:', store)

    assertEquals(updateGradually(store, into, 0), false)
    assertEquals(into.data.length, 0)

    insertUpdate(store, idToIndex, {
        id: '1',
        name: 'Gaandalf'
    })
    detectInsanity(idToIndex)
    debug('id_to_index (-2):', idToIndex)
    debug('store:', store)

    updateGradually(store, into, 0)
    assertEquals(into, {
        data: [{id: '1', name: 'Gaandalf'}],
        version: 2,
    })

    insertUpdate(store, idToIndex, {
        id: '3',
        name: 'Arragone',
    })
    detectInsanity(idToIndex)
    debug('id_to_index (-1):', idToIndex)
    debug('store:', store)

    insertUpdate(store, idToIndex, {
        id: '3',
        name: 'Arragone',
    })
    detectInsanity(idToIndex)
    debug('id_to_index (0):', idToIndex)
    debug('store:', store)

    insertUpdate(store, idToIndex, {
        id: '2',
        name: 'Sauromoon',
    })
    detectInsanity(idToIndex)

    debug('id_to_index (1):', idToIndex)
    debug('store:', store)
    redactUpdate(store, idToIndex, '2')
    redactUpdate(store, idToIndex, '3')
    redactUpdate(store, idToIndex, '1')

    into.data = []
    assertEquals(updateGradually(store, into, 0), false)
    assertEquals(into.data.length, 0)

    debug('id_to_index (2):', idToIndex)
    insertUpdate(store, idToIndex, {
        id: '1',
        name: 'Gaandalf the Hwite'
    })
    detectInsanity(idToIndex)

    updateGradually(store, into, 0)

    debug(into)
})

