const bip39_english_str = @embedFile("bip39/english.txt");
const std = @import("std");

// TODO: This implementaiton uses a lot of very large integers. In the future, write some small helper functions that operate on bytes instead and rewrite it. Perhaps benchmark the WASM file as well.

const PassphraseError = error {
    UnknownWord,
    TooFewWords,
    TooManyWords,
    UnmatchingChecksum,
};

fn fillWordList(source: []const u8, into: []u64) void {
    // The reason that we use u64 instead of u32 is that
    // we might want to support Japanese, Chinese, Russian and other word lists
    // in the future.

    const view = std.unicode.Utf8View.init(source) catch @panic("bad utf8");
    var codepoints = view.iterator();
    var index = 0;
    var word: u64 = 0;
    var letters: u32 = 0;
    while (codepoints.nextCodepoint()) |c| {
        switch (c) {
            'a'...'z' => {
                if (letters < 4) {
                    word <<= 16;
                    word |= c;
                    letters += 1;
                }
            },
            ' ', '\n', '\r', '\t' => {
                if (letters != 0) {
                    if (index >= into.len) {
                        @panic("too many words parsed in word list");
                    }
                    into[index] = word;
                    index += 1;
                    word = 0;
                    letters = 0;
                }
            },
            else => @panic("bad character in word list"),
        }
    }
    if (letters != 0) {
        if (index >= into.len) {
            @panic("too many words parsed in word list");
        }
        into[index] = word;
        index += 1;
    }
}

pub const bip39_english_u64 = blk: {
    @setEvalBranchQuota(100_000);
    var words = [_]u64{0} ** 2048;
    fillWordList(bip39_english_str, &words);
    break :blk words;
};

/// AVX-512 registers should be able to handle this.
const max_entropy_bits = 512;
const EntropyInt = std.meta.Int(.unsigned, max_entropy_bits);
pub const max_entropy_bytes = max_entropy_bits / 8;

/// Set to 256 because sha256 generates 256 bits anyway.
/// But 16 bits would technically do for the max of 42 words.
const max_checksum_bits = 256;
const ChecksumInt = std.meta.Int(.unsigned, max_checksum_bits);

const LengthAndChecksum = struct {
    len: u32,
    checksum: u8,
};

pub fn wordsToEntropy(words: []u64, entropy_into: []u8) !LengthAndChecksum {
    defer @memset(words, 0);

    if (words.len < 3) {
        // If we have less than 3, then checksum_len
        // will become 0. But we like our checksums!
        return PassphraseError.TooFewWords;
    }

    // Find all indices for all words.
    for (words) |*word| {
        word.* = std.mem.indexOfScalar(u64, &bip39_english_u64, word.*) orelse return PassphraseError.UnknownWord;
    }

    const checksum_len: u32 = @truncate(words.len / 3);
    const entropy_bits: u32 = @truncate(words.len * 11 - checksum_len);

    // We always round up.
    const entropy_len_bytes = std.math.divCeil(u32, entropy_bits, 8) catch 0;

    if (words.len > 42 or entropy_len_bytes > entropy_into.len) {
        // This ensures that the checksum won't be bigger than max_checksum_bits.
        // And that the length of the entropy won't be bigger than max_entropy_bits.
        // 42 is 12+(3*10), which is already longer than what the serial-num format supports.
        // 42*11 also happens to be larger than 512, current value for max_entropy_bits.
        return PassphraseError.TooManyWords;
    }

    // Create a giant number containing all the indices of the words.
    var entropy_num: EntropyInt = 0;
    for (words) |word| {
        entropy_num <<= 11;
        entropy_num |= word;
    }
    defer entropy_num = 0;

    // Bit-fiddle out the checksum bits.
    var checksum_mask: ChecksumInt = std.math.maxInt(ChecksumInt);
    checksum_mask <<= @truncate(checksum_len);
    checksum_mask = ~checksum_mask;
    const checksum: ChecksumInt = @truncate(entropy_num & checksum_mask);

    // Clear the lower bits of checksum length. Then left-shift the entropy such that
    // the first bit is on the the left-most bit of entropy_num.
    entropy_num >>= @truncate(checksum_len);
    entropy_num <<= @truncate(checksum_len);
    entropy_num <<= @truncate(max_entropy_bits - (words.len * 11));

    // Extract entropy to a byte array so that hashing can be done.
    var entropy: [max_entropy_bytes]u8 = undefined;
    defer @memset(&entropy, 0);

    std.mem.writeInt(EntropyInt, &entropy, entropy_num, .big);


    var hasher = std.crypto.hash.sha2.Sha256.init(.{});
    defer hasher = std.mem.zeroes(std.crypto.hash.sha2.Sha256);

    hasher.update(entropy[0..entropy_len_bytes]);
    const computed_hash = hasher.finalResult();
    const computed_hash_num = std.mem.readInt(ChecksumInt, &computed_hash, .big);
    const computed_checksum = (computed_hash_num >> @truncate(max_entropy_bits - checksum_len)) & checksum_mask;

    if (computed_checksum != checksum) {
        return PassphraseError.UnmatchingChecksum;
    }

    // Move the resulting entropy into the result buffer.
    // We do this last so that the user of this procedure does not have to clear
    // the buffer manually if this procedure returns an error.
    @memset(entropy_into, 0);
    std.mem.copyForwards(u8, entropy_into, entropy[0..entropy_len_bytes]);

    return LengthAndChecksum {
        .len = entropy_len_bytes,
        .checksum = @truncate(computed_checksum),
    };
}

