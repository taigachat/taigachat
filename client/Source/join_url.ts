export const EMPTY_URL = () => new URL("null:");
export type URLGetter = (subpath: string) => URL;

// TODO: Perhaps this urlTable should
// quietly delete the entries after some time out of privacy reasons?

const urlTable: Map<string | undefined, URLGetter> = new Map();
urlTable.set("", EMPTY_URL);
urlTable.set(undefined, EMPTY_URL);

// TODO: This thing is really stupid. And I despise it.
// But we do it presumably so that it can be sent as a prop to components.
// Also joinURL() from auth_worker works differently. The question is, what should safeURL("https://exmaple.com/data")("/location") give?
// Is it https://example.com/data/location or https://example.com/location. What is more intuitive?
// Either way, perhaps we just shouldn't have URL's beginning with / in the codebase anyway.

export function safeURL(a?: string): URLGetter {
    // We memoize the URL here. We do this because otherwise the
    // reference pointer doesn't have a stable identity. This will
    // casue a re-render of our GUI, which would be very stupid.

    const existing = urlTable.get(a);
    if (existing) {
        return existing;
    }

    // If '' and undefined are not in the table, we will crash here...
    const first = new URL(a || "");
    const withTrailing = first.pathname.endsWith("/") ? first.pathname : `${first.pathname}/`;
    const normalized = new URL(withTrailing, first);
    const result = (b: string) => {
        return new URL(b, normalized);
    };
    urlTable.set(a, result);
    return result;
}
