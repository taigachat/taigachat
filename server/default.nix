{ pkgs ? import <nixpkgs> { system = builtins.currentSystem; }, 
  stdenv ? pkgs.stdenv,
  buildNpmPackage ? pkgs.buildNpmPackage,
  writeShellScript ? pkgs.writeShellScript }:
let
  serverVersion = "1.0";
  mediaWorker = pkgs.callPackage ./MediaWorker {};
  targetNode = pkgs.nodejs_22;
  npmPackage = buildNpmPackage rec {
    nodejs = targetNode;
    pname = "taigachat-server";
    version = serverVersion;
    src = [ ./Source ];
    dontNpmBuild = true;
    npmDepsHash = "sha256-f0oGYndx9aETmG0Pf+9nnu5mqWLgDO3RrWOI9Tp5B6E=";
    propagatedBuildInputs = [ mediaWorker ]; 
    passthru = { mediaWorker = mediaWorker; };
    postInstall = ''
      cp -r $out/lib/node_modules $out/lib/build
    '';
  };
  taigaChatShellBin = writeShellScript "taigachat-server.sh" ''
    if [ -z "$TAIGACHAT_SERVER_MEDIA_WORKER_PATH" ]; then
        TAIGACHAT_SERVER_MEDIA_WORKER_PATH="${mediaWorker}/bin/media-worker-windows" ${targetNode}/bin/node --experimental-strip-types ${npmPackage}/lib/build/taigaserver $@
    else
        ${targetNode}/bin/node --experimental-strip-types ${npmPackage}/lib/build/taigaserver $@
    fi
  '';
in
stdenv.mkDerivation rec {
  pname = "taigachat-server";
  version = serverVersion;

  nativeBuildInputs = [ npmPackage ];
  propagatedBuildInputs = [ mediaWorker ]; 
  phases = [ "buildPhase" ];
  passthru = { mediaWorker = mediaWorker; };
  buildPhase = ''
    mkdir -p $out/bin
    cp ${taigaChatShellBin} $out/bin/taigachat-server
  '';
}