fn indexToWord(index: u32) []const u8 {
    var words_left = index;
    var whitespace = false;
    var length: u32 = 0;
    for (0..bip39_english_str.len) |i| {
        const c = bip39_english_str[i];
        if (std.ascii.isWhitespace(c)) {
            if (!whitespace) {
                if (words_left == 0) {
                    const start = i - length;
                    return bip39_english_str[start..i];
                }
                whitespace = true;
                words_left -= 1;
                length = 0;
            }
        } else {
            whitespace = false;
            length += 1;
        }
    }
    return "";
}

pub fn bytesToWords(writer: std.io.AnyWriter, data: []const u8) !void {
    const data_bits: u32 = @truncate(data.len * 8);
    const data_word_count: u32 = data_bits / 11;

    var data_bytes = [_]u8{0} ** max_entropy_bytes;
    defer @memset(&data_bytes, 0);

    std.mem.copyForwards(u8, &data_bytes, data);

    var data_num = std.mem.readInt(EntropyInt, &data_bytes, .big);
    defer data_num = 0;

    for(0..data_word_count) |i| {
        const high_word = data_num & (0b1_11111_11111 << (max_entropy_bits - 11));

        const word: u32 = @truncate(high_word >> @truncate((max_entropy_bits - 11)));

        _ = try writer.write(indexToWord(word));
        if (i + 1 != data_word_count) {
            _ = try writer.write(" ");
        }
        data_num <<= 11;
    }
}

