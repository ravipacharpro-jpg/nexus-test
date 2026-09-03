#!/usr/bin/env bash
set -euo pipefail

APP=nexus
REPO=ravipacharpro-jpg/nexus-agent
INSTALL_DIR="${NEXUS_INSTALL_DIR:-$HOME/.nexus/bin}"

MUTED='\033[0;2m'
RED='\033[0;31m'
ORANGE='\033[38;5;214m'
NC='\033[0m' # No Color

usage() {
    cat <<EOF
NEXUS Installer

Usage: install.sh [options]

Options:
    -h, --help              Display this help message
    -v, --version <version> Install a specific version (e.g., 0.1.5)
    -b, --binary <path>     Install from a local binary instead of downloading
        --no-modify-path    Don't modify shell config files (.zshrc, .bashrc, etc.)

Examples:
    curl -fsSL https://raw.githubusercontent.com/ravipacharpro-jpg/nexus-agent/main/install.sh | bash
    curl -fsSL https://raw.githubusercontent.com/ravipacharpro-jpg/nexus-agent/main/install.sh | bash -s -- --version 0.1.5
    ./install.sh --binary /path/to/nexus
EOF
}

requested_version=${VERSION:-}
no_modify_path=false
binary_path=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        -v|--version)
            if [[ -n "${2:-}" ]]; then
                requested_version="$2"
                shift 2
            else
                echo -e "${RED}Error: --version requires a version argument${NC}"
                exit 1
            fi
            ;;
        -b|--binary)
            if [[ -n "${2:-}" ]]; then
                binary_path="$2"
                shift 2
            else
                echo -e "${RED}Error: --binary requires a path argument${NC}"
                exit 1
            fi
            ;;
        --no-modify-path)
            no_modify_path=true
            shift
            ;;
        *)
            echo -e "${ORANGE}Warning: Unknown option '$1'${NC}" >&2
            shift
            ;;
    esac
done

mkdir -p "$INSTALL_DIR"

is_termux=false
if [[ "${PREFIX:-}" == */com.termux/files/usr ]] || [[ "${TERMUX_VERSION:-}" != "" ]]; then
    is_termux=true
fi

install_termux_foundation() {
    if [ "$is_termux" != "true" ]; then
        return 0
    fi

    if ! command -v pkg >/dev/null 2>&1; then
        echo -e "${RED}Error: Termux's 'pkg' command was not found.${NC}"
        echo -e "${MUTED}Run this installer inside the native Termux app, not inside a PRoot container.${NC}"
        exit 1
    fi

    echo -e "${MUTED}Preparing the no-root Termux foundation...${NC}"
    # Release archives contain a compiled NEXUS executable. Bun is only required
    # for source development builds, so the production installer must not install
    # or execute it. Node is retained for executable Node tool templates.
    if ! command -v node >/dev/null 2>&1; then
        if ! pkg install -y nodejs-lts && ! pkg install -y nodejs; then
            echo -e "${RED}Unable to install Node.js in Termux.${NC}"
            echo -e "${MUTED}Run: pkg install nodejs${NC}"
            exit 1
        fi
    fi

    if ! command -v curl >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1 || ! command -v unzip >/dev/null 2>&1; then
        if ! pkg install -y ca-certificates curl tar unzip; then
            echo -e "${RED}Unable to install required Termux download tools.${NC}"
            echo -e "${MUTED}Run: pkg install ca-certificates curl tar unzip${NC}"
            exit 1
        fi
    fi

    mkdir -p "$HOME/.nexus/bots" "$HOME/.nexus/tools" "$HOME/.nexus/services" "$HOME/.nexus/logs" "$HOME/.nexus/agents"
}

install_termux_foundation

# If --binary is provided, skip all download/detection logic.
if [ -n "$binary_path" ]; then
    if [ ! -f "$binary_path" ]; then
        echo -e "${RED}Error: Binary not found at ${binary_path}${NC}"
        exit 1
    fi
    specific_version="local"
