export const EMPTY_URL = () => new URL('null:')

// TODO: Perhaps this urlTable should
// quietly delete the entries after some time out of privacy reasons?

const urlTable: Map<string|undefined, (fileName: string) => URL> = new Map()
urlTable.set('', EMPTY_URL)
urlTable.set(undefined, EMPTY_URL)

export function safeURL(a?: string): ((b: string) => URL) {
    // We memoize the URL here. We do this because otherwise the
    // reference pointer doesn't have a stable identity. This will
    // casue a re-render of our GUI, which would be very stupid.

    const existing = urlTable.get(a)
    if (existing) {
        return existing
    }

    // If '' and undefined are not in the table, we will crash here...
    const first = new URL(a || '')
    const withTrailing = first.pathname.endsWith('/')
        ? first.pathname
        : `${first.pathname}/`
    const normalized = new URL(withTrailing, first)
    const result = (b: string) => {
        return new URL(b, normalized)
    }
    urlTable.set(a, result)
    return result
}