pub fn setChecksumBits(from: []const u8, into: *[max_entropy_bytes]u8) LengthAndChecksum {
    @memset(into, 0);

    const input_bits: u32 = @truncate(from.len * 8);
    const min_input_words = input_bits / 11;
    //std.debug.print("input_bits: {d}\n", .{input_bits});
    const total_words = min_input_words + (3 - (min_input_words % 3)) % 3;
    //std.debug.print("total_words: {d}\n", .{total_words});
    const total_bits = total_words * 11;
    //std.debug.print("total_bits: {d}\n", .{total_bits});
    const total_bytes = std.math.divCeil(u32, total_bits, 8) catch 0;

    const checksum_len: u32 = total_bits / 33;
    //std.debug.print("checksum_len: {d}\n", .{checksum_len});
    const entropy_bits: u32 = @truncate(total_bits - checksum_len);

    // We always round up.
    const entropy_len_bytes = std.math.divCeil(u32, entropy_bits, 8) catch 0;

    // Clear the lower 11 bits of the entropy.
    var unclean_bytes = [_]u8{0} ** max_entropy_bytes;
    defer @memset(&unclean_bytes, 0);

    std.mem.copyForwards(u8, &unclean_bytes, from);

    var entropy_num = std.mem.readInt(EntropyInt, &unclean_bytes, .big);
    defer entropy_num = 0;

    //std.debug.print("entropy_num before shifts: {x}\nentropy_bits: {d}\n", .{entropy_num, entropy_bits});
    //std.debug.print("move by: {d}\n", .{max_entropy_bits - entropy_bits});
    entropy_num >>= @truncate(max_entropy_bits - entropy_bits);
    entropy_num <<= @truncate(max_entropy_bits - entropy_bits);

    // Write it out to bytes again such that the hasher may use it.
    // TODO: The step here and the steps above could be removed if we could clear N number  of bits from unclean_bytes directly without conversion.
    var cleared_entropy_bytes = [_]u8{0} ** max_entropy_bytes;
    defer @memset(&cleared_entropy_bytes, 0);

    std.mem.writeInt(EntropyInt, &cleared_entropy_bytes, entropy_num, .big);

    // Figure out the mask that only contains checksum_len amount of bits.
    var checksum_mask: ChecksumInt = std.math.maxInt(ChecksumInt);
    checksum_mask <<= @truncate(checksum_len);
    checksum_mask = ~checksum_mask;

    var hasher = std.crypto.hash.sha2.Sha256.init(.{});
    defer hasher = std.mem.zeroes(std.crypto.hash.sha2.Sha256);
    hasher.update(cleared_entropy_bytes[0..entropy_len_bytes]);
    const computed_hash = hasher.finalResult();
    const computed_hash_num = std.mem.readInt(ChecksumInt, &computed_hash, .big);
    const computed_checksum: EntropyInt = (computed_hash_num >> @truncate(max_entropy_bits - checksum_len)) & checksum_mask;

    // Reason for this not being constant is that we want to defer clear it after writing it to byte form.
    var merge_entropy_and_checksum = entropy_num | (computed_checksum << @truncate(max_entropy_bits - entropy_bits - checksum_len));
    defer merge_entropy_and_checksum = 0;

    //std.debug.print("entropy: {x} with bits: {b}\n", .{entropy_num, entropy_num});
    //std.debug.print("checksum num: {x}\n", .{computed_hash_num});
    //std.debug.print("checksum: {x} with mask: {b} with bits {b}\n", .{computed_checksum, checksum_mask, computed_checksum});
    //std.debug.print("merged: {x} with bits {b}\n", .{merge_entropy_and_checksum, merge_entropy_and_checksum});
    std.mem.writeInt(EntropyInt, into, merge_entropy_and_checksum, .big);

    //std.debug.print("total bytes: {d}\n", .{total_bytes});
    //std.debug.print("last byte: {x}\n", .{into[total_bytes - 1]});

    return LengthAndChecksum {
        .len = total_bytes,
        .checksum = @truncate(computed_checksum),
    };
}

// TODO: Is this useful?
//fn word_index(word: []const u8) usize {
//    // This code could be changed into something which does
//    // not require a linear search into the word-list. But performance
//    // is not an issue as the list is short,
//    // so not worth adding the complexity of doing so.
//
//    var index: usize = 0;
//    var line: usize = 0;
//    var matches = true;
//    for (bip39_english_str) |c| {
//        if (c == '\n') {
//            if (matches and index == word.len) {
//                return line;
//            }
//            line += 1;
//            index = 0;
//            matches = true;
//        } else if (index < word.len and c == word[index]) {
//            index += 1;
//        } else if (c != '\r') {
//            matches = false;
//            index += 1;
//        }
//    }
//
//    return line - 1;
//}

fn strToU64(comptime word: []const u8) u64 {
    var result: u64 = 0;
    for (word[0..@min(word.len, 4)]) |c| {
        result <<= 16;
        result |= c;
    }
    return result;
}

