const std = @import("std");
const serial = @import("./serial.zig");
const passphrase = @import("./passphrase.zig");
const cbor = @import("./cbor.zig");
const super = @import("./super.zig");

const auth_log = std.log.scoped(.auth);

/// This module concerns only authentication
/// to different services that exist in the
/// TaigaChat ecosystem. This module DOES NOT
/// concern things like the encryption and safe
/// storage of keys.

//       .allocator = allocator,
//       .params = std.crypto.pwhash.argon2.Params.moderate_2id,
//       .mode = std.crypto.pwhash.argon2.Mode.argon2id,
//       .encoding = std.crypto.pwhash.Encoding.phc,

const CommandErrors = error { TooShortBuffer, UnsupportedFormat, TooLongNonce, BadUsernameOrPassword };

// TODO: Take out the TaigaChat str references and replace with a comptime variable called domain or something like that.
// TODO: That can be useful for making two incompatible services.

// Salting protects users from two legit servers having the same central-proof. Does not protect against MITM.
// Timestamp is added since a request for getting the salt is required anyway. So might as well add it.
// The timestamp refers to the account creation time.
pub fn generateProofForCentral(allocator: std.mem.Allocator, output: []u8, username: []const u8, password: []const u8, timestamp: u64, salt: u64) !usize {
    const combined_central_password = try std.fmt.allocPrint(allocator,
                                                             "tLOG{s}{s}{d}{d}",
                                                             .{password, username, timestamp, salt});
    defer {
        @memset(combined_central_password, 0);
        allocator.free(combined_central_password);
    }

    var derived_key = [_]u8{0} ** 32;

    try std.crypto.pwhash.argon2.kdf(allocator, &derived_key, combined_central_password, "TaigaLoginServiceAuth", std.crypto.pwhash.argon2.Params.moderate_2id, std.crypto.pwhash.argon2.Mode.argon2id);

    const required_output_len = std.base64.url_safe.Encoder.calcSize(derived_key.len);
    if (required_output_len + 1 > output.len) {
        return CommandErrors.TooShortBuffer;
    }
    output[required_output_len] = 0;

    const b64_into = output[0..required_output_len];
    return std.base64.url_safe.Encoder.encode(b64_into, &derived_key).len;
}

pub fn generateEndToEndKeyFingerprint(allocator: std.mem.Allocator, output: []u8, salt: []const u8, password: []const u8) !usize {
    const password_and_salt = try std.fmt.allocPrint(allocator,
                                                    "tFNG{s}{s}",
                                                    .{password, salt});
    defer {
        @memset(password_and_salt, 0);
        allocator.free(password_and_salt);
    }

    // Less bytes we reveal less about the actual password.
    // But it also increases chances of collision. Luckily 24 bytes is still a very low chance of collision.
    var derived_key = [_]u8{0} ** 24;

    try std.crypto.pwhash.argon2.kdf(allocator, &derived_key, password_and_salt, "TaigaFingerprintE2E", std.crypto.pwhash.argon2.Params.moderate_2id, std.crypto.pwhash.argon2.Mode.argon2id);

    const required_output_len = std.base64.url_safe.Encoder.calcSize(derived_key.len);
    if (required_output_len + 1 > output.len) {
        return CommandErrors.TooShortBuffer;
    }
    output[required_output_len] = 0;

    const b64_into = output[0..required_output_len];
    return std.base64.url_safe.Encoder.encode(b64_into, &derived_key).len;
}

pub fn generateEndToEndKey(allocator: std.mem.Allocator, output: []u8, salt: []const u8, password: []const u8) !usize {
    const password_and_salt = try std.fmt.allocPrint(allocator,
                                                    "tE2E{s}{s}",
                                                    .{password, salt});
    defer {
        @memset(password_and_salt, 0);
        allocator.free(password_and_salt);
    }

    // We need exactly 32 bytes of key data because that is what AES-256 demands of us.
    var derived_key = [_]u8{0} ** 32;

    try std.crypto.pwhash.argon2.kdf(allocator, &derived_key, password_and_salt, "TaigaKeyE2E", std.crypto.pwhash.argon2.Params.moderate_2id, std.crypto.pwhash.argon2.Mode.argon2id);

    const required_output_len = std.base64.url_safe_no_pad.Encoder.calcSize(derived_key.len);
    if (required_output_len + 1 > output.len) {
        return CommandErrors.TooShortBuffer;
    }
    output[required_output_len] = 0;

    const b64_into = output[0..required_output_len];
    return std.base64.url_safe_no_pad.Encoder.encode(b64_into, &derived_key).len;
}

