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
    npm run build:renderer
else
    echo "Skipping build (Quick restart)..."
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
