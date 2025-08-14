const CalendarHelper = require('./calendar-helper');

const aigAssignments = [
  { section: '30A', professor: 'Spenkuch', date: '9/3/25', time: '8:00 AM' },
  { section: '30B', professor: 'Spenkuch', date: '9/3/25', time: '8:00 AM' },
  { section: '33', professor: 'Persico', date: '9/11/25', time: '8:00 AM' },
  { section: '34', professor: 'Persico', date: '9/11/25', time: '8:00 AM' },
  { section: '35', professor: 'Spenkuch', date: '9/14/25', time: '8:00 AM' },
  { section: '36', professor: 'Persico', date: '9/14/25', time: '8:00 AM' },
  { section: '31', professor: 'Persico', date: '9/16/25', time: '8:00 AM' },
  { section: '81', professor: 'Spenkuch', date: '9/16/25', time: '8:00 AM' },
  { section: '32', professor: 'Deserranno', date: '10/5/25', time: '8:00 AM' },
  { section: '38', professor: 'Persico', date: '10/18/25', time: '8:00 AM' },
  { section: '39', professor: 'Baliga', date: '10/19/25', time: '8:00 AM' },
  { section: '37', professor: 'Baliga', date: '10/28/25', time: '8:00 AM' },
  { section: '82', professor: 'Spenkuch', date: '10/28/25', time: '8:00 AM' }
];

function parseDateTime(dateStr, timeStr) {
  // Convert date from M/D/YY to full date
  const [month, day, year] = dateStr.split('/');
  const fullYear = `20${year}`;
  
  // Convert time to 24-hour format
  const [time, ampm] = timeStr.split(' ');
  const [hours, minutes] = time.split(':');
  let hour24 = parseInt(hours);
  
  if (ampm === 'PM' && hour24 !== 12) {
    hour24 += 12;
  } else if (ampm === 'AM' && hour24 === 12) {
    hour24 = 0;
  }
  
  // Create ISO datetime string (assuming Eastern Time)
  const date = new Date(fullYear, month - 1, day, hour24, parseInt(minutes));
  return date.toISOString();
}

async function createAIGEvents() {
  const cal = new CalendarHelper();
  await cal.initialize();
  
  console.log('Creating AIG release events...\n');
  
  const results = [];
  
  for (const assignment of aigAssignments) {
    const { section, professor, date, time } = assignment;
    
    try {
      const startDateTime = parseDateTime(date, time);
      const endDate = new Date(startDateTime);
      endDate.setMinutes(endDate.getMinutes() + 30); // 30-minute events
      const endDateTime = endDate.toISOString();
      
      const eventTitle = `Release AIG Case for ${professor} ${section}`;
      
      const event = await cal.createEvent({
        summary: eventTitle,
        description: `AIG case release for Section ${section} with Professor ${professor}`,
        startDateTime,
        endDateTime,
        timeZone: 'America/New_York',
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 },    // 1 day before
            { method: 'popup', minutes: 2 * 60 },     // 2 hours before
            { method: 'popup', minutes: 5 }           // 5 minutes before
          ]
        }
      });
      
      console.log(`✅ Created: ${eventTitle} - ${date} at ${time}`);
      console.log(`   Link: ${event.htmlLink}`);
      
      results.push({
        success: true,
        title: eventTitle,
        date,
        time,
        link: event.htmlLink
      });
      
    } catch (error) {
      console.error(`❌ Failed to create event for ${professor} ${section}: ${error.message}`);
      results.push({
        success: false,
        title: `Release AIG Case for ${professor} ${section}`,
        date,
        time,
        error: error.message
      });
    }
    
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Summary
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`\n=== SUMMARY ===`);
  console.log(`Successfully created: ${successful} events`);
  console.log(`Failed: ${failed} events`);
  
  if (failed > 0) {
    console.log('\nFailed events:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`- ${r.title}: ${r.error}`);
    });
  }
  
  return results;
}

// Enhanced createEvent method that accepts custom reminders
CalendarHelper.prototype.createEventWithCustomReminders = async function({
  summary,
  description = '',
  startDateTime,
  endDateTime,
  timeZone = 'America/New_York',
  calendarId = 'primary',
  attendees = [],
  reminders
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
    reminders: reminders || {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 },
        { method: 'popup', minutes: 30 },
      ],
    },
  };

  try {
    const res = await this.calendar.events.insert({
      calendarId,
      resource: event,
    });
    
    return res.data;
  } catch (error) {
    console.error('Error creating event:', error.message);
    throw error;
  }
};

// Override the createEvent method to use custom reminders
CalendarHelper.prototype.createEvent = CalendarHelper.prototype.createEventWithCustomReminders;

if (require.main === module) {
  createAIGEvents().catch(console.error);
}

module.exports = { createAIGEvents, aigAssignments };