const EdcsaHash = std.crypto.hash.composition.Sha512oSha512;
const EdcsaCurve = std.crypto.ecc.P384;
const EdcsaP384Sha512oSha512 = std.crypto.sign.ecdsa.Ecdsa(EdcsaCurve, EdcsaHash);
const Hmac = std.crypto.auth.hmac.Hmac(EdcsaHash);

/// This method will create a random bytes using Hmac until it gets a combination
/// of bytes that when used as a scalar is smaller than the EC domain.
fn deterministicScalar2(h: [EdcsaHash.digest_length]u8, secret_key: EdcsaCurve.scalar.CompressedScalar, noise: ?[EdcsaP384Sha512oSha512.noise_length]u8) EdcsaCurve.scalar.Scalar {
    const noise_length = EdcsaP384Sha512oSha512.noise_length;


    // Modified copy of lib/std/crypto/ecdsa.zig because the original method is not public.
    // KeuPair.create() had to be avoided since it pulled in crypto.random which caused
    // problems with linking on WASM.
    // Perhaps some parameters could be inlined (since they are either <0x00...> or <0x01...> but I am a scaredy-cat)
    var k = [_]u8{0x00} ** h.len;
    var m = [_]u8{0x00} ** (h.len + 1 + noise_length + secret_key.len + h.len);
    var t = [_]u8{0x00} ** EdcsaCurve.scalar.encoded_length;
    const m_v = m[0..h.len];
    const m_i = &m[m_v.len];
    const m_z = m[m_v.len + 1 ..][0..noise_length];
    const m_x = m[m_v.len + 1 + noise_length ..][0..secret_key.len];
    const m_h = m[m.len - h.len ..];

    // Added to clear all memory.
    defer @memset(&k, 0);
    defer @memset(&m, 0);
    defer @memset(&t, 0);

    @memset(m_v, 0x01);
    m_i.* = 0x00;
    if (noise) |n| @memcpy(m_z, &n);
    @memcpy(m_x, &secret_key);
    @memcpy(m_h, &h);
    Hmac.create(&k, &m, &k);
    Hmac.create(m_v, m_v, &k);
    m_i.* = 0x01;
    Hmac.create(&k, &m, &k);
    Hmac.create(m_v, m_v, &k);
    while (true) {
        var t_off: usize = 0;
        while (t_off < t.len) : (t_off += m_v.len) {
            const t_end = @min(t_off + m_v.len, t.len);
            Hmac.create(m_v, m_v, &k);
            @memcpy(t[t_off..t_end], m_v[0 .. t_end - t_off]);
        }
        if (EdcsaCurve.scalar.Scalar.fromBytes(t, .big)) |s| return s else |_| {}
        m_i.* = 0x00;
        Hmac.create(&k, m[0 .. m_v.len + 1], &k);
        Hmac.create(m_v, m_v, &k);
    }
}

fn createEcdsa(seed: [EdcsaP384Sha512oSha512.KeyPair.seed_length]u8) !EdcsaP384Sha512oSha512.KeyPair  {
    const h = [_]u8{0x00} ** EdcsaHash.digest_length;
    const k0 = [_]u8{0x01} ** EdcsaP384Sha512oSha512.SecretKey.encoded_length;
    // TODO: Methods called from here on do not clear
    // all secret variables. But that might be okay if we can clear
    // the stack later on (perhaps via a large stack allocation + memset).
    const secret_key = deterministicScalar2(h, k0, seed).toBytes(.big);
    return EdcsaP384Sha512oSha512.KeyPair.fromSecretKey(EdcsaP384Sha512oSha512.SecretKey{ .bytes = secret_key });
}

const seed_bytes = EdcsaCurve.scalar.encoded_length;
//const seed_bytes = std.crypto.ecc.Secp256k1.scalar.encoded_length;

