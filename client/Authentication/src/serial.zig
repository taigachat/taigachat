const std = @import("std");
const passphrase = @import("passphrase.zig");
const super = @import("super.zig");

const serial_log = std.log.scoped(.serial);

var report_missmatch = true;

// Each day is divided into three
const SECONDS_PER_TIMESTAMP_UNIT = 28800;

// Year 0
const TIMESTAMP_UNIT_OFFSET = 59100;

const SerialNumberError = error {
    IncompleteSerial,
    BadVersion,
    BadTimestamp,
    BadWordList,
    BadPasswordHash,
    BadChecksum,
    TooLongPassphrase,
    TooShortPassphrase,
    UnmatchingSerialChecksum,
};

/// vvtt tttt t9ww hhcc
const SerialStage = enum {
    version1,
    version2,
    timestamp,
    lang1,
    lang2,
    hash1,
    hash2,
    checksum1,
    checksum2,
    word,
};

fn calculateSerialChecksum(username: []const u8, version: u32, timestamp: u64, word_list: u32, hash: u32, passphrase_checksum: u16) u32 {
    //std.debug.print("calculateSerialChecksum {s} {d} {d} {d} {d} {d}\n", .{username, version, timestamp, word_list, hash % 100, passphrase_checksum});

    const checksum_data = [_]u8{
        @truncate(version),
        @truncate(timestamp),
        @truncate(word_list),
        @truncate(hash % 100),
        @truncate(passphrase_checksum),
        @truncate(passphrase_checksum >> 8),
    };
    var hasher = std.crypto.hash.sha2.Sha256.init(.{});
    hasher.update(&checksum_data);
    hasher.update(username);
    const hasher_result = hasher.finalResult();
    return @as(u32, @intCast(hasher_result[0])) % 100;

}

const SerialInfo = struct {
    timestamp: u64,
    len: u32,
    hash: u32,
};

pub fn serialAndPassphraseToSeed(username: []const u8, serial_and_passphrase: []const u8, entropy_into: []u8) !SerialInfo {
    const view = try std.unicode.Utf8View.init(serial_and_passphrase);
    var codepoints = view.iterator();

    var state = SerialStage.version1;
    var version: u32 = 0;
    var passphrase_length: u32 = 0;
    var timestamp: u64 = 0;
    var word_list: u32 = 0;
    var hash: u32 = 0;
    var checksum: u32 = 0;

    // We make sure that if we can an early return, words will still be cleared.
    // Despite wordsToEntropy() not running.
    var words = [_]u64{0} ** 64;
    defer @memset(&words, 0);

    var letters: u32 = 0;
    var index: u32 = 0;

    while (codepoints.nextCodepoint()) |c| {
        switch (state) {
            .version1, .version2 => {
                switch (c) {
                    '0'...'9' => {
                        version = version * 10 + (c - '0');
                        if (state == .version1) {
                            state = .version2;
                        } else  {
                            state = .timestamp;
                            switch (version) {
                                0...4 => passphrase_length = 12 + version * 3,
                                else => return SerialNumberError.BadVersion,
                            }
                        }
                    },
                    '-', ' ', '\n', '\r', '\t' => {},
                    else => return SerialNumberError.BadVersion,
                }
            },
            .timestamp => {
                switch (c) {
                    '0'...'7' => {
                        timestamp *= 8;
                        timestamp += (c - '0');
                    },
                    '9' => {
                        state = .lang1;
                    },
                    '-', ' ', '\n', '\r', '\t' => {},
                    else => return SerialNumberError.BadTimestamp,
                }
            },
            .lang1, .lang2 => {
                switch (c) {
                    '0'...'9' => {
                        word_list = word_list * 10 + (c - '0');
                        if (state == .lang1) {
                            state = .lang2;
                        } else  {
                            state = .hash1;
                            // English word list has code 00.
                            // Which is the only one supported currently.
                            if (word_list != 0) {
                                return SerialNumberError.BadWordList;
                            }
                        }
                    },
                    '-', ' ', '\n', '\r', '\t' => {},
                    else => return SerialNumberError.BadWordList,
                }
            },
            .hash1, .hash2 => {
                switch (c) {
                    '0'...'9' => {
                        hash = hash * 10 + (c - '0');
                        state = if (state == .hash1) .hash2 else .checksum1;
                    },
                    '-', ' ', '\n', '\r', '\t' => {},
                    else => return SerialNumberError.BadPasswordHash,
                }
            },
            .checksum1, .checksum2 => {
                 switch (c) {
                    '0'...'9' => {
                        checksum = checksum * 10 + (c - '0');
                        state = if (state == .checksum1) .checksum2 else .word;
                    },
                    '-', ' ', '\n', '\r', '\t' => {},
                    else => return SerialNumberError.BadChecksum,
                }
            },
            .word => {
                switch (c) {
                    'a'...'z' => {
                        if (letters < 4) {
                            words[index] <<= 16;
                            words[index] |= c;
                            letters += 1;
                        }
                    },
                    '-', ' ', '\n', '\r', '\t' => {
                        if (letters != 0) {
                            if (index >= words.len) {
                                @panic("too many words parsed in word list");
                            }
                            index += 1;
                            letters = 0;
                        }
                    },
                    else => @panic("bad character in word list"),
                }
            }
        }
    }

    if (letters != 0) {
        if (index >= words.len) {
            @panic("too many words parsed in word list");
        }
        index += 1;
        letters = 0;
    }

    if (state != .word) {
        return SerialNumberError.IncompleteSerial;
    }

    if (index > passphrase_length) {
        return SerialNumberError.TooLongPassphrase;
    }
    if (index < passphrase_length) {
        return SerialNumberError.TooShortPassphrase;
    }

    const passphrase_result = try passphrase.wordsToEntropy(words[0..index], entropy_into);

    const computed_checksum = calculateSerialChecksum(username, version, timestamp, word_list, hash, passphrase_result.checksum);

    if (computed_checksum != checksum) {
        if (report_missmatch) {
            serial_log.err("expected checksum {d} but got {d}", .{computed_checksum, checksum});
        }
        return SerialNumberError.UnmatchingSerialChecksum;
    }

    return SerialInfo {
        .len = passphrase_result.len,
        .hash = hash,

        // Convert to approximate UNIX seconds.
        .timestamp = (timestamp + TIMESTAMP_UNIT_OFFSET) * SECONDS_PER_TIMESTAMP_UNIT,
    };
}

