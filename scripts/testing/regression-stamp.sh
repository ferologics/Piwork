#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT_DIR"

STAMP_DIR=".git/piwork"
STAMP_FILE="$STAMP_DIR/regressions-last-success"

current_head() {
    git rev-parse --verify HEAD 2>/dev/null || true
}

working_tree_clean() {
    git diff --quiet --ignore-submodules -- && git diff --cached --quiet --ignore-submodules --
}

read_stamp_head() {
    if [[ ! -f "$STAMP_FILE" ]]; then
        return 1
    fi

    awk -F= '/^head=/{print $2}' "$STAMP_FILE"
}

write_stamp() {
    local head
    head=$(current_head)

    if [[ -z "$head" ]]; then
        echo "[regressions] no HEAD commit; skipping success stamp"
        return 0
    fi

    if ! working_tree_clean; then
        echo "[regressions] working tree is dirty; skipping success stamp"
        return 0
    fi

    mkdir -p "$STAMP_DIR"
    {
        printf 'head=%s\n' "$head"
        printf 'timestamp=%s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    } > "$STAMP_FILE"

    echo "[regressions] recorded success stamp for HEAD ${head:0:8}"
}

matches_head() {
    local head stamp_head

    head=$(current_head)
    if [[ -z "$head" ]]; then
        return 1
    fi

    stamp_head=$(read_stamp_head 2>/dev/null || true)
    if [[ -z "$stamp_head" ]]; then
        return 1
    fi

    [[ "$head" == "$stamp_head" ]]
}

show_stamp() {
    if [[ ! -f "$STAMP_FILE" ]]; then
        echo "[regressions] no stamp"
        return 0
    fi

    cat "$STAMP_FILE"
}

clear_stamp() {
    rm -f "$STAMP_FILE"
    echo "[regressions] cleared success stamp"
}

command="${1:-show}"

case "$command" in
    write)
        write_stamp
        ;;
    matches-head)
        if matches_head; then
            exit 0
        fi
        exit 1
        ;;
    clear)
        clear_stamp
        ;;
    show)
        show_stamp
        ;;
    *)
        echo "Usage: $0 {write|matches-head|clear|show}"
        exit 2
        ;;
esac