fn createSeed(allocator: std.mem.Allocator,
              username: []const u8,
              password: []const u8,
              serial_and_passphrase: []const u8,
              seed_into: []u8) !void {
    @memset(seed_into, 0x55);


    // From parsing serial and passphrase we get:
    // 1. Date of creation (timestamp, used by super_password)
    // 2. Length of the entropy (sets length of the seed as well)
    // 3. The entropy itself.
    var entropy = [_]u8{0} ** passphrase.max_entropy_bytes;
    defer @memset(&entropy, 0);
    const seed_info = try serial.serialAndPassphraseToSeed(username,
                                                           serial_and_passphrase,
                                                           &entropy);
    const timestamp_scaled = serial.secondsToTimestampUnit(seed_info.timestamp);

    // The super password does not contain the passphrase (only password) as
    // it is XOR'd later on. This is done because:
    // 1. It protects us against a bad/compromised RNG.
    // 2. It protects us against argon2 potentially being faulty.
    // Naturally, it does not protect us if both happen to be true.
    // But in that case, it is over anyway.
    var hash_buf = [_]u8{0} ** super.max_super_password_hash_len;
    defer @memset(&hash_buf, 0);

    try super.hashSuperPassword(allocator, username, password, timestamp_scaled, &hash_buf);

    // Now that hash of the super password has been computed, we can make sure
    // that the correct password was used for this serial+passphrase by
    // comparing the last byte.
    const last_byte = hash_buf[hash_buf.len - 1] % 100;
    if (seed_info.hash != last_byte) {
        auth_log.err("expected hash {d} but got {d}", .{last_byte, seed_info.hash});
        return CommandErrors.BadUsernameOrPassword;
    }

    const min_seed_len = @min(hash_buf.len, entropy.len);
    const seed_len = @min(min_seed_len, @min(seed_into.len, seed_info.len));

    // After the hashing, we make sure that the last byte
    // of the included hash bytes are cleared.
    // Since seed_len is computed using rounding_up,
    // by rounding up entropy_bits / 8, there is a chance that some bits of the
    // last bytes are forced to be zeroes. If the user changes their password, the
    // hash bytes change. We can offset this by creating a new set of entropy bits.
    // But if some of the bits must remain zero, then this can land us in trouble
    // (you'd have to increase passphrase length by three words each time).
    // So instead, we just clear the last included byte and make sure that they too are always zero.
    hash_buf[seed_len - 1] = 0;

    // By XOR'ing we are able to change the password for a user
    // without changing the final seed by simply computing
    // a new matching entropy for the new password hash.
    for (hash_buf[0..seed_len], entropy[0..seed_len], seed_into[0..seed_len]) |a, b, *c| {
        c.* = a ^ b;
    }
}
pub fn generateEcdsaIdentityKey(allocator: std.mem.Allocator,
                              username: []const u8,
                              password: []const u8,
                              serial_and_passphrase: []const u8,
                              output: []u8,) !usize {

    var final_seed: [seed_bytes]u8 = undefined;
    defer @memset(&final_seed, 0);
    try createSeed(allocator, username, password, serial_and_passphrase, &final_seed);

    var kp = try createEcdsa(final_seed);
    defer kp = std.mem.zeroes(EdcsaP384Sha512oSha512.KeyPair);

    var affine = kp.public_key.p.affineCoordinates();
    defer affine = std.mem.zeroes(@TypeOf(affine));

    var x_bytes = affine.x.toBytes(.big);
    defer @memset(&x_bytes, 0);

    var y_bytes = affine.y.toBytes(.big);
    defer @memset(&y_bytes, 0);

    var x_buf: [256]u8 = undefined;
    defer @memset(&x_buf, 0);
    const x = std.base64.url_safe.Encoder.encode(&x_buf, &x_bytes);

    var y_buf: [256]u8 = undefined;
    defer @memset(&y_buf, 0);
    const y = std.base64.url_safe.Encoder.encode(&y_buf, &y_bytes);

    var d_bytes = kp.secret_key.toBytes();
    defer @memset(&d_bytes, 0);

    var d_buf: [256]u8 = undefined;
    defer @memset(&d_buf, 0);
    const d = std.base64.url_safe.Encoder.encode(&d_buf, &d_bytes);

    const res = try std.fmt.bufPrint(output,
        \\{{
        \\  "privateKey": {{
        \\    "kty": "EC",
        \\    "d": "{s}",
        \\    "use": "sig",
        \\    "crv": "P-384",
        \\    "kid": "PrivIdentityKey",
        \\    "x": "{s}",
        \\    "y": "{s}"
        \\  }},
        \\  "publicKey": {{
        \\    "kty": "EC",
        \\    "use": "sig",
        \\    "crv": "P-384",
        \\    "kid": "PubIdentityKey",
        \\    "x": "{s}",
        \\    "y": "{s}"
        \\  }}
        \\}}
        , .{d, x, y, x, y});
    return res.len;
}

