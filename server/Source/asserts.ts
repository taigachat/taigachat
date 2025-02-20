import { strictEqual, equal } from "node:assert";

export function assertEquals<T>(actual: unknown, expected: T, msg?: string) {
    return equal(actual, expected, msg);
}

export function assertStrictEquals<T>(actual: unknown, expected: T, msg?: string): asserts actual is T {
    return strictEqual(actual, expected, msg);
}
