#!/bin/bash

# Default values
SKIP_BUILD=false

# Simple flag parsing
for arg in "$@"; do
    if [[ "$arg" == "--quick" || "$arg" == "-q" ]]; then
        SKIP_BUILD=true
    fi
done

if [ "$SKIP_BUILD" = false ]; then
    echo "Building project (Full build)..."
    npm run build
else
    echo "Skipping build (Quick restart)..."
fi

# Detect if we should run in DEV mode (Foreground + Hot Updates)
# Use --dev argument to trigger this
RUN_DEV=false
for arg in "$@"; do
    if [[ "$arg" == "--dev" ]]; then
        RUN_DEV=true
    fi
done

if [ "$RUN_DEV" = true ]; then
    echo "Starting in DEVELOPMENT mode..."
    echo "Starting Backend and Frontend concurrently..."
    
    # Check if we have concurrently installed, or just background one
    # Assuming basic env, we use simple backgrounding
    
    # 1. Start Server in background (using node directly or nodemon if you have it)
    node src/server.js &
    SERVER_PID=$!
    
    # 2. Start Vite Dev Server in foreground
    echo "Starting Vite Dev Server..."
    npm run dev
    
    # When vite exits, kill server
    kill $SERVER_PID
    exit 0
fi

# Restart the process if it exists, otherwise start it
if pm2 describe fake-news-detector > /dev/null 2>&1; then
    echo "Restarting existing process..."
    pm2 restart fake-news-detector
else
    echo "Starting new process..."
    pm2 start ecosystem.config.js
fi

pm2 save --force

echo "------------------------------------------------"
echo "Application started persistently."
echo "Use 'pm2 status' to check status."
echo "Use 'pm2 logs' to view logs."
echo "------------------------------------------------"
