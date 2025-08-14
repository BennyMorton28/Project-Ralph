const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');

class CalendarHelper {
  constructor() {
    this.auth = null;
    this.calendar = null;
  }

  async initialize() {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
    const { client_secret, client_id, redirect_uris } = credentials.installed;
    
    this.auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    this.auth.setCredentials(token);
    
    this.calendar = google.calendar({ version: 'v3', auth: this.auth });
  }

  async listCalendars() {
    if (!this.calendar) await this.initialize();
    
    try {
      const res = await this.calendar.calendarList.list();
      return res.data.items;
    } catch (error) {
      console.error('Error listing calendars:', error.message);
      throw error;
    }
  }

  async createEvent({
    summary,
    description = '',
    startDateTime,
    endDateTime,
    timeZone = 'America/New_York',
    calendarId = 'primary',
    attendees = []
  }) {
    if (!this.calendar) await this.initialize();

    const event = {
      summary,
      description,
      start: {
        dateTime: startDateTime,
        timeZone,
      },
      end: {
        dateTime: endDateTime,
        timeZone,
      },
      attendees: attendees.map(email => ({ email })),
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 }, // 1 day before
          { method: 'popup', minutes: 30 },     // 30 min before
        ],
      },
    };

    try {
      const res = await this.calendar.events.insert({
        calendarId,
        resource: event,
      });
      
      console.log('Event created:', res.data.htmlLink);
      return res.data;
    } catch (error) {
      console.error('Error creating event:', error.message);
      throw error;
    }
  }

  async createQuickEvent(text, calendarId = 'primary') {
    if (!this.calendar) await this.initialize();

    try {
      const res = await this.calendar.events.quickAdd({
        calendarId,
        text,
      });
      
      console.log('Quick event created:', res.data.htmlLink);
      return res.data;
    } catch (error) {
      console.error('Error creating quick event:', error.message);
      throw error;
    }
  }

  async getUpcomingEvents(maxResults = 10, calendarId = 'primary') {
    if (!this.calendar) await this.initialize();

    try {
      const res = await this.calendar.events.list({
        calendarId,
        timeMin: (new Date()).toISOString(),
        maxResults,
        singleEvents: true,
        orderBy: 'startTime',
      });

      return res.data.items;
    } catch (error) {
      console.error('Error getting events:', error.message);
      throw error;
    }
  }

  // Helper method to format date for Google Calendar
  static formatDateTime(date, time = '10:00') {
    const [hours, minutes] = time.split(':');
    const dateObj = new Date(date);
    dateObj.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    return dateObj.toISOString();
  }
}

module.exports = CalendarHelper;

// Example usage if running directly
if (require.main === module) {
  const helper = new CalendarHelper();
  
  async function examples() {
    try {
      // List calendars
      console.log('=== Available Calendars ===');
      const calendars = await helper.listCalendars();
      calendars.forEach(cal => {
        console.log(`${cal.summary} (${cal.id})`);
      });

      // Create a sample event
      console.log('\n=== Creating Sample Event ===');
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const event = await helper.createEvent({
        summary: 'Test Calendar Integration',
        description: 'Testing Google Calendar API integration from Project Ralph',
        startDateTime: CalendarHelper.formatDateTime(tomorrow, '14:00'),
        endDateTime: CalendarHelper.formatDateTime(tomorrow, '15:00'),
        attendees: [] // Add email addresses here if needed
      });

      console.log('Event created successfully!');
      
      // Get upcoming events
      console.log('\n=== Upcoming Events ===');
      const events = await helper.getUpcomingEvents(5);
      if (events.length === 0) {
        console.log('No upcoming events found.');
      } else {
        events.forEach(event => {
          const start = event.start.dateTime || event.start.date;
          console.log(`${start}: ${event.summary}`);
        });
      }

    } catch (error) {
      console.error('Example failed:', error.message);
      if (error.message.includes('insufficient authentication scopes')) {
        console.log('\nYou need to re-authenticate with Calendar permissions.');
        console.log('Run: node setup-calendar-auth.js auth');
      }
    }
  }

  examples();
}