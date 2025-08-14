const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// Load client secrets from a local file.
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');

// Define the scope for Calendar API
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/calendar' // Add calendar scope
];

async function authorize() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  // Generate authorization URL
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  console.log('Authorize this app by visiting this url:', authUrl);
  console.log('\nAfter authorizing, you will be redirected to a page that may not load.');
  console.log('Copy the "code" parameter from the URL and paste it here.');
  
  // In a real scenario, you would get the code from user input
  // For now, just show the URL
  return authUrl;
}

// Function to exchange code for token (run this after getting the code)
async function getToken(code) {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log('Token stored to', TOKEN_PATH);
    return tokens;
  } catch (error) {
    console.error('Error retrieving access token', error);
    throw error;
  }
}

// Test calendar access
async function testCalendarAccess() {
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  oAuth2Client.setCredentials(token);
  
  const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
  
  try {
    const res = await calendar.calendarList.list();
    console.log('Calendar access successful!');
    console.log('Available calendars:');
    res.data.items.forEach(cal => {
      console.log(`- ${cal.summary} (${cal.id})`);
    });
    return res.data.items;
  } catch (error) {
    console.error('Calendar access failed:', error.message);
    throw error;
  }
}

// Export functions for use
module.exports = {
  authorize,
  getToken,
  testCalendarAccess
};

// If running directly
if (require.main === module) {
  const action = process.argv[2];
  
  if (action === 'auth') {
    authorize().then(url => {
      console.log('\n=== NEXT STEPS ===');
      console.log('1. Click the URL above');
      console.log('2. Sign in and authorize the application');
      console.log('3. Copy the code from the redirect URL');
      console.log('4. Run: node setup-calendar-auth.js token YOUR_CODE_HERE');
    });
  } else if (action === 'token') {
    const code = process.argv[3];
    if (!code) {
      console.error('Please provide the authorization code');
      process.exit(1);
    }
    getToken(code);
  } else if (action === 'test') {
    testCalendarAccess();
  } else {
    console.log('Usage:');
    console.log('  node setup-calendar-auth.js auth    # Get authorization URL');
    console.log('  node setup-calendar-auth.js token CODE  # Exchange code for token');
    console.log('  node setup-calendar-auth.js test    # Test calendar access');
  }
}