const std = @import("std");

/// This file contains code for generating the super password.
/// It has been moved into its own file because serial generation
/// is also interested in computing this.

/// The amount of bytes worth of hash that will be created by the super password.
/// Note that only a select few of these are used later on. The last byte is also put inside of the
/// password.
pub const max_super_password_hash_len = 64;

/// Creates the super password.
pub fn hashSuperPassword(allocator: std.mem.Allocator, username: []const u8, password: []const u8, timestamp: u64, hash_into: *[max_super_password_hash_len]u8) !void {
    const super_password = try std.fmt.allocPrint(allocator, 
                                                "tIDk{s}{s}{d}",
                                                .{password, username, timestamp});
    defer { @memset(super_password, 0); allocator.free(super_password); }

    try std.crypto.pwhash.argon2.kdf(allocator,
                                     hash_into,
                                     super_password,
                                     "TaigaIdentitySeed",
                                     std.crypto.pwhash.argon2.Params.moderate_2id,
                                     std.crypto.pwhash.argon2.Mode.argon2id);
}