pub fn secondsToTimestampUnit(seconds: u64) u64 {
    // TODO: Perhaps overflow check this?
    return (seconds / SECONDS_PER_TIMESTAMP_UNIT) - TIMESTAMP_UNIT_OFFSET;
}

fn writeSerial(output_writer: std.io.AnyWriter, username: []const u8, password_hash: u32, word_count: u64, timestamp: u64, passphrase_checksum: u16) !void {
    if (word_count < 12) {
        return SerialNumberError.TooShortPassphrase;
    }
    if (word_count > 24) {
        return SerialNumberError.TooLongPassphrase;
    }
    var bytes: [64]u8 = undefined;
    var stream = std.io.fixedBufferStream(&bytes);
    var writer = stream.writer().any();

    const version: u32 = @truncate((word_count - 12) / 3);
    const word_list = 0; // The english word list.

    const scaled_timestamp = secondsToTimestampUnit(timestamp);

    const checksum = calculateSerialChecksum(username, version, scaled_timestamp, word_list, password_hash, passphrase_checksum);

    try writer.print("{d:0>2}", .{version});
    try writer.print("{o}9", .{scaled_timestamp});
    try writer.print("{d:0>2}", .{word_list});
    try writer.print("{d:0>2}", .{password_hash % 100});
    try writer.print("{d:0>2}", .{checksum});

    for (bytes[0..stream.pos], 0..) |byte, i| {
        try output_writer.writeByte(byte);
        if (stream.pos - i >= 4 and i % 4 == 3) {
            try output_writer.writeByte(' ');
        }
    }
}

pub fn generateSerialAndPassphrase(allocator: std.mem.Allocator, writer: std.io.AnyWriter, username: []const u8, password: []const u8, rand: std.rand.Random, word_count: u32, timestamp: u64) !void {
    var password_hash: [super.max_super_password_hash_len]u8 = undefined;
    try super.hashSuperPassword(allocator, username, password, secondsToTimestampUnit(timestamp), &password_hash);
    const last_byte = password_hash[password_hash.len - 1];

    var bytes: [passphrase.max_entropy_bytes]u8 = undefined;
    defer @memset(&bytes, 0);
    rand.bytes(&bytes);

    const byte_len = std.math.divCeil(u32, word_count * 11, 8) catch 0;

    var checksummed: [passphrase.max_entropy_bytes]u8 = undefined;
    defer @memset(&checksummed, 0);
    const len_and_sum = passphrase.setChecksumBits(bytes[0..byte_len], &checksummed);

    try writeSerial(writer, username, last_byte, word_count, timestamp, len_and_sum.checksum);
    try writer.writeByte(' ');

    try passphrase.bytesToWords(writer, checksummed[0..len_and_sum.len]);
}

