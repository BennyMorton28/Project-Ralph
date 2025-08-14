const express = require('express');
const cors = require('cors');
const path = require('path');
const CalendarHelper = require('./calendar-helper');

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Serve the mobile app
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'mobile-calendar-app.html'));
});

// Natural language event parsing
function parseEventMessage(message) {
    const result = {
        title: '',
        date: new Date(),
        time: '12:00 PM',
        duration: 30 // minutes
    };

    // Clean up the message
    let cleanMessage = message.trim();
    
    // Extract time
    const timePatterns = [
        /(\d{1,2}):(\d{2})\s*(am|pm)/i,  // 2:30 PM
        /(\d{1,2})\s*(am|pm)/i,          // 2 PM
        /(\d{1,2}):(\d{2})/,             // 14:30 (24hr)
    ];
    
    let timeMatch = null;
    for (const pattern of timePatterns) {
        timeMatch = cleanMessage.match(pattern);
        if (timeMatch) break;
    }
    
    if (timeMatch) {
        result.time = timeMatch[0];
        cleanMessage = cleanMessage.replace(timeMatch[0], '').trim();
    }
    
    // Extract date/day references
    const dayPatterns = {
        'today': 0,
        'tomorrow': 1,
        'monday': getNextDayOfWeek(1),
        'tuesday': getNextDayOfWeek(2),
        'wednesday': getNextDayOfWeek(3),
        'thursday': getNextDayOfWeek(4),
        'friday': getNextDayOfWeek(5),
        'saturday': getNextDayOfWeek(6),
        'sunday': getNextDayOfWeek(0)
    };
    
    let dayOffset = 0;
    for (const [day, offset] of Object.entries(dayPatterns)) {
        if (cleanMessage.toLowerCase().includes(day)) {
            dayOffset = typeof offset === 'function' ? offset() : offset;
            cleanMessage = cleanMessage.replace(new RegExp(day, 'gi'), '').trim();
            break;
        }
    }
    
    // Set the date
    result.date = new Date();
    result.date.setDate(result.date.getDate() + dayOffset);
    
    // Extract specific date patterns (MM/DD, MM-DD, etc.)
    const dateMatch = cleanMessage.match(/(\d{1,2})[\/\-](\d{1,2})/);
    if (dateMatch) {
        const month = parseInt(dateMatch[1]) - 1; // JS months are 0-indexed
        const day = parseInt(dateMatch[2]);
        result.date = new Date();
        result.date.setMonth(month);
        result.date.setDate(day);
        if (result.date < new Date()) {
            result.date.setFullYear(result.date.getFullYear() + 1); // Next year if past
        }
        cleanMessage = cleanMessage.replace(dateMatch[0], '').trim();
    }
    
    // Clean up common words
    const cleanupWords = ['at', 'on', 'for', 'with', 'the', 'a', 'an'];
    cleanupWords.forEach(word => {
        cleanMessage = cleanMessage.replace(new RegExp(`\\b${word}\\b`, 'gi'), ' ');
    });
    
    result.title = cleanMessage.replace(/\s+/g, ' ').trim() || 'Event';
    
    return result;
}

function getNextDayOfWeek(targetDay) {
    return () => {
        const today = new Date();
        const currentDay = today.getDay();
        let daysUntilTarget = targetDay - currentDay;
        if (daysUntilTarget <= 0) {
            daysUntilTarget += 7; // Next week
        }
        return daysUntilTarget;
    };
}

function formatDateTime(date, timeStr) {
    const dateObj = new Date(date);
    
    // Parse time string
    const timeMatch = timeStr.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
    if (timeMatch) {
        let hours = parseInt(timeMatch[1]);
        let minutes = parseInt(timeMatch[2] || 0);
        const ampm = timeMatch[3]?.toLowerCase();
        
        if (ampm === 'pm' && hours !== 12) {
            hours += 12;
        } else if (ampm === 'am' && hours === 12) {
            hours = 0;
        }
        
        dateObj.setHours(hours, minutes, 0, 0);
    }
    
    return dateObj.toISOString();
}

// API endpoint to create calendar events
app.post('/api/create-event', async (req, res) => {
    try {
        const { message } = req.body;
        
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }
        
        // Parse the natural language message
        const parsed = parseEventMessage(message);
        
        // Create the calendar event
        const cal = new CalendarHelper();
        
        const startDateTime = formatDateTime(parsed.date, parsed.time);
        const endDate = new Date(startDateTime);
        endDate.setMinutes(endDate.getMinutes() + parsed.duration);
        const endDateTime = endDate.toISOString();
        
        const event = await cal.createEvent({
            summary: parsed.title,
            description: `Created from: "${message}"`,
            startDateTime,
            endDateTime,
            timeZone: 'America/New_York'
        });
        
        res.json({
            success: true,
            title: parsed.title,
            date: parsed.date.toLocaleDateString(),
            time: parsed.time,
            eventUrl: event.htmlLink,
            originalMessage: message
        });
        
    } catch (error) {
        console.error('Error creating event:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to create calendar event'
        });
    }
});

// Test endpoint to check if the API is working
app.get('/api/test', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Calendar API is working',
        timestamp: new Date().toISOString()
    });
});

// Example parsing endpoint
app.post('/api/parse', (req, res) => {
    const { message } = req.body;
    const parsed = parseEventMessage(message);
    res.json(parsed);
});

app.listen(port, () => {
    console.log(`Mobile Calendar Server running at http://localhost:${port}`);
    console.log(`Open http://localhost:${port} on your phone to use the app`);
});

module.exports = app;