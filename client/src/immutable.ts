// A convenience type for making a data-type
// immutable.
export type Immutable<T> = {
    readonly [K in keyof T]: Immutable<T[K]>
}

export type AlmostImmutable<T> = {
    [K in keyof T]: Immutable<T[K]>
}

// TODO: Generally speaking unsafe but required when interacting with some
// DEPRECATED in favour of mutableClone
// APIs
export function asMutable<T>(v: Immutable<T>): T {
    return v as T
}

export function mutableClone<T>(v: Immutable<T>): T {
    return 'structuredClone' in window
        ? structuredClone(v)
        : JSON.parse(JSON.stringify(v))
}

