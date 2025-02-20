const std = @import("std");
const builtin = @import("builtin");
const auth = @import("./auth.zig");
const serial = @import("./serial.zig");

pub const std_options = .{
    .log_level = .info,
    .logFn = if (builtin.target.cpu.arch == .wasm32) wasmLog else std.log.defaultLog,
};

fn wasmLog(comptime level: std.log.Level,
           comptime scope: @TypeOf(.EnumLiteral),
           comptime format: []const u8,
           args: anytype) void {
    _ = level;
    _ = scope;
    _ = format;
    _ = args;
    // TODO: Maybe make it work.
}

// TODO: Remove big_buf_len as 512 is more than enough for passphrase now that 42 words (9 bytes at max) has been decided upon as the max.
const big_buf_len = 2048;

// TODO: Add a short CRC password check so that we do not have to wait so long until
// saying "incorrect password". This CRC would contain much less bytes than the password
// itself of course. I am thinking maybe 1 bytes worth of CRC? Passwords would
// have to be enforced to be much longer than 3 bytes... But of course that is just
// good practice in general.
//
// TODO: Actually a CRC of the password would be bad. We are slashing the necessary searches
// by a lot. But doing password.len modulo 3 would be very good. Since that would protect us
// from fat-fingering while typing the password. And at the same time not leak any important info.

const BufferUseCase = enum(u8) {
    username = 0,
    password = 1,
    serial_and_passphrase = 2,
    nonce = 3,
};

const CommandStatus = error {
    // Stages:
    Unused,
    InProgress,
    Done,
    Read,
    Freed,

    // Actual errors:
    BufferUsedTooEarly,
    CorruptedMemory,
    UnusedBuffer,
    InputAlreadyConsumed,
    InputNotDefined,
};

const Command = struct {
    // TODO: max output length can be something much smaller.
    output: [big_buf_len]u8,
    inputs: std.EnumArray(BufferUseCase, ?[]u8),
    inputs_used: std.EnumArray(BufferUseCase, bool),
    status: anyerror,
    output_len: usize,
    magic: u16,

    fn check_sanity(self: *Command) CommandStatus!void {
        if (self.magic != 2002) {
            return CommandStatus.CorruptedMemory;
        }
    }

    fn use_buffer(self: *Command, use_case: BufferUseCase) ![]u8 {
        try self.check_sanity();
        if (self.status != CommandStatus.InProgress) {
            return CommandStatus.BufferUsedTooEarly;
        }
        if (self.inputs_used.get(use_case)) {
            return CommandStatus.InputAlreadyConsumed;
        }
        if (self.inputs.get(use_case)) |mem| {
            self.inputs_used.set(use_case, true);
            //std.debug.print("reading: {any}\n", .{use_case});
            if (mem[0] != 42 or mem[mem.len - 1] != 42) {
                return CommandStatus.CorruptedMemory;
            }

            return mem[1..mem.len - 1];
        }
        return CommandStatus.InputNotDefined;
    }

    fn finalize(self: *Command) i32 {
        var memory_corrupted: u1 = 0; // TODO: Perhaps it is best if this is a global variable? Could be used to lock down everything
        for(self.inputs.values, self.inputs_used.values) |m, used| {
            if (m) |mem| {
                if (!used and self.status == CommandStatus.Done) {
                    //std.debug.print("unused was: {d}", .{i});
                    self.status = CommandStatus.UnusedBuffer;
                }
                memory_corrupted |= @intFromBool(mem[0] != 42 and mem[mem.len - 1] != 42);
                @memset(mem, 33);
                if (memory_corrupted == 0) {
                    allocator.free(mem);
                }
            }
        }
        if (memory_corrupted == 1 or self.magic != 2002 or self.output_len > self.output_len) {
            self.status = CommandStatus.CorruptedMemory;
        }

        if (self.status != CommandStatus.Done) {
            @memset(&self.output, 0);
            const error_text = @errorName(self.status);
            std.mem.copyForwards(u8, &self.output, error_text);
            const len: i32 = @intCast(error_text.len);
            return -len;
        }

        return @intCast(self.output_len);

    }
};