else
    raw_os=$(uname -s)
    os=$(echo "$raw_os" | tr '[:upper:]' '[:lower:]')
    case "$raw_os" in
      Darwin*) os="darwin" ;;
      Linux*) os="linux" ;;
      MINGW*|MSYS*|CYGWIN*) os="windows" ;;
    esac

    arch=$(uname -m)
    if [[ "$arch" == "aarch64" ]]; then
      arch="arm64"
    fi
    if [[ "$arch" == "x86_64" ]]; then
      arch="x64"
    fi

    if [ "$os" = "darwin" ] && [ "$arch" = "x64" ]; then
      rosetta_flag=$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)
      if [ "$rosetta_flag" = "1" ]; then
        arch="arm64"
      fi
    fi

    combo="$os-$arch"
    case "$combo" in
      linux-x64|linux-arm64)
        ;;
      darwin-x64|darwin-arm64|windows-x64)
        ;;
      *)
        echo -e "${RED}Unsupported OS/Arch: $os/$arch${NC}"
        exit 1
        ;;
    esac

    if [ "$os" = "windows" ]; then
        archive_ext=".zip"
    else
        archive_ext=".tar.gz"
    fi

    is_musl=false
    if [ "$os" = "linux" ]; then
      if [ -f /etc/alpine-release ]; then
        is_musl=true
      fi

      if command -v ldd >/dev/null 2>&1; then
        if ldd --version 2>&1 | grep -qi musl; then
          is_musl=true
        fi
      fi
    fi

    # Termux uses Android Bionic, not musl. The Termux launcher below runs the
    # regular Linux/glibc binary through glibc-runner without root or PRoot.
    if [ "$is_termux" = "true" ]; then
      is_musl=false
    fi

    needs_baseline=false
    if [ "$arch" = "x64" ] && [ "$os" = "linux" ]; then
      if ! grep -qwi avx2 /proc/cpuinfo 2>/dev/null; then
        needs_baseline=true
      fi
    fi

    target="$os-$arch"
    if [ "$needs_baseline" = "true" ]; then
      target="$target-baseline"
    fi
    if [ "$is_musl" = "true" ]; then
      target="$target-musl"
    fi

    if ! command -v curl >/dev/null 2>&1; then
        echo -e "${RED}Error: 'curl' is required but not installed.${NC}"
        exit 1
    fi
    if ! command -v tar >/dev/null 2>&1; then
        echo -e "${RED}Error: 'tar' is required but not installed.${NC}"
        exit 1
    fi

    if [ -z "$requested_version" ]; then
        specific_version=$(curl -fsSL --retry 3 --connect-timeout 5 "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p')
        if [[ -z "$specific_version" ]]; then
            specific_version=$(curl -fsSL --retry 3 --connect-timeout 5 "https://github.com/$REPO/releases.atom" | grep -o 'tag/v[0-9]*\.[0-9]*\.[0-9]*' | head -1 | sed 's/tag\/v//')
            if [[ -z "$specific_version" ]]; then
                echo -e "${RED}Failed to fetch the latest NEXUS version${NC}"
                exit 1
            fi
        fi
    else
        requested_version="${requested_version#v}"
        specific_version=$requested_version

        http_status=$(curl -sI -o /dev/null -w "%{http_code}" "https://github.com/$REPO/releases/tag/v${requested_version}")
        if [ "$http_status" = "404" ]; then
            echo -e "${RED}Error: Release v${requested_version} not found${NC}"
            echo -e "${MUTED}Available releases: https://github.com/$REPO/releases${NC}"
            exit 1
        fi
    fi

    filename="$APP-$target-${specific_version}$archive_ext"
    url="https://github.com/$REPO/releases/download/v${specific_version}/$filename"
    if ! curl -fsIL -o /dev/null "$url"; then
        filename="$APP-$target$archive_ext"
        url="https://github.com/$REPO/releases/download/v${specific_version}/$filename"
    fi
fi

print_message() {
    local level=$1
    local message=$2
    local color=""

    case $level in
        info|warning) color="${NC}" ;;
        error) color="${RED}" ;;
    esac

    echo -e "${color}${message}${NC}"
}

