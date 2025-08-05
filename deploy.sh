#!/bin/bash

# Simple deployment script for Project Ralph
# Run this from your home computer to deploy changes

echo "🚀 Deploying Project Ralph..."

# Pull latest changes first
echo "📥 Pulling latest changes..."
git pull

# Add all changes
git add .

# Get commit message
echo "Enter commit message (or press Enter for default):"
read message

# Use default if no message
if [ -z "$message" ]; then
    message="Update Project Ralph"
fi

# Commit and push
git commit -m "$message"
git push

echo "✅ Deployed! Dashboard will update in 2-5 minutes."
echo "🌐 URL: https://bennymorton28.github.io/Project-Ralph" 