var gpa = std.heap.GeneralPurposeAllocator(.{}){};
const allocator = blk: {
    if (builtin.is_test) {
        break :blk std.testing.allocator;
    } else if (builtin.target.cpu.arch == .wasm32) {
        break :blk std.heap.wasm_allocator;
    } else {
        break :blk gpa.allocator();
    }
};

fn nonRandomNumberGenerator(_: *anyopaque, buf: []u8) void {
    @memset(buf, 42);
}

const random_gen = blk: {
    if (builtin.is_test) {
        break :blk std.rand.Random {
            .ptr = undefined,
            .fillFn = nonRandomNumberGenerator,
        };
    } else if (builtin.target.cpu.arch == .wasm32) {
        const WasmGen = struct {
            extern "env" fn gen_crypto_numbers(buf: [*]u8, len: usize) void;
            fn number_fill(_: *anyopaque, buf: []u8) void {
                gen_crypto_numbers(buf.ptr, buf.len);
            }
        };

        break :blk std.rand.Random {
            .ptr = undefined,
            .fillFn = WasmGen.number_fill,
        };
    } else {
        break :blk std.crypto.random;
    }
};

export fn createCommand() ?*Command {
    var cmd = allocator.create(Command) catch return null;
    @memset(&cmd.output, 0);
    @memset(&cmd.inputs.values, null);
    @memset(&cmd.inputs_used.values, false);
    cmd.status = CommandStatus.Unused;
    cmd.magic = 2002;
    cmd.output_len = 0;

    return cmd;
}

export fn addCommandInput(cmd: *Command, use_case: BufferUseCase, len: usize) ?[*]u8 {
    cmd.check_sanity() catch return null;
    if (cmd.status != CommandStatus.Unused) {
        return null;
    }
    if (cmd.inputs.get(use_case)) |_| {
        return null;
    }

    const mem = allocator.alloc(u8, len + 2) catch return null;
    @memset(mem, 0);
    mem[0] = 42;
    mem[len + 1] = 42;
    cmd.inputs.set(use_case, mem);
    return mem.ptr + 1;
}

export fn readCommand(cmd: ?*Command) ?[*]u8 {
    if (cmd) |c| {
        if (c.magic != 2002) {
            @panic("attempting to free command with invalid magic number");
        }
        if (c.status == CommandStatus.InProgress) {
            return null;
        }
        c.status = CommandStatus.Read;
        return &c.output;
    }
    return null;
}

export fn freeCommand(cmd: ?*Command) void {
    if (cmd) |c| {
        if (c.magic != 2002) {
            @panic("attempting to free command with invalid magic number");
        }
        if (c.status == CommandStatus.Freed) {
            @panic("freeCommand(cmd) was called twice on cmd");
        }
        c.status = CommandStatus.Freed;
        allocator.destroy(c);
    }
}

// TODO: Add a "nonce" that is just a u64...
export fn generateProofForCentral(cmd: *Command, timestamp: u64, salt: u64) i32 {
    cmd.status = CommandStatus.InProgress;
    cmd.status = s: {
        const username = cmd.use_buffer(.username) catch |e| break :s e;
        const password = cmd.use_buffer(.password) catch |e| break :s e;

        cmd.output_len = auth.generateProofForCentral(allocator,
                                                      &cmd.output,
                                                      username,
                                                      password,
                                                      timestamp,
                                                      salt) catch |e| break :s e;
        break :s CommandStatus.Done;
    };
    return cmd.finalize();
}

// Note that this command will only give you a hash. Not the entire fingerprint.
// We append the rest outside of the WASM code.
export fn generateEndToEndKeyFingerprint(cmd: *Command) i32 {
    cmd.status = CommandStatus.InProgress;
    cmd.status = s: {
        // We get salt from the username parameter. This might seem strange.
        // But we just do not want to confuse other commands by having salt be both a string
        // and a u64. That would be strange.
        const salt = cmd.use_buffer(.username) catch |e| break :s e;
        const password = cmd.use_buffer(.password) catch |e| break :s e;

        cmd.output_len = auth.generateEndToEndKeyFingerprint(allocator,
                                                             &cmd.output,
                                                             salt,
                                                             password) catch |e| break :s e;
        break :s CommandStatus.Done;
    };
    return cmd.finalize();
}

