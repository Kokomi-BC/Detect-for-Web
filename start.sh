#!/bin/bash

# Check if pm2 is installed
if ! command -v pm2 &> /dev/null
then
    echo "PM2 not found. Installing PM2 globally..."
    cnpm install -g pm2
fi

echo "Installing dependencies..."
cnpm install

echo "Building project..."
npm run build

# Restart the process if it exists, otherwise start it
if pm2 describe fake-news-detector > /dev/null; then
    echo "Restarting existing process..."
    pm2 restart fake-news-detector
else
    echo "Starting new process..."
    pm2 start ecosystem.config.js
fi

# Save pm2 list to restart on reboot
pm2 save

echo "------------------------------------------------"
echo "Application started persistently."
echo "Use 'pm2 status' to check status."
echo "Use 'pm2 logs' to view logs."
echo "------------------------------------------------"