test "english word to index u64" {
    const abandon = strToU64("abandon");
    const ability = strToU64("ability");
    const two = strToU64("two");

    // Make sure that strToU64 works as expected.
    try std.testing.expectEqual(('a' << 16 * 3) | ('b' << 16 * 2) | ('a' << 16) | ('n'), abandon);
    try std.testing.expectEqual(('a' << 16 * 3) | ('b' << 16 * 2) | ('i' << 16) | ('l'), ability);
    try std.testing.expectEqual(('t' << 16 * 2) | ('w' << 16) | ('o'), two);

    // Must exist.
    try std.testing.expectEqual(std.mem.indexOfScalar(u64, &bip39_english_u64, abandon), 0);
    try std.testing.expectEqual(std.mem.indexOfScalar(u64, &bip39_english_u64, ability), 1);
    try std.testing.expectEqual(std.mem.indexOfScalar(u64, &bip39_english_u64, two), 1885);
    try std.testing.expectEqual(std.mem.indexOfScalar(u64, &bip39_english_u64, strToU64("bike")), 177);
    try std.testing.expectEqual(std.mem.indexOfScalar(u64, &bip39_english_u64, strToU64("zoo")), 2047);

    try std.testing.expectEqual(std.mem.indexOfScalar(u64, &bip39_english_u64, strToU64("forest")), 729);

    // Doesn't exist.
    try std.testing.expectEqual(std.mem.indexOfScalar(u64, &bip39_english_u64, strToU64("mint")), null);

    // Should not exist.
    try std.testing.expectEqual(std.mem.indexOfScalar(u64, &bip39_english_u64, 0), null);
    try std.testing.expectEqual(std.mem.indexOfScalar(u64, &bip39_english_u64, strToU64("a")), null);
}

test "english index to word" {
    // Should exist
    try std.testing.expectEqualStrings("abandon", indexToWord(0));
    try std.testing.expectEqualStrings("ability", indexToWord(1));
    try std.testing.expectEqualStrings("bike", indexToWord(177));
    try std.testing.expectEqualStrings("two", indexToWord(1885));
    try std.testing.expectEqualStrings("zoo", indexToWord(2047));
    try std.testing.expectEqualStrings("forest", indexToWord(729));

    // Should not exist.
    try std.testing.expectEqualStrings("", indexToWord(9001));
}

test "bytes to words" {
    const entropy_bytes = "\x4d\xf5\x95\x6e\x0f\x9c\xe8\x26\x2c\x80\xbb\x19\x4d\xf8\x7f\xb8\x5c\xcb\x13\x81\xaf\xf8\x8f\x6a\xcb\xed\x97\x8d\x72\xfb\xfd\x70\x17";
    var output = [_]u8{0} ** 256;
    var writer = std.io.fixedBufferStream(&output);
    try bytesToWords(writer.writer().any(), entropy_bytes);
    try std.testing.expectEqualStrings("evil protect fortune busy soldier basic rare blast bone hurt cable idle smile mean allow yellow month film window congress strong law volume actual", output[0..writer.pos]);
}

test "generate checksum for entropy" {
    const entropy_bytes = "\x4d\xf5\x95\x6e\x0f\x9c\xe8\x26\x2c\x80\xbb\x19\x4d\xf8\x7f\xb8\x5c\xcb\x13\x81\xaf\xf8\x8f\x6a\xcb\xed\x97\x8d\x72\xfb\xfd\x70\x99";
    //std.debug.print("entropy: {d}\n", .{entropy_bytes.len});
    var output_bytes: [64]u8 = undefined;
    const len_and_sum = setChecksumBits(entropy_bytes, &output_bytes);
    const output = output_bytes[0..len_and_sum.len];
    const good_bytes = "\x4d\xf5\x95\x6e\x0f\x9c\xe8\x26\x2c\x80\xbb\x19\x4d\xf8\x7f\xb8\x5c\xcb\x13\x81\xaf\xf8\x8f\x6a\xcb\xed\x97\x8d\x72\xfb\xfd\x70\x17";
    try std.testing.expectEqualStrings(good_bytes, output);
}