export fn generateEndToEndKey(cmd: *Command) i32 {
    cmd.status = CommandStatus.InProgress;
    cmd.status = s: {
        // We get salt from the username parameter. This might seem strange.
        // But we just do not want to confuse other commands by having salt be both a string
        // and a u64. That would be strange.
        const salt = cmd.use_buffer(.username) catch |e| break :s e;
        const password = cmd.use_buffer(.password) catch |e| break :s e;

        cmd.output_len = auth.generateEndToEndKey(allocator,
                                                  &cmd.output,
                                                  salt,
                                                  password) catch |e| break :s e;
        break :s CommandStatus.Done;
    };
    return cmd.finalize();
}

export fn generateEcdsaIdentityKey(cmd: *Command) i32 {
    cmd.status = CommandStatus.InProgress;
    cmd.status = s: {
        const username = cmd.use_buffer(.username) catch |e| break :s e;
        const password = cmd.use_buffer(.password) catch |e| break :s e;
        const serial_and_passphrase = cmd.use_buffer(.serial_and_passphrase) catch |e| break :s e;

        cmd.output_len = auth.generateEcdsaIdentityKey(allocator,
                                                       username,
                                                       password,
                                                       serial_and_passphrase,
                                                       &cmd.output) catch |e| break :s e;
        break :s CommandStatus.Done;
    };
    return cmd.finalize();
}

export fn generateSerialAndPassphrase(cmd: *Command, word_count: u32, timestamp: u64) i32 {
    cmd.status = CommandStatus.InProgress;
    cmd.status = s: {
        const username = cmd.use_buffer(.username) catch |e| break :s e;
        const password = cmd.use_buffer(.password) catch |e| break :s e;

        var stream = std.io.fixedBufferStream(&cmd.output);
        const writer = stream.writer().any();

        serial.generateSerialAndPassphrase(allocator, writer, username, password, random_gen, word_count, timestamp) catch |e| break :s e;
        cmd.output_len = stream.pos;

        break :s CommandStatus.Done;
    };
    return cmd.finalize();
}

/// This procedure only makes sense when running on WASM.
export fn wasmHandshake() void {
    if (builtin.target.cpu.arch == .wasm32) {
        const WasmHandshaker = struct {
            extern "env" fn handle_input_name(name: [*:0]const u8, len: usize, value: usize) void;
            extern "env" fn warn_debug_build() void;
        };
        inline for (@typeInfo(BufferUseCase).Enum.fields) |field| {
            WasmHandshaker.handle_input_name(field.name.ptr, field.name.len, field.value);
        }
        if (builtin.mode == .Debug) {
            WasmHandshaker.warn_debug_build();
        }
    }
}

fn nullTerminatedOrPanic(buffer: []u8) []u8 {
    // TODO: There exists a duplicate of this code in auth.zig. Fix that.
    return buffer[0..std.mem.indexOfScalar(u8, buffer, 0) orelse @panic("overfilled buffer in test")];
}

fn fillHardBuffer(command: ?*Command, use_case: BufferUseCase, with: []const u8) void {
    if (command) |c| {
        const mem = addCommandInput(c, use_case, with.len);
        if (mem) |m| {
            std.mem.copyForwards(u8, m[0..with.len], with);
        }
    }
}