check_version() {
    if command -v "$APP" >/dev/null 2>&1; then
        installed_version=$("$APP" --version 2>/dev/null | tr -d 'v' | awk '{print $1}' || echo "")

        if [[ "$installed_version" == "$specific_version" ]]; then
            # On Termux, ensure the wrapper has the LD_PRELOAD fix before skipping
            if [ "$is_termux" = "true" ] && [ -f "$INSTALL_DIR/nexus" ]; then
                if ! grep -q "NEXUS_TERMUX_DIRECT_LOADER_V3" "$INSTALL_DIR/nexus"; then
                    print_message info "${MUTED}Version ${NC}$specific_version${MUTED} installed, but launcher needs update. Refreshing...${NC}"
                    return 0
                fi
            fi
            print_message info "${MUTED}Version ${NC}$specific_version${MUTED} already installed${NC}"
            exit 0
        fi

        print_message info "${MUTED}Installed version: ${NC}$installed_version."
    fi
}

install_termux_runtime() {
    if [ "$is_termux" != "true" ]; then
        return 0
    fi

    if command -v grun >/dev/null 2>&1; then
        return 0
    fi

    if ! command -v pkg >/dev/null 2>&1; then
        echo -e "${RED}Error: Termux's 'pkg' command was not found.${NC}"
        echo -e "${MUTED}Install glibc support with: pkg install glibc-repo glibc-runner${NC}"
        exit 1
    fi

    print_message info "${MUTED}Installing the no-root Termux glibc compatibility runtime...${NC}"
    # glibc-repo and glibc-runner must be installed in sequence. If the
    # selected mirror is stale, open the repository selector on the user's
    # terminal even when this installer is running through `curl | bash`, then
    # refresh indexes and retry automatically.
    select_termux_repo_and_refresh() {
        if command -v termux-change-repo >/dev/null 2>&1 && [ -e /dev/tty ]; then
            print_message info "${MUTED}Opening Termux repository selector; keep Main repository enabled.${NC}"
            termux-change-repo </dev/tty >/dev/tty 2>/dev/tty || true
            pkg update -y >/dev/null 2>&1 || true
            return 0
        fi
        return 1
    }

    if ! pkg install -y glibc-repo; then
        if ! select_termux_repo_and_refresh || ! pkg install -y glibc-repo; then
            echo -e "${RED}Termux glibc-repo is unavailable from the selected mirror.${NC}"
            echo -e "${MUTED}Enable Main repository with: termux-change-repo${NC}"
            echo -e "${MUTED}Then rerun this same one-command installer.${NC}"
            exit 1
        fi
    fi
    pkg update -y >/dev/null 2>&1 || true
    if ! pkg install -y glibc-runner; then
        if ! select_termux_repo_and_refresh || ! pkg install -y glibc-runner; then
            echo -e "${RED}Termux glibc-runner is unavailable from the enabled glibc repository.${NC}"
            echo -e "${MUTED}Enable Main and Glibc repositories with: termux-change-repo${NC}"
            echo -e "${MUTED}Then rerun this same one-command installer.${NC}"
            exit 1
        fi
    fi

    if ! command -v grun >/dev/null 2>&1; then
        echo -e "${RED}glibc-runner installed but 'grun' is not on PATH.${NC}"
        echo -e "${MUTED}Restart Termux, then rerun the NEXUS installer.${NC}"
        exit 1
    fi
}

