{ pkgs ? import <nixpkgs> { system = builtins.currentSystem; }, stdenv ? pkgs.stdenv }:
let manifest = (pkgs.lib.importTOML ./Cargo.toml).package;
    #pythonpkgs = ps: with ps; [meson ninja];
    mediasoupWorkerSource = version_: stdenv.mkDerivation rec {
        nativeBuildInputs = [
            pkgs.meson
            # We include cacert such that we may use it while downloading
            # dependencies. Unfortunately mesons "allow-insecure" is broken
            # so this is the only way.
            pkgs.cacert
        ];
        pname = "mediasoup-worker-src";
        version = version_;
        src = fetchTarball {
            url = "https://github.com/versatica/mediasoup/archive/refs/tags/${version_}.tar.gz";
        };
        sourceRoot = "source/worker";
        phases = ["buildPhase"];
        buildPhase = ''
            cp --no-preserve=mode,ownership -r $src/worker $out
            cd $out && \
            SSL_CERT_DIR="${pkgs.cacert}/etc/ssl/certs" \
            SSL_CERT_FILE="${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt" \
            meson subprojects download --allow-insecure
        '';
        outputHashAlgo = "sha256";
        outputHashMode = "recursive";
        outputHash = "sha256-1M1YW603Dog7FG1Qcu+9FQz+lUof92v64o76HNl6Kqk=";
        #outputHash = "";

    };
    mediasoupWorker = stdenv.mkDerivation rec {
        nativeBuildInputs = [
            pkgs.doxygen
            pkgs.meson
            pkgs.ninja
        ];
        name = "mediasoup-worker";
        version = "3.15.2";
        src = mediasoupWorkerSource version;
        buildPhase = ''
            meson compile flatbuffers-generator
            meson compile libmediasoup-worker
        '';
        installPhase = ''
            mkdir -p $out/lib
            cp libmediasoup-worker.a $out/lib/
        '';
    };
in
pkgs.rustPlatform.buildRustPackage rec {
    nativeBuildInputs = [
        mediasoupWorker
	pkgs.rustfmt
        #(pkgs.python3.withPackages pythonpkgs)
    ];
    RUSTFLAGS = (builtins.map (a: ''-L ${a}/lib'') [
        mediasoupWorker
    ]);
    pname = manifest.name;
    version = manifest.version;
    cargoLock.lockFile = ./Cargo.lock;
    src = pkgs.nix-gitignore.gitignoreSource [] ./.;
}

