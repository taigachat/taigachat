// @ts-check

// A task runner, without any stupid parts.

import { statSync } from "node:fs";

const timestamps = new Map();

const DATE_OLD = new Date(1);

/**
 * @param {string} fileName
 * @returns {Date}
 */
function getLastModified(fileName) {
    if (fileName in timestamps) {
        return timestamps[fileName];
    }

    try {
        const info = statSync(fileName);
        timestamps.set(fileName, info.mtime);
        return info.mtime;
    } catch (_e) {
        timestamps.set(fileName, DATE_OLD);
        return DATE_OLD;
    }
}

/**
 * @typedef {(outputFileName: string, inputFileNames: string[], param: T) => void} FileGenerator<T>
 * @template {any} T
 **/

/**
 * @typedef {{
 *  fileName: string,
 *  dependencies: RunnableTask<any>[],
 *  generator: FileGenerator<T>,
 *  generatorParameters: T,
 * }} RunnableTask<T>
 * @template {any} T
 */

class TaskError extends Error {
    /**
     * @param {string} message
     */
    constructor(message) {
        super(message);
        this.name = "TaskError";
    }
}

export class GeneratorError extends Error {
    /**
     * @param {string} message
     */
    constructor(message) {
        super(message);
        this.name = "GeneratorError";
    }
}

/**
 * @param {string} fileName
 * @param {RunnableTask<any>[]} dependencies
 * @param {FileGenerator<T>} generator
 * @param {T} generatorParameters
 * @returns {RunnableTask<T>}
 * @template {any} T
 */

export function makeFile(
    fileName,
    dependencies,
    generator,
    generatorParameters = /** @type {T} */ (undefined)
) {
    return {
        fileName,
        dependencies,
        generator,
        generatorParameters,
        // TODO: Add a counter for detecting circular dependencies.
    };
}

/**
 * @param {string} fileName
 */
function missingFileGenerator(fileName) {
    // Jokes on you! Trying to generate a missing file is an error!
    throw new TaskError(`error: could not find the file ${fileName}`);
}

/**
 * @param {string} fileName
 */
export function theFile(fileName) {
    return makeFile(fileName, [], missingFileGenerator);
}

/**
 * @param {RunnableTask<T>} task
 * @template {any} T
 */
function runTaskInternal(task) {
    // TODO: If I ever add patterns, we'd have to check for them first.

    if (timestamps.has(task)) {
        // This task has already been executed.
        return;
    }

    let timestamp = getLastModified(task.fileName);

    let newestTimestamp = timestamp;

    /** @type {string[]} */
    const dependencyFilenames = [];

    for (const dep of task.dependencies) {
        // TODO: If we ever add concurrent execution, we'll need to find the other task and await somewhere

        try {
            runTaskInternal(dep);
        } catch (e) {
            if (e instanceof TaskError) {
                throw new TaskError(
                    `error: a dependency of '${task.fileName}' has failed, see below\n${e.message}`
                );
            } else {
                throw e;
            }
        }

        const otherTimestamp = getLastModified(dep.fileName);
        if (otherTimestamp > newestTimestamp) {
            newestTimestamp = otherTimestamp;
        }

        dependencyFilenames.push(dep.fileName);
    }

    if (timestamp == newestTimestamp && newestTimestamp > DATE_OLD) {
        // We are done here, as we are newer than any dependency.
        return;
    }

    try {
        task.generator(task.fileName, dependencyFilenames, task.generatorParameters);
    } catch (e) {
        if (e instanceof GeneratorError) {
            throw new TaskError(
                `error: generating '${task.fileName}' failed, see below\nerror: ${e.message}`
            );
        } else {
            throw e;
        }
    }

    // Evict timestamp from cache and refresh.
    timestamps.delete(task.fileName);
    timestamp = getLastModified(task.fileName);

    if (timestamp < newestTimestamp) {
        throw new TaskError(`error: '${task.fileName}' is still out of date despite running its generator`);
    }
}

/**
 * @param {RunnableTask<any>} task
 * @returns {boolean}
 */
export function runTask(task) {
    try {
        runTaskInternal(task);

        // Trash the timestamp cache once we are done so that this API becomes useful on the second run.
        timestamps.clear();

        return true;
    } catch (e) {
        if (e instanceof TaskError) {
            console.error(e.message);
            return false;
        } else {
            throw e;
        }
    }
}