write_termux_wrapper() {
    local wrapper_path="$1"
    local termux_bash="${PREFIX:-}/bin/bash"

    if [ -z "${PREFIX:-}" ] || [ ! -x "$termux_bash" ]; then
        echo -e "${RED}Termux bash was not found at ${termux_bash}.${NC}"
        return 1
    fi

    {
        # Keep the only installer-time substitution separate. The quoted heredoc
        # below must preserve all variables for the launcher at runtime.
        printf '#!%s\n' "$termux_bash"
        cat <<'EOF'
set -e
# Resolve nexus/nexus symlinks so the companion binary is found in the install directory.
SOURCE="$0"
while [[ -h "$SOURCE" ]]; do
    SOURCE_DIR="$(CDPATH= cd -- "$(dirname -- "$SOURCE")" && pwd)"
    SOURCE="$(readlink "$SOURCE")"
    [[ "$SOURCE" != /* ]] && SOURCE="$SOURCE_DIR/$SOURCE"
done
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$SOURCE")" && pwd)"
unset LD_PRELOAD
GLIBC_PREFIX="${PREFIX:-}/glibc"
if [[ ! -d "$GLIBC_PREFIX" ]]; then
    printf '%s\n' 'NEXUS needs Termux glibc support. Install it with: pkg install glibc-repo glibc-runner' >&2
    exit 1
fi
# NEXUS_TERMUX_DIRECT_LOADER_V3
# The official runner exposes the dynamic loader as glibc/bin/ld.so. Some
# package revisions also expose the architecture-specific loader in glibc/lib.
LOADER=""
for candidate in \
    "$GLIBC_PREFIX/bin/ld.so" \
    "$GLIBC_PREFIX/lib/ld-linux-aarch64.so.1" \
    "$GLIBC_PREFIX/lib/ld-linux-x86-64.so.2" \
    "$GLIBC_PREFIX/lib64/ld-linux-aarch64.so.1" \
    "$GLIBC_PREFIX/lib64/ld-linux-x86-64.so.2"; do
    if [[ -f "$candidate" && -x "$candidate" ]]; then
        LOADER="$candidate"
        break
    fi
done
if [[ -z "$LOADER" ]]; then
    printf '%s\n' 'NEXUS could not find the Termux glibc dynamic loader.' >&2
    printf '%s\n' "Expected: $GLIBC_PREFIX/bin/ld.so or $GLIBC_PREFIX/lib/ld-linux-*" >&2
    printf '%s\n' 'Install it with: pkg install glibc-repo glibc-runner' >&2
    exit 1
fi
LIBRARY_PATH="$GLIBC_PREFIX/lib"
if [[ -d "$GLIBC_PREFIX/lib64" ]]; then
    LIBRARY_PATH="$LIBRARY_PATH:$GLIBC_PREFIX/lib64"
fi
exec "$LOADER" --library-path "$LIBRARY_PATH" "$SCRIPT_DIR/nexus.bin" "$@"
EOF
    } > "$wrapper_path"

    chmod 755 "$wrapper_path"
}

download_and_install() {
    print_message info "\n${MUTED}Installing ${NC}NEXUS ${MUTED}version: ${NC}$specific_version"
    local tmp_dir="${TMPDIR:-/tmp}/dev_hub_install_$$"
    mkdir -p "$tmp_dir"

    if ! curl -fL --retry 3 --connect-timeout 15 -# -o "$tmp_dir/$filename" "$url"; then
        rm -rf "$tmp_dir"
        echo -e "${RED}Download failed: $url${NC}"
        exit 1
    fi

    if [[ "$filename" == *.zip ]]; then
        unzip -q "$tmp_dir/$filename" -d "$tmp_dir/extracted"
        local extracted_root="$tmp_dir/extracted"
    else
        tar -xzf "$tmp_dir/$filename" -C "$tmp_dir"
        local extracted_root="$tmp_dir"
    fi

    # Release archives may contain a top-level directory, e.g.
    # nexus-linux-arm64-0.1.67/nexus. Search only for the known executable
    # names so unrelated archive contents can never be installed accidentally.
    local extracted_bin=""
    while IFS= read -r candidate; do
        if [ -f "$candidate" ]; then
            extracted_bin="$candidate"
            break
        fi
    done < <(find "$extracted_root" -type f \( -name nexus -o -name nexus-x64 -o -name nexus-arm64 \) -print)
    if [ -z "$extracted_bin" ]; then
        rm -rf "$tmp_dir"
        echo -e "${RED}Downloaded archive does not contain a nexus executable.${NC}"
        exit 1
    fi

    install_termux_runtime
    if [ "$is_termux" = "true" ]; then
        local wrapper_path="$INSTALL_DIR/.nexus-wrapper-$$"
        write_termux_wrapper "$wrapper_path"
        mv "$extracted_bin" "$INSTALL_DIR/nexus.bin"
        mv "$wrapper_path" "$INSTALL_DIR/nexus"
        chmod 755 "$INSTALL_DIR/nexus.bin" "$INSTALL_DIR/nexus"
    else
        mv "$extracted_bin" "$INSTALL_DIR/nexus"
        chmod 755 "$INSTALL_DIR/nexus"
    fi
    rm -rf "$tmp_dir"
}

install_from_binary() {
    print_message info "\n${MUTED}Installing ${NC}NEXUS ${MUTED}from: ${NC}$binary_path"
    if [ "$is_termux" = "true" ]; then
        install_termux_runtime
        local wrapper_path="$INSTALL_DIR/.nexus-wrapper-$$"
        write_termux_wrapper "$wrapper_path"
        mv "$binary_path" "$INSTALL_DIR/nexus.bin"
        mv "$wrapper_path" "$INSTALL_DIR/nexus"
        chmod 755 "$INSTALL_DIR/nexus.bin" "$INSTALL_DIR/nexus"
    else
        cp "$binary_path" "${INSTALL_DIR}/nexus"
        chmod 755 "${INSTALL_DIR}/nexus"
    fi
}

if [ -n "$binary_path" ]; then
    install_from_binary
else
    check_version
    download_and_install
fi

add_to_path() {
    local config_file=$1
    local command=$2

    if grep -Fxq "$command" "$config_file"; then
        print_message info "Command already exists in $config_file, skipping write."
    elif [[ -w $config_file ]]; then
        echo -e "\n# NEXUS" >> "$config_file"
        echo "$command" >> "$config_file"
        print_message info "${MUTED}Successfully added ${NC}NEXUS ${MUTED}to \$PATH in ${NC}$config_file"
    else
        print_message warning "Manually add the directory to $config_file (or similar):"
        print_message info "  $command"
    fi
}

XDG_CONFIG_HOME=${XDG_CONFIG_HOME:-$HOME/.config}
current_shell=$(basename "${SHELL:-sh}")
case $current_shell in
    fish)
        config_files="$HOME/.config/fish/config.fish"
    ;;
    zsh)
        config_files="${ZDOTDIR:-$HOME}/.zshrc ${ZDOTDIR:-$HOME}/.zshenv $XDG_CONFIG_HOME/zsh/.zshrc $XDG_CONFIG_HOME/zsh/.zshenv"
    ;;
    bash)
        config_files="$HOME/.bashrc $HOME/.bash_profile $HOME/.profile $XDG_CONFIG_HOME/bash/.bashrc $XDG_CONFIG_HOME/bash/.bash_profile"
    ;;
    ash|sh)
        config_files="$HOME/.ashrc $HOME/.profile /etc/profile"
    ;;
    *)
        config_files="$HOME/.bashrc $HOME/.bash_profile $XDG_CONFIG_HOME/bash/.bashrc $XDG_CONFIG_HOME/bash/.bash_profile"
    ;;
esac

if [[ "$no_modify_path" != "true" ]]; then
    config_file=""
    for file in $config_files; do
        if [[ -f $file ]]; then
            config_file=$file
            break
        fi
    done

    if [[ -z $config_file ]]; then
        print_message warning "No config file found for $current_shell. You may need to manually add to PATH:"
        print_message info "  export PATH=$INSTALL_DIR:\$PATH"
    elif [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
        case $current_shell in
            fish)
                add_to_path "$config_file" "fish_add_path $INSTALL_DIR"
            ;;
            *)
                add_to_path "$config_file" "export PATH=$INSTALL_DIR:\$PATH"
            ;;
        esac
    fi
fi

if [ -n "${GITHUB_ACTIONS-}" ] && [ "${GITHUB_ACTIONS}" = "true" ]; then
    echo "$INSTALL_DIR" >> "$GITHUB_PATH"
    print_message info "Added $INSTALL_DIR to \$GITHUB_PATH"
fi

install_command_alias() {
    local alias_dir
    local -a alias_dirs=()
    if [ "$is_termux" = "true" ] && [ -n "${PREFIX:-}" ]; then
        alias_dirs+=("$PREFIX/bin" "$HOME/.local/bin")
    else
        alias_dirs+=("$HOME/.local/bin" "/usr/local/bin")
    fi

    # Also repair stale launchers in any writable PATH directory. This matters
    # when an older npm/global install shadows $PREFIX/bin/nexus.
    local path_dir
    local old_ifs="$IFS"
    IFS=:
    for path_dir in ${PATH:-}; do
        if [[ "$path_dir" == "$INSTALL_DIR" ]]; then
            continue
        fi
        if [[ -n "$path_dir" && -d "$path_dir" && -w "$path_dir" ]]; then
            if [[ -e "$path_dir/nexus" || -L "$path_dir/nexus" ]]; then
                alias_dirs+=("$path_dir")
            fi
        fi
    done
    # Guarantee the launcher is visible in the CURRENT shell: link into the
    # first writable directory already on $PATH. This covers env quirks where
    # $PREFIX/bin / $HOME/.local/bin are not yet on PATH, so `nexus` works
    # immediately without reloading the shell.
    for path_dir in ${PATH:-}; do
        if [[ -n "$path_dir" && -d "$path_dir" && -w "$path_dir" ]]; then
            alias_dirs+=("$path_dir")
            break
        fi
    done
    IFS="$old_ifs"

    local seen="|"
    for alias_dir in "${alias_dirs[@]}"; do
        case "$seen" in
            *"|$alias_dir|"*) continue ;;
        esac
        seen="${seen}${alias_dir}|"
        if ! mkdir -p "$alias_dir" 2>/dev/null; then
            sudo mkdir -p "$alias_dir" 2>/dev/null || continue
        fi
        if ln -sf "$INSTALL_DIR/nexus" "$alias_dir/nexus" 2>/dev/null; then
            ln -sf "$INSTALL_DIR/nexus" "$alias_dir/nx" 2>/dev/null
            ln -sf "$INSTALL_DIR/nexus" "$alias_dir/devhub" 2>/dev/null
            ln -sf "$INSTALL_DIR/nexus" "$alias_dir/opencode" 2>/dev/null
        else
            sudo ln -sf "$INSTALL_DIR/nexus" "$alias_dir/nexus" 2>/dev/null
            sudo ln -sf "$INSTALL_DIR/nexus" "$alias_dir/nx" 2>/dev/null
            sudo ln -sf "$INSTALL_DIR/nexus" "$alias_dir/devhub" 2>/dev/null
            sudo ln -sf "$INSTALL_DIR/nexus" "$alias_dir/opencode" 2>/dev/null
        fi
    done
}

install_command_alias

echo -e "\n${MUTED}NEXUS is installed.${NC}"
echo -e ""
echo -e "source <your-shell-config>  ${MUTED}# Reload PATH, if needed${NC}"
echo -e "nexus                   ${MUTED}# Run NEXUS (alias)${NC}"
echo -e "nexus                  ${MUTED}# Run NEXUS${NC}"
echo -e ""
echo -e "${MUTED}For more information visit ${NC}https://github.com/$REPO"
echo -e ""
