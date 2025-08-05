# Cloud Storage Setup Guide

To make your Project Ralph data persistent across devices and sessions (so it doesn't reset when you refresh the page), you need to set up cloud storage using JSONBin.io.

## Step 1: Get a JSONBin.io API Key

1. Go to [JSONBin.io](https://jsonbin.io/)
2. Sign up for a free account
3. Go to your dashboard
4. Copy your API key (it looks like: `$2a$10$...`)

## Step 2: Update the Configuration

1. Open `index.html` in your code editor
2. Find these lines near the top of the `<script>` section:
   ```javascript
   const JSONBIN_API_KEY = 'YOUR_JSONBIN_API_KEY'; // You'll need to get this from jsonbin.io
   const JSONBIN_BIN_ID = 'YOUR_BIN_ID'; // This will be created when you first save data
   ```

3. Replace `'YOUR_JSONBIN_API_KEY'` with your actual API key:
   ```javascript
   const JSONBIN_API_KEY = '$2a$10$your_actual_api_key_here';
   ```

4. Leave `JSONBIN_BIN_ID` as `'YOUR_BIN_ID'` for now - it will be automatically created when you first save data.

## Step 3: Test the Setup

1. Save the `index.html` file
2. Open it in your browser
3. Make some changes (edit interactions, add tasks, etc.)
4. Refresh the page - your data should now persist!

## How It Works

- **Local Storage**: Data is saved to your browser's localStorage as a backup
- **Cloud Storage**: Data is also saved to JSONBin.io cloud storage
- **Automatic Sync**: Every time you make changes, data is saved to both local and cloud storage
- **Cross-Device**: Your data will be available on any device that accesses your GitHub Pages site

## Troubleshooting

If you see errors in the browser console:
1. Make sure your API key is correct
2. Check that you have an active internet connection
3. Verify your JSONBin.io account is active

## Security Note

The API key is visible in the HTML file, but JSONBin.io free accounts have rate limits and the data is not publicly accessible without the key. For production use, consider using environment variables or a more secure backend solution.

## Alternative Solutions

If you prefer not to use JSONBin.io, you could also:
1. Use Firebase Firestore (free tier available)
2. Use Supabase (free tier available)
3. Set up a simple backend server
4. Use GitHub's API to store data in a repository

The current solution with JSONBin.io is the simplest to set up and requires no backend development. 