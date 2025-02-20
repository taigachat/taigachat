// This code is for parsing and creating PNG chunks.
// We use this to remove the EXIF portion of PNG files
// And to extract user information from an avatar image.

import { registerDebugCommand } from "./debug_mode";

export interface PNGChunk {
    tag: string;
    data: Uint8Array;
}

const PNG_MAGIC_1 = 0x89504e47;
const PNG_MAGIC_2 = 0xd0a1a0a;

export function findChunkByTag(tag: string, chunks: PNGChunk[]): PNGChunk {
    for (const chunk of chunks) {
        if (chunk.tag === tag) {
            return chunk;
        }
    }
    throw "could not find " + tag;
}

function generateCRCTable() {
    const table = [];
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c;
    }
    return table;
}
const crc32Table = generateCRCTable();

function crc32(data: DataView, start: number, end: number) {
    let crc = 0 ^ -1;
    for (let i = start; i < end; i++) {
        //console.log('process: ', data.getUint8(i))
        crc = (crc >>> 8) ^ crc32Table[(crc ^ data.getUint8(i)) & 0xff]!;
    }
    return (crc ^ -1) >>> 0;
}

export function decodePNG(img: ArrayBuffer): PNGChunk[] {
    const view = new DataView(img);
    if (view.getUint32(0) !== PNG_MAGIC_1 || view.getUint32(4) !== PNG_MAGIC_2) {
        //console.error('img', img)
        throw "bad magic number on PNG";
    }

    const chunks: PNGChunk[] = [];
    let index = 8;
    while (index < img.byteLength) {
        const chunkLength = view.getUint32(index);
        const typeStart = index + 4;
        const tag0 = view.getUint8(typeStart);
        const tag1 = view.getUint8(typeStart + 1);
        const tag2 = view.getUint8(typeStart + 2);
        const tag3 = view.getUint8(typeStart + 3);
        const tag = String.fromCharCode(tag0, tag1, tag2, tag3);
        const begin = typeStart + 4;
        const end = begin + chunkLength;
        const crc = view.getUint32(end);
        index = end + 4;
        chunks.push({
            tag,
            data: new Uint8Array(img, begin, end - begin),
        });
        const realCRC = crc32(view, typeStart, end);
        if (realCRC !== crc) {
            // TODO: Throw a custom error class instead
            throw "crc did not match in " + tag;
        }
    }
    return chunks;
}

export function encodePNG(chunks: PNGChunk[]) {
    let size = 8;
    for (const chunk of chunks) {
        size += chunk.data.byteLength + 12;
    }
    const ab = new ArrayBuffer(size);
    const uint8 = new Uint8Array(ab);
    const view = new DataView(ab);
    view.setUint32(0, PNG_MAGIC_1);
    view.setUint32(4, PNG_MAGIC_2);
    let index = 8;
    for (const chunk of chunks) {
        view.setUint32(index, chunk.data.byteLength);
        const tag0 = chunk.tag.charCodeAt(0);
        const tag1 = chunk.tag.charCodeAt(1);
        const tag2 = chunk.tag.charCodeAt(2);
        const tag3 = chunk.tag.charCodeAt(3);
        const tag = (tag0 << 24) | (tag1 << 16) | (tag2 << 8) | tag3;
        index += 4;
        view.setUint32(index, tag);
        uint8.set(chunk.data, index + 4);
        const crc = crc32(view, index, index + 4 + chunk.data.byteLength);
        index += chunk.data.byteLength + 4;
        view.setUint32(index, crc);
        index += 4;
    }
    return ab;
}

function equal(a: DataView, b: DataView) {
    if (a.byteLength !== b.byteLength) {
        return false;
    }
    const align32 = (a.byteLength / 4) | 0;
    let rest32 = a.byteLength % 4;
    let i;
    for (i = 0; i < align32; i += 4) {
        if (a.getUint32(i) !== b.getUint32(i)) {
            //console.log('2', a.getUint32(i).toString(16), b.getUint32(i).toString(16), i, a, b, align32)
            return false;
        }
    }
    for (; rest32 > 0; rest32--) {
        if (a.getUint8(i) !== b.getUint8(i)) {
            return false;
        }
        i++;
    }
    return true;
}

async function testPNG() {
    const img = await fetch("./icon-32.png");
    const ab = await img.arrayBuffer();
    console.log(ab);
    const chunks = decodePNG(ab);
    console.dir(chunks);
    const encoded = encodePNG(chunks);
    console.log(equal(new DataView(encoded), new DataView(ab)));

    const enc = new TextEncoder();
    const iend = chunks.pop()!;
    chunks.push(
        {
            tag: "hRMN",
            data: enc.encode("TaigaChat was here!"),
        },
        iend
    );
    const encoded2 = encodePNG(chunks);
    console.log(encoded2);

    function downloadBuffer(arrayBuffer: ArrayBuffer, fileName: string) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([arrayBuffer], { type: "image/png" }));
        a.download = fileName;
        a.click();
    }
    downloadBuffer(encoded2, "new_logo.png");
}

registerDebugCommand("testPNG", testPNG);

//; (window as any).debugTestCRC = crc32
//; (window as any).debugCRCTable = crc32Table.map(e => e.toString(16))