test "parse serial errors" {
    report_missmatch = false;
    defer report_missmatch = true;
    var entropy: [246]u8 = undefined;
    try std.testing.expectError(SerialNumberError.IncompleteSerial, serialAndPassphraseToSeed("Dad", "", &entropy));
    try std.testing.expectError(SerialNumberError.BadVersion, serialAndPassphraseToSeed("Dad", "99", &entropy));
    try std.testing.expectError(SerialNumberError.BadTimestamp, serialAndPassphraseToSeed("Dad", "038", &entropy));
    try std.testing.expectError(SerialNumberError.BadWordList, serialAndPassphraseToSeed("Dad", "039 44", &entropy));
    try std.testing.expectError(SerialNumberError.BadPasswordHash, serialAndPassphraseToSeed("Dad", "039 00R", &entropy));
    try std.testing.expectError(SerialNumberError.BadChecksum, serialAndPassphraseToSeed("Dad", "039 0033C", &entropy));
    try std.testing.expectError(SerialNumberError.TooShortPassphrase, serialAndPassphraseToSeed("Dad", "039 003111", &entropy));
    try std.testing.expectError(SerialNumberError.TooLongPassphrase, serialAndPassphraseToSeed("Dad", "009 003111 a a a a a a a a a a a a a a a a a a a a", &entropy));
}

test "parse serial passphrase errors" {
    report_missmatch = false;
    defer report_missmatch = true;
    var entropy: [246]u8 = undefined;
    try std.testing.expectError(SerialNumberError.UnmatchingSerialChecksum, serialAndPassphraseToSeed("Dad", "0416 4533 4900 1240 evil protect fortune busy soldier basic rare blast bone hurt cable idle smile mean allow yellow month film window congress strong law volume actual", &entropy));
    try std.testing.expectError(SerialNumberError.UnmatchingSerialChecksum, serialAndPassphraseToSeed("Dad", "0416 4533 4900 0240 outdoor worth inspire case maid mystery bind charge fiber voyage tiger glory wild quote thrive muscle prevent keen return inquiry owner vault people idea", &entropy));
    try std.testing.expectError(error.UnmatchingChecksum, serialAndPassphraseToSeed("Dad", "0416 4533 4900 0239 protect protect fortune busy soldier basic rare blast bone hurt cable idle smile mean allow yellow month film window congress strong law volume actual", &entropy));
}

test "parse serial good" {
    var entropy: [246]u8 = undefined;
    const expected_entropy = "\x4d\xf5\x95\x6e\x0f\x9c\xe8\x26\x2c\x80\xbb\x19\x4d\xf8\x7f\xb8\x5c\xcb\x13\x81\xaf\xf8\x8f\x6a\xcb\xed\x97\x8d\x72\xfb\xfd\x70";
    try std.testing.expectEqual(15466060800, (try serialAndPassphraseToSeed("Dad", "0416 4533 4900 0233 evil protect fortune busy soldier basic rare blast bone hurt cable idle smile mean allow yellow month film window congress strong law volume actual", &entropy)).timestamp);
    try std.testing.expectEqualStrings(expected_entropy, entropy[0..32]);
    try std.testing.expectEqual(15466060800, (try serialAndPassphraseToSeed("Dad",
            \\04164533
            \\4900 0233 evil protect fortune
            \\busy soldier basic rare
            \\blast      bone hurt cable
            \\idle smile mean allow yellow month film
            \\window congress strong law volume actual
            , &entropy)).timestamp);
    try std.testing.expectEqualStrings(expected_entropy, entropy[0..32]);
}

test "generate serial and passphrase" {
    var bytes: [256]u8 = undefined;
    var stream = std.io.fixedBufferStream(&bytes);
    const writer = stream.writer().any();
    var random = std.rand.Xoshiro256.init(0);
    try generateSerialAndPassphrase(std.testing.allocator, writer, "Mr. Europe", "Winner", random.random(), 12, SECONDS_PER_TIMESTAMP_UNIT * TIMESTAMP_UNIT_OFFSET);

    //std.debug.print("serial: {s}\n", .{bytes[0..stream.pos]});

    var entropy: [passphrase.max_entropy_bytes]u8 = undefined;
    try std.testing.expectEqual(SECONDS_PER_TIMESTAMP_UNIT * TIMESTAMP_UNIT_OFFSET, (try serialAndPassphraseToSeed("Mr. Europe", bytes[0..stream.pos], &entropy)).timestamp);

    report_missmatch = false;
    try std.testing.expectError(SerialNumberError.UnmatchingSerialChecksum, serialAndPassphraseToSeed("Mr. America", bytes[0..stream.pos], &entropy));
    report_missmatch = true;
}