pub fn main() !void {
    if (builtin.target.cpu.arch != .wasm32) {
        const cmd0 = createCommand();
        defer freeCommand(cmd0);
        fillHardBuffer(cmd0, .username, "ab");
        fillHardBuffer(cmd0, .password, "Pappa<3");

        const ok_pass = generateSerialAndPassphrase(cmd0.?, 24, @intCast(std.time.timestamp()));
        const output_str0 = nullTerminatedOrPanic(&cmd0.?.output);
        if (ok_pass >= 0) {
            std.debug.print("new passphrase: {s}\n", .{output_str0});
        } else {
            std.debug.print("error message while generating new passphrase: {s}\n", .{output_str0});
        }

        const cmd1 = createCommand();
        defer freeCommand(cmd1);
        fillHardBuffer(cmd1, .username, "ab");
        fillHardBuffer(cmd1, .password, "Pappa<3");
        const ok_central = generateProofForCentral(cmd1.?, 123, 456);
        const output_str = nullTerminatedOrPanic(&cmd1.?.output);
        if (ok_central >= 0) {
            std.debug.print("central code: {s}\n", .{output_str});
        } else {
            std.debug.print("error message while generating central proof: {s}\n", .{output_str});
        }

        //const valid_phrase = "0413 1090 01924 floor festival advance mother involve retreat will rebel dial casino diamond little example business sunny eye prepare athlete design into protect blush puzzle around";

        const cmd2 = createCommand();
        defer freeCommand(cmd2);
        fillHardBuffer(cmd2, .username, "ab");
        fillHardBuffer(cmd2, .password, "Pappa<3");
        fillHardBuffer(cmd2, .serial_and_passphrase, output_str0);
        const ok = generateEcdsaIdentityKey(cmd2.?);
        const output_str2 = nullTerminatedOrPanic(&cmd2.?.output);
        if (ok >= 0) {
            std.debug.print("identity key: {s}\n", .{output_str2});
        } else {
            std.debug.print("error message while generating ecdsa identity key: {s}\n", .{output_str2});
        }

        //const cmd3 = createCommand();
        //defer freeCommand(cmd3);
        //fillHardBuffer(cmd3, .username, "ab");
        //fillHardBuffer(cmd3, .password, "funnyclockman32");
        //fillHardBuffer(cmd3, .passphrase, "ten little angles");
        //const ok_encrypt_passphrase = encryptPassphrase(cmd3.?, 1703204287);
        //const output_str3 = nullTerminatedOrPanic(&cmd3.?.output);
        //if (ok_encrypt_passphrase >= 0) {
        //    std.debug.print("passphrase encrypted: {s}\n", .{output_str3});
        //} else {
        //    std.debug.print("error message while encrypting passphrase: {s}\n", .{output_str3});
        //}

        //const cmd4 = createCommand();
        //defer freeCommand(cmd4);
        //fillHardBuffer(cmd4, .username, "ab");
        //fillHardBuffer(cmd4, .password, "funnyclockman32");
        //fillHardBuffer(cmd4, .encrypted_passphrase, nullTerminatedOrPanic(&cmd3.?.output));
        //const ok_decrypt_passphrase = decryptPassphrase(cmd4.?, 1703204287);
        //const output_str4 = nullTerminatedOrPanic(&cmd4.?.output);
        //if (ok_decrypt_passphrase >= 0) {
        //    std.debug.print("passphrase decrypted: {s}\n", .{output_str4});
        //} else {
        //    std.debug.print("error message while encrypting passphrase: {s}\n", .{output_str4});
        //}
    }
}

test "do not change identity key using buffer" {
    const cmd = createCommand();
    defer freeCommand(cmd);
    const valid_phrase = "04 1262 9 00 70 76 rack parent balance size toast unable height tiny correct like notable again worry diet utility ensure wrap short arrive install bag tennis box tooth";
    fillHardBuffer(cmd, .username, "ab");
    fillHardBuffer(cmd, .password, "Pappa<3");
    fillHardBuffer(cmd, .serial_and_passphrase, valid_phrase);
    const ok = generateEcdsaIdentityKey(cmd.?);
    try std.testing.expectEqual(true, ok >= 0);

    // If the output changes here, YOU have done something wrong.
    // If you change this string, no user will be able to login to their account.
    const output_str = nullTerminatedOrPanic(&cmd.?.output);
    try std.testing.expectEqualStrings(
        \\{
        \\  "privateKey": {
        \\    "kty": "EC",
        \\    "d": "iYGc0_wWyYs6HHSTOFRERy-f1DMualvM1d8ba3W0i0f-HDcQPgCuh6p8Zd_6Jvc8",
        \\    "use": "sig",
        \\    "crv": "P-384",
        \\    "kid": "PrivIdentityKey",
        \\    "x": "RuA8iDbX6us9QCjFo4WwXr8y4ZZcd78MkFM_FcgcIpyiRHmlvHaRJivu7o2B7mv9",
        \\    "y": "kxjfdqDNm2C2lrLeEzI8yGhvBchlgQLZGIRU36utIXxO3S6YeWAt2MEVDYhhuWyh"
        \\  },
        \\  "publicKey": {
        \\    "kty": "EC",
        \\    "use": "sig",
        \\    "crv": "P-384",
        \\    "kid": "PubIdentityKey",
        \\    "x": "RuA8iDbX6us9QCjFo4WwXr8y4ZZcd78MkFM_FcgcIpyiRHmlvHaRJivu7o2B7mv9",
        \\    "y": "kxjfdqDNm2C2lrLeEzI8yGhvBchlgQLZGIRU36utIXxO3S6YeWAt2MEVDYhhuWyh"
        \\  }
        \\}
        , output_str);


}

