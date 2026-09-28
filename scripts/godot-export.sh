#!/usr/bin/env bash
# Build the Age of Voxel GDExtension for one target and export the Godot game.
#
#   scripts/godot-export.sh linux|windows|macos|web [release|debug]
#
# Output: dist-godot/<target>/ (gitignored). Environment:
#   GODOT=path        Godot 4.5.1 editor binary (default: godot on PATH)
#   JOBS=N            scons jobs (default 2: the dev machine is shared)
#   SKIP_BUILD=1      do not run scons (the library is already in godot/native/bin,
#                     e.g. CI downloads it from the build jobs)
#   EMSDK=dir         emsdk checkout, sourced for the web build if emcc is not on PATH
#
# The official 4.5.1 export templates must be installed (Editor > Manage Export
# Templates, or unzip the .tpz into ~/.local/share/godot/export_templates/4.5.1.stable
# on Linux, ~/Library/Application Support/Godot/export_templates/4.5.1.stable on macOS).
# The web export uses the dlink "nothreads" template: it runs from any static
# server, no cross-origin isolation headers needed.
set -euo pipefail

target=${1:?usage: godot-export.sh linux|windows|macos|web [release|debug]}
mode=${2:-release}
root=$(cd "$(dirname "$0")/.." && pwd)
GODOT=${GODOT:-godot}
JOBS=${JOBS:-2}

case "$target" in
	linux)   preset=Linux;   out=AgeOfVoxel.x86_64; sargs="platform=linux arch=x86_64";    tlib=linux.template_MODE.x86_64.so ;;
	windows) preset=Windows; out=AgeOfVoxel.exe;    sargs="platform=windows arch=x86_64";  tlib=windows.template_MODE.x86_64.dll ;;
	macos)   preset=macOS;   out=AgeOfVoxel.zip;    sargs="platform=macos arch=universal"; tlib=macos.template_MODE.framework ;;
	web)     preset=Web;     out=index.html;        sargs="platform=web threads=no";       tlib=web.template_MODE.wasm32.nothreads.wasm ;;
	*) echo "unknown target: $target" >&2; exit 2 ;;
esac
case "$mode" in release|debug) ;; *) echo "mode must be release or debug" >&2; exit 2 ;; esac
tlib=libaov.${tlib/MODE/$mode}

# The editor that runs the export loads the extension too, through the
# *debug* entry for the machine it runs on (aov.gdextension). Without that
# library it logs "GDExtension dynamic library not found" and the export fails,
# whatever the target, so it is built (or checked) as well.
case "$(uname -s)" in
	Linux)  harch=$(uname -m); [ "$harch" = aarch64 ] && harch=arm64
	        hargs="platform=linux arch=$harch"; hlib=libaov.linux.template_debug.$harch.so ;;
	Darwin) hargs="platform=macos arch=universal"; hlib=libaov.macos.template_debug.framework ;;
	MINGW*|MSYS*|CYGWIN*) hargs="platform=windows arch=x86_64"; hlib=libaov.windows.template_debug.x86_64.dll ;;
	*) echo "unsupported host: $(uname -s)" >&2; exit 2 ;;
esac

if [ "${SKIP_BUILD:-0}" != 1 ]; then
	(cd "$root/godot/native" && scons -j"$JOBS" $hargs target=template_debug)
	if [ "$target" = web ] && ! command -v emcc >/dev/null 2>&1; then
		# shellcheck disable=SC1091
		source "${EMSDK:-$HOME/emsdk}/emsdk_env.sh" >/dev/null
	fi
	(cd "$root/godot/native" && scons -j"$JOBS" $sargs target=template_"$mode")
fi
[ -e "$root/godot/native/bin/$tlib" ] || {
	echo "missing godot/native/bin/$tlib (the $target library the export ships)" >&2; exit 1; }
[ -e "$root/godot/native/bin/$hlib" ] || {
	echo "missing godot/native/bin/$hlib: the editor needs it to load the extension" >&2
	echo "(build it: cd godot/native && scons $hargs target=template_debug)" >&2; exit 1; }

# Godot only loads a GDExtension listed in .godot/extension_list.cfg (written by an import).
if [ ! -f "$root/godot/.godot/extension_list.cfg" ]; then
	"$GODOT" --headless --path "$root/godot" --import || true
fi

dest="$root/dist-godot/$target"
rm -rf "$dest"
mkdir -p "$dest"
"$GODOT" --headless --path "$root/godot" --export-"$mode" "$preset" "$dest/$out" 2>&1 | tee "$dest.log"
[ -e "$dest/$out" ] || { echo "export failed: no $dest/$out" >&2; exit 1; }
# Godot's exporter logs errors but can still exit 0: fail on them.
if grep -E "^(ERROR|SCRIPT ERROR):" "$dest.log" | grep -v "Cannot open file 'res://.godot/" ; then
	echo "export logged errors (see $dest.log)" >&2; exit 1
fi
rm -f "$dest.log"
echo "exported $target ($mode): $dest"
ls -la "$dest"
