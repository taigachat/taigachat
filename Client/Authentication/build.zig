const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});

    const optimize = b.standardOptimizeOption(.{});

    const authenticator = b.addExecutable(.{
        .name = "Authenticator",
        .root_source_file = b.path("src/main.zig"),
        .link_libc = true, // TODO: Could be removed if we stop using c_allocator for authenticator
        .target = target,
        .optimize = optimize,
    });

    b.installArtifact(authenticator);

    const run_cmd = b.addRunArtifact(authenticator);
    run_cmd.step.dependOn(b.getInstallStep());
    const run_step = b.step("run", "Run the authenticator");
    run_step.dependOn(&run_cmd.step);

    const main_tests = b.addTest(.{
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
    });

    const run_main_tests = b.addRunArtifact(main_tests);

    const test_step = b.step("test", "Run library tests");
    test_step.dependOn(&run_main_tests.step);

    // To create a WASM file we add the following:
    const wasm_lib = b.addExecutable(.{
        .name = "authenticator",
        .root_source_file = b.path("src/main.zig"),
        .target = b.resolveTargetQuery(.{.cpu_arch = .wasm32, .os_tag = .freestanding}),
        .optimize = optimize,
    });
    wasm_lib.entry = .disabled;
    wasm_lib.rdynamic = true;

    const copy_wasm_lib = b.addInstallArtifact(wasm_lib, .{});
    copy_wasm_lib.step.dependOn(&wasm_lib.step);

    const wasm_step = b.step("wasm", "Creates the WASM library");

    wasm_step.dependOn(&copy_wasm_lib.step);
}
