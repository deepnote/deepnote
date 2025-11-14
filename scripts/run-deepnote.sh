#!/bin/bash

# Deepnote notebook execution wrapper
# Auto-starts Deepnote Toolkit server if needed

set -e

DEEPNOTE_FILE="$1"
KERNEL_ID="$2"

if [ -z "$DEEPNOTE_FILE" ]; then
    echo "Usage: $0 <notebook.deepnote> [kernel-id]"
    exit 1
fi

# Check if deepnote-toolkit is installed
if ! command -v deepnote-toolkit &> /dev/null; then
    # Try extension's bundled version
    TOOLKIT_PATH=~/"Library/Application Support/Cursor/User/globalStorage/deepnote.vscode-deepnote/deepnote-venvs/*/bin/deepnote-toolkit"
    
    if compgen -G "$TOOLKIT_PATH" > /dev/null; then
        TOOLKIT_CMD=$(echo $TOOLKIT_PATH)
        echo "✓ Found deepnote-toolkit in extension venv"
    else
        echo "❌ deepnote-toolkit not found!"
        echo ""
        echo "Please install: pip install deepnote-toolkit[server]"
        exit 1
    fi
else
    TOOLKIT_CMD="deepnote-toolkit"
    echo "✓ Found deepnote-toolkit"
fi

# Check if Jupyter server is already running
RUNTIME_DIR="$HOME/Library/Jupyter/runtime"

if [ ! -d "$RUNTIME_DIR" ] || [ -z "$(ls -A $RUNTIME_DIR/kernel-*.json 2>/dev/null)" ]; then
    echo ""
    echo "📡 No active kernel found, starting Deepnote Toolkit server..."
    echo ""
    
    # Start server in background
    $TOOLKIT_CMD server --jupyter-port 8888 > /tmp/deepnote-toolkit.log 2>&1 &
    SERVER_PID=$!
    
    echo "✓ Server starting (PID: $SERVER_PID)"
    echo "  Logs: /tmp/deepnote-toolkit.log"
    echo ""
    echo "⏳ Waiting for server to be ready..."
    
    # Wait for kernel to be available (max 30 seconds)
    for i in {1..30}; do
        if [ -f "$RUNTIME_DIR"/kernel-*.json ]; then
            echo "✓ Kernel ready!"
            break
        fi
        sleep 1
        echo -n "."
    done
    echo ""
else
    echo "✓ Found active kernel"
fi

echo ""
echo "🚀 Executing notebook: $DEEPNOTE_FILE"
echo ""

# Run the execution script
if [ -n "$KERNEL_ID" ]; then
    python scripts/execute-deepnote.py "$DEEPNOTE_FILE" "$KERNEL_ID"
else
    python scripts/execute-deepnote.py "$DEEPNOTE_FILE"
fi

