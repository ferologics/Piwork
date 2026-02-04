#!/bin/bash
# Take a screenshot of the Piwork app window
# Usage: ./screenshot-piwork.sh [output-path]

OUTPUT="${1:-/tmp/piwork-screenshot.png}"

# Get window ID
WINDOW_ID=$(/tmp/windowlist 2>/dev/null | head -1)

if [ -z "$WINDOW_ID" ]; then
    echo "Piwork not running or window not found"
    exit 1
fi

# Briefly activate to ensure webview renders, then capture
osascript -e 'tell application "piwork" to activate' 2>/dev/null
sleep 0.3
screencapture -o -l"$WINDOW_ID" "$OUTPUT"

echo "Screenshot saved to $OUTPUT"