test "do not change central proof using buffer" {
    const cmd = createCommand();
    defer freeCommand(cmd);
    fillHardBuffer(cmd, .username, "ab");
    fillHardBuffer(cmd, .password, "Mamma<3");
    const ok = generateProofForCentral(cmd.?, 1703204287, 0);
    try std.testing.expectEqual(true, ok >= 0);

    // If the output changes here, YOU have done something wrong.
    // If you change this string, no user will be able to login to their account.
    const output_str = nullTerminatedOrPanic(&cmd.?.output);
    try std.testing.expectEqualStrings("U_ZpexKARA6BV4VecqFWC343Ea6_Nv1caE7Y-nz3aQU=", output_str);
}

//test "super long proof using buffer" {
//    const cmd = createCommand();
//    defer freeCommand(cmd);
//    fillHardBuffer(cmd, .username, "A" ** 1024);
//    fillHardBuffer(cmd, .password, "B" ** 1024);
//    fillHardBuffer(cmd, .serial_and_passphrase, "C" ** 1024);
//    fillHardBuffer(cmd, .nonce, "D" ** 1024);
//
//    const ok = generateProofForServer(cmd.?, std.math.maxInt(u64));
//    try std.testing.expectEqual(true, ok);
//
//    // If the output changes here, YOU have done something wrong.
//    // If you change this string, no user will be able to login to their account.
//    const output_str = nullTerminatedOrPanic(&cmd.?.output);
//    try std.testing.expectEqualStrings("MEYCIQC4yTmz5X8CSmmRNMJ8vDyxKU-mRhy0wNq3mW3yUG9XGQIhAO8WljQNRBNsYktMIHGAzupvp6ckTBGfB2qeBDTKZnmJ", output_str);
//}

//test "encrypt and decrypt passphrase" {
//    const cmd1 = createCommand();
//    defer freeCommand(cmd1);
//    fillHardBuffer(cmd1, .username, "Test");
//    fillHardBuffer(cmd1, .password, "00ED25F00");
//    fillHardBuffer(cmd1, .passphrase, "here is a realistic elephant");
//    if (!encryptPassphrase(cmd1.?, 1703204287)) {
//        @panic("encrypt passphrase failed");
//    }
//
//    const cmd2 = createCommand();
//    defer freeCommand(cmd2);
//    fillHardBuffer(cmd2, .username, "Test");
//    fillHardBuffer(cmd2, .password, "00ED25F00");
//    fillHardBuffer(cmd2, .encrypted_passphrase, nullTerminatedOrPanic(&cmd1.?.output));
//    if (!decryptPassphrase(cmd2.?, 1703204287)) {
//        @panic("decrypt passphrase failed");
//    }
//
//    const output_str = nullTerminatedOrPanic(&cmd2.?.output);
//    try std.testing.expectEqualStrings("here is a realistic elephant", output_str);
//}

// TODO: Reimplement
// test "get name from error code" {
//
//     var tiny_buffer = [_]u8{0};
//     var output = [_]u8{0} ** 256;
//     var fba = std.heap.FixedBufferAllocator.init(&tiny_buffer);
// 
//     // Triggers an out-of-memory on purpose.
//     const result = authenticator.generateProofForCentral(fba.allocator(), &output, "Test", "00ED25F00", 1703204287, 0);
// 
//     try std.testing.expectError(std.mem.Allocator.Error.OutOfMemory, result);
// 
//     result catch |e| {
//         outputErrorName(e);
//     };
// 
//     const error_str = null_terminated_or_panic(&error_buffer);
//     try std.testing.expectEqualStrings("OutOfMemory", error_str);
// }