fn nonRandomNumberGenerator(_: *anyopaque, buf: []u8) void {
    @memset(buf, 42);
}

const non_random_number_generator = std.rand.Random {
    .ptr = undefined,
    .fillFn = nonRandomNumberGenerator,
};

test "do not change identity jwk key" {
    var output_buf = [_]u8{0} ** 1024;

    const ok_passphrase = "002 900 0951 tennis blue spoil section sphere praise butter quote segment twin walk seat";
    const output_len = try generateEcdsaIdentityKey(std.testing.allocator, "Spy", "conga", ok_passphrase, &output_buf);
    const output = output_buf[0..output_len];

    // If the output changes here, YOU have done something wrong.
    // If you change this string, no user will be able to login to their account.
    try std.testing.expectEqualStrings(
        \\{
        \\  "privateKey": {
        \\    "kty": "EC",
        \\    "d": "ZtLhslw5lCAuKR1yMriCNmyEIunKUkl8eZ_qE5USSrNEEYS0A2Pbbkj_GZfPg0DD",
        \\    "use": "sig",
        \\    "crv": "P-384",
        \\    "kid": "PrivIdentityKey",
        \\    "x": "ZEeSyF3hWfYxoUyS7Da2G2zmFQs7N4f05Td8YlXlV0voEq8Wd_jW9Dl5yyNNtxY_",
        \\    "y": "MGovGgTXgZMP2Shml_xP4jRC_NGW8FvKeeFhLqoKjrv2nTI8fyMkHA88CfzpnsQF"
        \\  },
        \\  "publicKey": {
        \\    "kty": "EC",
        \\    "use": "sig",
        \\    "crv": "P-384",
        \\    "kid": "PubIdentityKey",
        \\    "x": "ZEeSyF3hWfYxoUyS7Da2G2zmFQs7N4f05Td8YlXlV0voEq8Wd_jW9Dl5yyNNtxY_",
        \\    "y": "MGovGgTXgZMP2Shml_xP4jRC_NGW8FvKeeFhLqoKjrv2nTI8fyMkHA88CfzpnsQF"
        \\  }
        \\}
        , output);
}


test "do not change central proof" {
    var output_buf = [_]u8{0} ** 256;

    const output_len = try generateProofForCentral(std.testing.allocator, &output_buf, "Engineer", "gaming", 1703204287, 0);
    const output = output_buf[0..output_len];

    // If the output changes here, YOU have done something wrong.
    // If you change this string, no user will be able to login to their account.
    try std.testing.expectEqualStrings("qQ37LEi8zjVFuJfN8B92fsoGBSCkW-_t5Q_1Go2i-vA=", output);
}

// test "derived key stays the same" {
//     var key = [_]u8{0} ** std.crypto.ecc.Secp256k1.scalar.encoded_length;
//     try tester_auth.deriveSavedPassphraseKey(std.testing.allocator, &key, "ab", "funnyclockman32", 1703204287);
//     var b64_into = [_]u8{0} ** std.base64.url_safe.Encoder.calcSize(key.len);
//     _ = std.base64.url_safe.Encoder.encode(&b64_into, &key);
// 
//     // If the output changes here, YOU have done something wrong.
//     // If you change this string, no user will be able to login to their account.
//     try std.testing.expectEqualStrings("xn4EKC-PJC2Fnph_loplizXEmaCHJ0it3qd7_AzgWUw=", &b64_into);
// }

// test "encrypt passphrase deterministic" {
//     var output = [_]u8{0} ** 256;
//     try tester_auth.encryptPassphrase(std.testing.allocator, non_random_number_generator, &output, "ab", "funnyclockman32", 1703204287, "ten little angles");
//     const output_str = null_terminated_or_panic(&output);
// 
//     try std.testing.expectEqualStrings("kmNwcDGTTCoqKioqKioqKioqKlDod0DqkrjM9Ei0UlkKc4W0UezpQsBuJJUYeEF5pCvZB4q4", output_str);
// }

test "noise is working" {
    // TODO: Make sure calling all functions twice get you two different results because of noise.
}

