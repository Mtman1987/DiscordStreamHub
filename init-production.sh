#!/bin/bash

# Production Startup Script
# This script initializes the polling service after deployment

APP_URL="${1:-https://discord-stream-hub.fly.dev}"

echo "🚀 Initializing Discord Stream Hub..."
echo "📍 Target: $APP_URL"
echo ""

# Check health first
echo "🏥 Checking health endpoint..."
HEALTH=$(curl -s "$APP_URL/api/health")
echo "$HEALTH"
echo ""

# Initialize services
echo "⚡ Starting polling services..."
RESULT=$(curl -s -X POST "$APP_URL/api/startup")
echo "$RESULT"
echo ""

# Verify polling started
echo "✅ Verifying polling status..."
sleep 2
HEALTH=$(curl -s "$APP_URL/api/health")
echo "$HEALTH"
echo ""

if echo "$HEALTH" | grep -q '"active":true'; then
    echo "✅ SUCCESS! Polling is active and running."
else
    echo "⚠️  WARNING: Polling may not be active. Check the local data 'twitchPollingActive' flag."
fi
