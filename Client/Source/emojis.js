// TODO: remove unicode and html from the emoji.json file

/**
 * @typedef {{
 *  emoji: string,
 *  name: string,
 *  shortname: string,
 *  category: string,
 *  order: string,
 * }} Emoji
 */

/** @type {Promise<Emoji[]>|undefined} */
let emojis = undefined;

async function loadEmojis() {
    const emojiResponse = await fetch(new URL("/static/emojis.json", import.meta.url));
    const emojiList = await emojiResponse.json();
    if (Array.isArray(emojiList)) {
        return emojiList;
    }
    return [];
}

export function getEmojis() {
    if (!emojis) {
        emojis = loadEmojis();
    }
    return emojis;
}