fn expectBytesToWord(input: []const u8, expected_passphrase: []const u8) !void {
    var output_bytes: [64]u8 = undefined;
    const len_and_sum = setChecksumBits(input, &output_bytes);
    const output = output_bytes[0..len_and_sum.len];

    var output_text = [_]u8{0} ** 1024;
    var writer = std.io.fixedBufferStream(&output_text);
    try bytesToWords(writer.writer().any(), output);
    try std.testing.expectEqualStrings(expected_passphrase, output_text[0..writer.pos]);
}

test "generate small passphrase" {
    try expectBytesToWord("\x12\x34\x56\x78", "banana pencil owner");
    try expectBytesToWord("\x03\x03\x03\x00", "adapt blossom scan");
    try expectBytesToWord("\x11\x22\x33\x44\x55\x66\x77", "bachelor bag speed print guess leopard");
    try expectBytesToWord("\x11\x22\x33\x44\x55\x66\x77\x88\x99\xAA\xBB\x00", "bachelor bag speed print guess session grit first able");
    try expectBytesToWord("\x11\x22\x33\x44\x55\x66\x77\x88\x99\xAA\xBB\xCC\xDD\xEE\xFF\x00", "bachelor bag speed print guess session grit first smoke urge save abuse");
    try expectBytesToWord("\x11\x22\x33\x44\x55\x66\x77\x88\x99\xAA\xBB\xCC\xDD\xEE\xFF\x00\x11\x22\x33\x44\x55\x66\x77\x88\x99\xAA\xBB\xCC\xDD\xEE\xFF\x00", "bachelor bag speed print guess session grit first smoke urge save ability banana boost bacon proud jealous dynamic height jealous soccer wash winter arrange");
    try expectBytesToWord("\x44\x55\x66\x77\x88\x99\xAA\xBB\xCC\xDD\xEE\xFF\x00\x11\x22\x33\x44\x55\x66\x77\x88\x99\xAA\xBB\xCC\xDD\xEE\xFF\x00\x11\x22\x33\x44\x55\x66\x77\x88\x99\xAA\xBB\xCC\xDD\xEE\xFF\x00\x11\x22\x33\x44\x55\x66\x77\x88\x99\xAA\xBB", "dust private over bachelor one fuel cricket saddle yellow above embrace grief earn rebel taste basket primary taxi danger target useless ancient match hammer fever crisp timber crew produce toy jeans that abandon math mimic master filter design carbon crystal robust squeeze");
}

fn expectWordsToEntropy(input: []const u64, expected_entropy: []const u8) !void {
    var input_words: [42]u64 = undefined;
    std.mem.copyForwards(u64, &input_words, input);
    var output_bytes: [64]u8 = undefined;
    const result = try wordsToEntropy(input_words[0..input.len], &output_bytes);
    try std.testing.expectEqualStrings(expected_entropy, output_bytes[0..result.len]);
}

test "words to bytes" {
    try expectWordsToEntropy(&.{strToU64("banana"), strToU64("pencil"), strToU64("owner")}, "\x12\x34\x56\x78");
    try expectWordsToEntropy(&.{strToU64("adapt"), strToU64("blossom"), strToU64("scan")}, "\x03\x03\x03\x00");
    try expectWordsToEntropy(&.{strToU64("bachelor"),
                                strToU64("bag"),
                                strToU64("speed"),
                                strToU64("print"),
                                strToU64("guess"),
                                strToU64("leopard")}, "\x11\x22\x33\x44\x55\x66\x77\x00");
    try expectWordsToEntropy(&.{strToU64("bachelor"),
                                strToU64("bag"),
                                strToU64("speed"),
                                strToU64("print"),
                                strToU64("guess"),
                                strToU64("session"),
                                strToU64("grit"),
                                strToU64("first"),
                                strToU64("able")}, "\x11\x22\x33\x44\x55\x66\x77\x88\x99\xAA\xBB\x00");

}
