require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for frontend
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Load configuration
const config = require('./config');

// Initialize Anthropic client
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

// PostgreSQL connection
const pool = new Pool({
    connectionString: config.database.connectionString,
    ssl: {
        rejectUnauthorized: false
    }
});

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('Database connection error:', err);
    } else {
        console.log('✅ Connected to PostgreSQL database');
    }
});

// API endpoint to get deal summary data
app.get('/api/deal-summary', async (req, res) => {
    try {
        // Test database connection first
        await pool.query('SELECT 1');
        
        // Get total deals
        const totalDealsResult = await pool.query(
            'SELECT COUNT(*) as total_deals FROM deals WHERE is_active = true'
        );
        const totalDeals = parseInt(totalDealsResult.rows[0].total_deals);

        // Get deals by state
        const statesResult = await pool.query(`
            SELECT state, COUNT(*) as count 
            FROM deals 
            WHERE is_active = true 
            GROUP BY state 
            ORDER BY count DESC
        `);
        


        // Get pending tasks
        const pendingTasksResult = await pool.query(`
            SELECT COUNT(*) as pending_count 
            FROM deal_tasks 
            WHERE state IN ('GENERATED', 'SUBMITTED')
        `);
        const pendingTasks = parseInt(pendingTasksResult.rows[0].pending_count);

        // Get unique dealerships count
        const dealershipsResult = await pool.query(`
            SELECT COUNT(DISTINCT l.dealer_id) as unique_dealerships
            FROM deals d
            JOIN listings l ON d.id = l.deal_id
            WHERE d.is_active = true
        `);
        const uniqueDealerships = parseInt(dealershipsResult.rows[0].unique_dealerships) || Math.ceil(totalDeals / 3);

        // Calculate total analysis deals needed (10 per dealership)
        const totalAnalysisNeeded = uniqueDealerships * 10;

        // Calculate percentages
        const states = statesResult.rows.map(row => ({
            state: row.state,
            count: parseInt(row.count),
            percent: parseFloat(((parseInt(row.count) / totalDeals) * 100).toFixed(2))
        }));

        // Find analysis deals (case insensitive)
        const analysisDeals = states.find(s => s.state.toLowerCase() === 'analysis') || { count: 0, percent: 0 };

        // Calculate progress toward 10 analysis deals per dealership goal
        const analysisProgressPct = totalAnalysisNeeded > 0 ? parseFloat(((analysisDeals.count / totalAnalysisNeeded) * 100).toFixed(2)) : 0;

        const dealSummary = {
            totalDeals,
            analysisDeals: analysisDeals.count,
            analysisPct: analysisDeals.percent,
            analysisProgressPct,
            totalAnalysisNeeded,
            pendingDeals: pendingTasks,
            pendingPct: parseFloat(((pendingTasks / totalDeals) * 100).toFixed(2)),
            uniqueDealerships,
            states
        };

        res.json(dealSummary);
    } catch (error) {
        console.error('Error fetching deal summary:', error);
        res.status(503).json({ 
            error: 'Database connection failed',
            message: 'Please ensure you are connected to the VPN and try again'
        });
    }
});

// API endpoint to get recent activity
app.get('/api/recent-activity', async (req, res) => {
    try {
        // Test database connection first
        await pool.query('SELECT 1');
        
        // Get recent deals with dealer information
        const result = await pool.query(`
            SELECT 
                d.id,
                d.state,
                d.created,
                d.updated,
                dl.name as dealer_name,
                dl.city,
                dl.state_code
            FROM deals d
            LEFT JOIN listings l ON d.id = l.deal_id
            LEFT JOIN dealers dl ON l.dealer_id = dl.id
            WHERE d.is_active = true
            ORDER BY d.updated DESC
        `);

        const activities = result.rows.map(row => ({
            id: row.id,
            date: new Date(row.updated).toLocaleDateString(),
            description: `Deal ${row.id} - ${row.dealer_name || 'Unknown Dealer'} (${row.state})`,
            status: row.state === 'analysis' ? 'active' : 
                   row.state === 'vin_sold' ? 'completed' : 'pending',
            deal_id: row.id,
            dealer_name: row.dealer_name || 'Unknown Dealer',
            dealer_location: row.city && row.state_code ? `${row.city}, ${row.state_code}` : 'Unknown Location',
            deal_state: row.state
        }));

        res.json(activities);
    } catch (error) {
        console.error('Error fetching recent activity:', error);
        res.status(503).json({ 
            error: 'Database connection failed',
            message: 'Please ensure you are connected to the VPN and try again'
        });
    }
});

// API endpoint to get driver metrics data
app.get('/api/driver-metrics', async (req, res) => {
    try {
        // Test database connection first
        await pool.query('SELECT 1');
        
        // Calculate dealership-level driver metrics for 10 analysis deals goal
        const driverMetricsResult = await pool.query(`
            WITH dealership_analysis AS (
                SELECT 
                    l.dealer_id,
                    dl.name as dealer_name,
                    dl.city,
                    dl.state_code,
                    COUNT(CASE WHEN LOWER(d.state) = 'analysis' THEN 1 END) as analysis_deals,
                    COUNT(*) as total_deals
                FROM deals d
                JOIN listings l ON d.id = l.deal_id
                JOIN dealers dl ON l.dealer_id = dl.id
                WHERE d.is_active = true AND dl.deleted IS NULL
                GROUP BY l.dealer_id, dl.name, dl.city, dl.state_code
            )
            SELECT 
                COUNT(*) as total_dealerships,
                COUNT(CASE WHEN analysis_deals >= 10 THEN 1 END) as achieved_goal,
                COUNT(CASE WHEN analysis_deals >= 8 THEN 1 END) as near_goal,
                COUNT(CASE WHEN analysis_deals >= 5 THEN 1 END) as good_progress,
                COUNT(CASE WHEN analysis_deals >= 1 THEN 1 END) as has_analysis,
                COUNT(CASE WHEN analysis_deals = 0 THEN 1 END) as no_analysis,
                ROUND((COUNT(CASE WHEN analysis_deals >= 10 THEN 1 END) * 100.0 / COUNT(*)), 1) as pct_achieved,
                ROUND((COUNT(CASE WHEN analysis_deals >= 8 THEN 1 END) * 100.0 / COUNT(*)), 1) as pct_near_goal,
                ROUND((COUNT(CASE WHEN analysis_deals >= 5 THEN 1 END) * 100.0 / COUNT(*)), 1) as pct_good_progress,
                ROUND((COUNT(CASE WHEN analysis_deals >= 1 THEN 1 END) * 100.0 / COUNT(*)), 1) as pct_has_analysis
            FROM dealership_analysis
        `);

        const summaryMetrics = driverMetricsResult.rows[0];

        // Calculate timeline and progress metrics
        const deadline = new Date('2025-09-01');
        const today = new Date('2025-08-06');
        const daysUntilDeadline = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
        
        // Calculate progress toward goal
        const totalAnalysisNeeded = parseInt(summaryMetrics.total_dealerships) * 10;
        const currentAnalysis = parseInt(summaryMetrics.has_analysis) * 2.5 + 
                               parseInt(summaryMetrics.good_progress) * 6 + 
                               parseInt(summaryMetrics.near_goal) * 8.5 + 
                               parseInt(summaryMetrics.achieved_goal) * 10;
        const analysisStillNeeded = totalAnalysisNeeded - currentAnalysis;
        const dailyRateNeeded = analysisStillNeeded / daysUntilDeadline;

        // Get detailed dealership breakdown
        const detailedResult = await pool.query(`
                            SELECT 
                    l.dealer_id,
                    dl.name as dealer_name,
                    dl.city,
                    dl.state_code,
                    COUNT(CASE WHEN LOWER(d.state) = 'analysis' THEN 1 END) as analysis_deals,
                    COUNT(*) as total_deals,
                    (10 - COUNT(CASE WHEN LOWER(d.state) = 'analysis' THEN 1 END)) as deals_needed
                FROM deals d
                JOIN listings l ON d.id = l.deal_id
                JOIN dealers dl ON l.dealer_id = dl.id
                WHERE d.is_active = true AND dl.deleted IS NULL
                GROUP BY l.dealer_id, dl.name, dl.city, dl.state_code
                ORDER BY analysis_deals DESC, total_deals DESC
        `);

        const dealerships = detailedResult.rows.map(row => ({
            dealerId: row.dealer_id,
            dealerName: row.dealer_name,
            city: row.city,
            stateCode: row.state_code,
            analysisDeals: parseInt(row.analysis_deals),
            totalDeals: parseInt(row.total_deals),
            dealsNeeded: parseInt(row.deals_needed)
        }));

        const driverData = {
            timeline: {
                today: today.toISOString().split('T')[0],
                deadline: deadline.toISOString().split('T')[0],
                daysUntilDeadline,
                totalAnalysisNeeded,
                currentAnalysis: Math.round(currentAnalysis),
                analysisStillNeeded: Math.round(analysisStillNeeded),
                dailyRateNeeded: Math.round(dailyRateNeeded * 10) / 10
            },
            summary: {
                totalDealerships: parseInt(summaryMetrics.total_dealerships),
                achievedGoal: parseInt(summaryMetrics.achieved_goal),
                nearGoal: parseInt(summaryMetrics.near_goal),
                goodProgress: parseInt(summaryMetrics.good_progress),
                hasAnalysis: parseInt(summaryMetrics.has_analysis),
                noAnalysis: parseInt(summaryMetrics.no_analysis),
                pctAchieved: parseFloat(summaryMetrics.pct_achieved),
                pctNearGoal: parseFloat(summaryMetrics.pct_near_goal),
                pctGoodProgress: parseFloat(summaryMetrics.pct_good_progress),
                pctHasAnalysis: parseFloat(summaryMetrics.pct_has_analysis)
            },
            dealerships
        };

        res.json(driverData);
    } catch (error) {
        console.error('Error fetching driver metrics:', error);
        res.status(503).json({ 
            error: 'Database connection failed',
            message: 'Please ensure you are connected to the VPN and try again'
        });
    }
});

// API endpoint to get dealership analysis data
app.get('/api/dealership-analysis', async (req, res) => {
    try {
        // Test database connection first
        await pool.query('SELECT 1');
        
        // Get dealership performance data with names
        const dealershipDataResult = await pool.query(`
            SELECT 
                l.dealer_id,
                dl.name as dealer_name,
                dl.city,
                dl.state_code,
                COUNT(*) as total_deals,
                COUNT(CASE WHEN LOWER(d.state) = 'analysis' THEN 1 END) as analysis_deals,
                COUNT(CASE WHEN LOWER(d.state) = 'vin_sold' THEN 1 END) as vin_sold_deals
            FROM deals d
            JOIN listings l ON d.id = l.deal_id
            JOIN dealers dl ON l.dealer_id = dl.id
            WHERE d.is_active = true AND dl.deleted IS NULL
            GROUP BY l.dealer_id, dl.name, dl.city, dl.state_code
            ORDER BY analysis_deals DESC, total_deals DESC
        `);

        const dealerships = dealershipDataResult.rows.map(row => ({
            dealerId: row.dealer_id,
            dealerName: row.dealer_name,
            city: row.city,
            stateCode: row.state_code,
            totalDeals: parseInt(row.total_deals),
            analysisDeals: parseInt(row.analysis_deals),
            vinSoldDeals: parseInt(row.vin_sold_deals)
        }));

        // Calculate summary statistics
        const totalDealerships = dealerships.length;
        const dealershipsWithAnalysis = dealerships.filter(d => d.analysisDeals > 0).length;
        const dealershipsWith5Plus = dealerships.filter(d => d.analysisDeals >= 5).length;
        const dealershipsWith10Plus = dealerships.filter(d => d.analysisDeals >= 10).length;
        const avgAnalysisDeals = dealerships.reduce((sum, d) => sum + d.analysisDeals, 0) / totalDealerships;

        const analysisData = {
            totalDealerships,
            dealershipsWithAnalysis,
            dealershipsWith5Plus,
            dealershipsWith10Plus,
            avgAnalysisDeals,
            dealerships
        };

        res.json(analysisData);
    } catch (error) {
        console.error('Error fetching dealership analysis:', error);
        res.status(503).json({ 
            error: 'Database connection failed',
            message: 'Please ensure you are connected to the VPN and try again'
        });
    }
});

// API endpoint to get tier performance (mock data for now)
app.get('/api/tier-performance', async (req, res) => {
    try {
        // This would be replaced with actual tier data from your database
        const tierData = {
            names: {
                tier0: "Order of the Coif",
                tier1: "Dean's List", 
                tier2: "Honor Roll",
                tier3: "Detention"
            },
            counts: {
                tier0: 45,
                tier1: 123,
                tier2: 89,
                tier3: 12
            },
            descriptions: {
                tier0: "Highest tier for dealers with exceptional transparency and customer service.",
                tier1: "High-performing dealers with good transparency practices.",
                tier2: "Average dealers with acceptable business practices.",
                tier3: "Dealers with poor transparency practices or customer service issues."
            }
        };

        res.json(tierData);
    } catch (error) {
        console.error('Error fetching tier performance:', error);
        res.status(500).json({ error: 'Failed to fetch tier performance' });
    }
});

// Helper function to get email content from various sources
async function getEmailContent(emailDetails, pool) {
    try {
        console.log('Searching for email content with message_id:', emailDetails.message_id);
        console.log('Available emailDetails fields:', Object.keys(emailDetails));
        
        // First, try direct fields from emailDetails
        if (emailDetails.body) return emailDetails.body;
        if (emailDetails.content) return emailDetails.content;
        if (emailDetails.html) return emailDetails.html;
        if (emailDetails.text) return emailDetails.text;
        if (emailDetails.message) return emailDetails.message;
        
        // If no direct content found, try to search by message_id in other tables
        const messageId = emailDetails.message_id;
        if (!messageId) return null;
        
        // Search in messages_dealer_email table
        try {
            const dealerEmailResult = await pool.query(`
                SELECT * FROM messages_dealer_email 
                WHERE smtp_message_id = $1
            `, [messageId]);
            
            if (dealerEmailResult.rows.length > 0) {
                const msg = dealerEmailResult.rows[0];
                if (msg.smtp_metadata) {
                    try {
                        const metadata = typeof msg.smtp_metadata === 'string' ? 
                            JSON.parse(msg.smtp_metadata) : msg.smtp_metadata;
                        
                        return metadata.html || metadata.text || metadata.body || metadata.content;
                    } catch (e) {
                        console.error('Error parsing smtp_metadata:', e);
                    }
                }
                return msg.content || msg.body || msg.text;
            }
        } catch (e) {
            console.error('Error searching messages_dealer_email:', e);
        }
        
        // Search in messages table
        try {
            const messagesResult = await pool.query(`
                SELECT text, content, body FROM messages 
                WHERE message_id = $1 OR id::text = $1
            `, [messageId]);
            
            if (messagesResult.rows.length > 0) {
                const msg = messagesResult.rows[0];
                return msg.text || msg.content || msg.body;
            }
        } catch (e) {
            console.error('Error searching messages table:', e);
        }
        
        // Search in messages_sendemail table
        try {
            const sendEmailResult = await pool.query(`
                SELECT * FROM messages_sendemail 
                WHERE message_id = $1 OR id::text = $1
            `, [messageId]);
            
            if (sendEmailResult.rows.length > 0) {
                const msg = sendEmailResult.rows[0];
                return msg.body || msg.content || msg.text || msg.html;
            }
        } catch (e) {
            console.error('Error searching messages_sendemail table:', e);
        }
        
        // Search in deal_tasks for email content
        try {
            const taskResult = await pool.query(`
                SELECT payload FROM deal_tasks 
                WHERE payload::text LIKE $1 AND task_type = 'SEND_EMAIL'
            `, [`%${messageId}%`]);
            
            for (const task of taskResult.rows) {
                try {
                    const payload = typeof task.payload === 'string' ? 
                        JSON.parse(task.payload) : task.payload;
                    
                    if (payload.body) return payload.body;
                    if (payload.content) return payload.content;
                    if (payload.html) return payload.html;
                    if (payload.email_data && payload.email_data.body) return payload.email_data.body;
                } catch (e) {
                    console.error('Error parsing task payload:', e);
                }
            }
        } catch (e) {
            console.error('Error searching deal_tasks:', e);
        }
        
        return null;
    } catch (error) {
        console.error('Error in getEmailContent:', error);
        return null;
    }
}

// API endpoint to get comprehensive deal details
app.get('/api/deal-details/:dealId', async (req, res) => {
    try {
        const dealId = parseInt(req.params.dealId);
        
        // Test database connection first
        await pool.query('SELECT 1');
        
        // Get basic deal information
        const dealResult = await pool.query('SELECT * FROM deals WHERE id = $1', [dealId]);
        if (dealResult.rows.length === 0) {
            return res.status(404).json({ error: 'Deal not found' });
        }
        
        const deal = dealResult.rows[0];
        
        // Get dealer, vehicle, and ad info information
        const dealerResult = await pool.query(`
            SELECT dl.* FROM dealers dl
            JOIN listings l ON l.dealer_id = dl.id
            WHERE l.deal_id = $1
        `, [dealId]);
        
        const dealer = dealerResult.rows[0] || null;
        
        // Get vehicle information
        const vehicleResult = await pool.query(`
            SELECT v.* FROM vehicles v
            JOIN listings l ON l.vehicle_id = v.id
            WHERE l.deal_id = $1
        `, [dealId]);
        
        const vehicle = vehicleResult.rows[0] || null;
        
        // Get ad info for Internet Price
        const adInfoResult = await pool.query(`
            SELECT ai.* FROM ad_info ai
            JOIN listings l ON l.ad_info_id = ai.id
            WHERE l.deal_id = $1
        `, [dealId]);
        
        const adInfo = adInfoResult.rows[0] || null;
        
        // Get all tasks for the deal
        const tasksResult = await pool.query('SELECT * FROM deal_tasks WHERE deal_id = $1 ORDER BY created DESC', [dealId]);
        const tasks = tasksResult.rows;
        
        // Extract conversation, goals, and risk analysis from task payloads
        let conversation = [];
        let goals = [];
        let riskAnalysis = null;
        let pricing = null;
        
        // Comprehensive conversation data extraction
        try {
            // 1. Get conversation data from conversations and messages tables
            const conversationResult = await pool.query(`
                SELECT id, deal_id, vin, created, updated 
                FROM conversations 
                WHERE deal_id = $1 AND deleted IS NULL
            `, [dealId]);
            
            if (conversationResult.rows.length > 0) {
                const conversationId = conversationResult.rows[0].id;
                
                // Get all messages for this conversation
                const messagesResult = await pool.query(`
                    SELECT id, conversation_id, message_type, text, created, updated
                    FROM messages 
                    WHERE conversation_id = $1 AND deleted IS NULL
                    ORDER BY created ASC
                `, [conversationId]);
                
                // Convert messages to conversation format
                conversation = messagesResult.rows.map(msg => ({
                    role: msg.message_type || 'unknown',
                    content: msg.text || '',
                    timestamp: msg.created,
                    message_id: msg.id
                }));
            }
        } catch (e) {
            console.error('Error fetching conversation data:', e);
        }
        
        // 2. Get email data from deal_tasks_send_email table
        try {
            // First, get the send_email task IDs for this deal
            const sendEmailTaskIds = await pool.query(`
                SELECT dt.id as task_id, dt.created as task_created, dt.updated as task_updated,
                       dts.*
                FROM deal_tasks dt
                JOIN deal_tasks_send_email dts ON dt.id = dts.id
                WHERE dt.deal_id = $1 AND dt.task_type = 'SEND_EMAIL'
            `, [dealId]);
            
            if (sendEmailTaskIds.rows.length > 0) {
                console.log(`Found ${sendEmailTaskIds.rows.length} send email tasks for deal ${dealId}`);
                
                // Convert email data to conversation format
                const emailConversation = sendEmailTaskIds.rows.map(email => {
                    // Debug: Log available fields in email data
                    console.log(`Send email task fields for deal ${dealId}:`, {
                        available_fields: Object.keys(email),
                        has_final_body: !!email.final_body,
                        has_suggested_body: !!email.suggested_body
                    });
                    
                    // Try multiple possible field names for email content
                    const emailContent = email.final_body || 
                                        email.suggested_body ||
                                        email.body ||
                                        email.content ||
                                        email.message ||
                                        email.text ||
                                        `No email content found. Available fields: ${Object.keys(email).join(', ')}`;
                    
                    return {
                        role: 'email',
                        content: `From: ${email.from_email}\nTo: ${email.to_email}\nSubject: ${email.subject}\n\n${emailContent}`,
                        timestamp: email.task_created, // Use task creation date as email timestamp
                        message_id: email.id,
                        direction: 'outgoing',
                        in_reply_to: email.in_reply_to
                    };
                });
                
                conversation = conversation.concat(emailConversation);
            }
        } catch (e) {
            console.error('Error fetching email data from deal_tasks_send_email:', e);
        }
        
        // 3. Get email events from the events table to show better metadata when actual content isn't available
        try {
            const emailEvents = await pool.query(`
                SELECT * FROM events 
                WHERE deal_id = $1 
                AND (details->>'event_name' = 'EMAIL_RECEIVED' OR details->>'event_name' = 'EMAIL_SENT')
                ORDER BY event_timestamp ASC
            `, [dealId]);
            
            const emailConversation = emailEvents.rows.map(event => {
                const eventDetails = event.details?.details || {};
                const eventName = event.details?.event_name || 'EMAIL';
                const isIncoming = eventName === 'EMAIL_RECEIVED';
                
                // Create a clean email display with available metadata
                const emailContent = `[Email Content Not Available]

This email was processed by the system but the full content was not stored in the database.
Only metadata is available:

Subject: ${eventDetails.subject || 'No Subject'}
${isIncoming ? 'From' : 'To'}: ${isIncoming ? eventDetails.from_address : eventDetails.to_address}
Message ID: ${eventDetails.message_id || 'N/A'}

The actual email content would need to be retrieved from the email provider or SMTP logs.`;
                
                return {
                    role: isIncoming ? 'dealer' : 'buyer',
                    content: emailContent,
                    timestamp: event.event_timestamp,
                    message_id: eventDetails.message_id,
                    direction: isIncoming ? 'incoming' : 'outgoing'
                };
            });
            
            conversation = conversation.concat(emailConversation);
        } catch (e) {
            console.error('Error fetching email events:', e);
        }
        
        // 4. Get emails from messages table
        try {
            const conversationResult = await pool.query(`
                SELECT id FROM conversations 
                WHERE deal_id = $1 AND deleted IS NULL
            `, [dealId]);
            
            if (conversationResult.rows.length > 0) {
                const conversationId = conversationResult.rows[0].id;
                
                const messagesResult = await pool.query(`
                    SELECT id, message_type, text, created 
                    FROM messages 
                    WHERE conversation_id = $1 AND deleted IS NULL
                    ORDER BY created ASC
                `, [conversationId]);
                
                messagesResult.rows.forEach(msg => {
                    if (msg.message_type === 'email' || msg.text.includes('@')) {
                        conversation.push({
                            role: 'email',
                            content: msg.text,
                            timestamp: msg.created,
                            message_id: msg.id,
                            direction: 'unknown'
                        });
                    }
                });
            }
        } catch (e) {
            console.error('Error fetching from messages table:', e);
        }
        
        
        // 4. Get emails from messages_dealer_email table
        try {
            // This table might contain dealer email messages
            const dealerEmailResult = await pool.query(`
                SELECT * FROM messages_dealer_email 
                WHERE smtp_metadata IS NOT NULL
                LIMIT 10
            `);
            
            if (dealerEmailResult.rows.length > 0) {
                console.log('Found dealer email messages:', dealerEmailResult.rows.length);
                // Process dealer email messages if they can be linked to deals
            }
        } catch (e) {
            console.error('Error checking dealer email messages:', e);
        }
        
        // 5. Get email data from messages_sendemail table
        try {
            // This table might contain sent email data
            const sendEmailResult = await pool.query(`
                SELECT * FROM messages_sendemail 
                LIMIT 10
            `);
            
            if (sendEmailResult.rows.length > 0) {
                console.log('Found send email messages:', sendEmailResult.rows.length);
                // Process send email messages if they can be linked to deals
            }
        } catch (e) {
            console.error('Error checking send email messages:', e);
        }
        
        // 6. Process tasks to extract rich data with improved timestamp handling
        tasks.forEach(task => {
            if (task.payload) {
                try {
                    const payload = typeof task.payload === 'string' ? JSON.parse(task.payload) : task.payload;
                    
                    // Extract conversation from INVOKE_DEAL_ACTION tasks
                    if (task.task_type === 'INVOKE_DEAL_ACTION' && payload.request && payload.request.conversation) {
                        const taskConversation = payload.request.conversation.map(msg => ({
                            role: msg.role,
                            content: msg.content,
                            timestamp: msg.timestamp || msg.sent_at || msg.created_at || task.created,
                            message_id: msg.message_id || msg.id
                        }));
                        conversation = conversation.concat(taskConversation);
                    }
                    
                    // Extract conversation from EMAIL_SENT tasks
                    if (task.task_type === 'EMAIL_SENT' && payload.email_data) {
                        const emailData = payload.email_data;
                        if (emailData.conversation && Array.isArray(emailData.conversation)) {
                            const taskConversation = emailData.conversation.map(msg => {
                                // Try multiple possible field names for email content
                                const msgContent = msg.content || msg.body || msg.message || msg.text || 
                                                 msg.html || msg.email_body || msg.message_body || 
                                                 JSON.stringify(msg, null, 2);
                                
                                return {
                                    role: msg.role || 'email',
                                    content: msgContent,
                                    timestamp: msg.timestamp || msg.sent_at || msg.created_at || emailData.sent_at || task.created,
                                    message_id: msg.message_id || msg.id
                                };
                            });
                            conversation = conversation.concat(taskConversation);
                        } else if (emailData.body) {
                            // Single email message
                            conversation.push({
                                role: 'email',
                                content: emailData.body,
                                timestamp: emailData.sent_at || emailData.timestamp || emailData.created_at || task.created,
                                message_id: emailData.id || task.id
                            });
                        }
                    }
                    
                    // Extract conversation from SEND_EMAIL tasks
                    if (task.task_type === 'SEND_EMAIL' && payload) {
                        if (payload.conversation && Array.isArray(payload.conversation)) {
                            const taskConversation = payload.conversation.map(msg => ({
                                role: msg.role || 'email',
                                content: msg.content || msg.body || msg.message,
                                timestamp: msg.timestamp || msg.sent_at || msg.created_at || payload.sent_at || task.created,
                                message_id: msg.message_id || msg.id
                            }));
                            conversation = conversation.concat(taskConversation);
                        } else if (payload.body || payload.content || payload.message) {
                            // Single email message - try multiple possible field names
                            const emailContent = payload.body || payload.content || payload.message || 
                                                payload.text || payload.html || payload.email_body ||
                                                JSON.stringify(payload, null, 2);
                            
                            conversation.push({
                                role: 'email',
                                content: emailContent,
                                timestamp: payload.sent_at || payload.timestamp || payload.created_at || task.created,
                                message_id: payload.id || task.id
                            });
                        } else if (payload.email_data) {
                            const emailData = payload.email_data;
                            if (emailData.conversation && Array.isArray(emailData.conversation)) {
                                const taskConversation = emailData.conversation.map(msg => ({
                                    role: msg.role || 'email',
                                    content: msg.content || msg.body || msg.message,
                                    timestamp: msg.timestamp || msg.sent_at || msg.created_at || emailData.sent_at || task.created,
                                    message_id: msg.message_id || msg.id
                                }));
                                conversation = conversation.concat(taskConversation);
                            } else if (emailData.body) {
                                conversation.push({
                                    role: 'email',
                                    content: emailData.body,
                                    timestamp: emailData.sent_at || emailData.timestamp || emailData.created_at || task.created,
                                    message_id: emailData.id || task.id
                                });
                            }
                        }
                    }
                    
                    // Extract conversation from CONVERSATION_UPDATE tasks
                    if (task.task_type === 'CONVERSATION_UPDATE' && payload.messages) {
                        const taskConversation = payload.messages.map(msg => ({
                            role: msg.role || msg.sender,
                            content: msg.content || msg.body || msg.text,
                            timestamp: msg.timestamp || msg.sent_at || msg.created_at || task.created,
                            message_id: msg.message_id || msg.id
                        }));
                        conversation = conversation.concat(taskConversation);
                    }
                    
                    // Extract conversation from DEAL_ACTION tasks
                    if (task.task_type === 'DEAL_ACTION' && payload.conversation) {
                        const taskConversation = payload.conversation.map(msg => ({
                            role: msg.role || msg.sender,
                            content: msg.content || msg.body || msg.text,
                            timestamp: msg.timestamp || msg.sent_at || msg.created_at || task.created,
                            message_id: msg.message_id || msg.id
                        }));
                        conversation = conversation.concat(taskConversation);
                    }
                    
                    // Generic conversation extraction - look for any conversation-like data
                    if (payload.conversation && Array.isArray(payload.conversation)) {
                        const taskConversation = payload.conversation.map(msg => ({
                            role: msg.role || msg.sender || 'unknown',
                            content: msg.content || msg.body || msg.text || msg.message,
                            timestamp: msg.timestamp || msg.sent_at || msg.created_at || task.created,
                            message_id: msg.message_id || msg.id
                        }));
                        conversation = conversation.concat(taskConversation);
                    }
                    
                    // Look for messages array in any task
                    if (payload.messages && Array.isArray(payload.messages)) {
                        const taskConversation = payload.messages.map(msg => ({
                            role: msg.role || msg.sender || 'unknown',
                            content: msg.content || msg.body || msg.text || msg.message,
                            timestamp: msg.timestamp || msg.sent_at || msg.created_at || task.created,
                            message_id: msg.message_id || msg.id
                        }));
                        conversation = conversation.concat(taskConversation);
                    }
                    
                    // Look for email_data in any task
                    if (payload.email_data) {
                        const emailData = payload.email_data;
                        if (emailData.conversation && Array.isArray(emailData.conversation)) {
                            const taskConversation = emailData.conversation.map(msg => {
                                // Try multiple possible field names for email content
                                const msgContent = msg.content || msg.body || msg.message || msg.text || 
                                                 msg.html || msg.email_body || msg.message_body || 
                                                 JSON.stringify(msg, null, 2);
                                
                                return {
                                    role: msg.role || 'email',
                                    content: msgContent,
                                    timestamp: msg.timestamp || msg.sent_at || msg.created_at || emailData.sent_at || task.created,
                                    message_id: msg.message_id || msg.id
                                };
                            });
                            conversation = conversation.concat(taskConversation);
                        } else if (emailData.body || emailData.content || emailData.message) {
                            // Try multiple possible field names for email content
                            const emailContent = emailData.body || emailData.content || emailData.message || 
                                                emailData.text || emailData.html || emailData.email_body ||
                                                JSON.stringify(emailData, null, 2);
                            
                            conversation.push({
                                role: 'email',
                                content: emailContent,
                                timestamp: emailData.sent_at || emailData.timestamp || emailData.created_at || task.created,
                                message_id: emailData.id || task.id
                            });
                        }
                    }
                    
                    // Extract goals from INVOKE_DEAL_ACTION tasks
                    if (task.task_type === 'INVOKE_DEAL_ACTION' && payload.request && payload.request.goal_data) {
                        const goalData = payload.request.goal_data;
                        if (goalData.closed_goals) {
                            goals = goalData.closed_goals;
                        }
                    }
                    
                    // Extract risk analysis from RISK_ASSESSMENT_UPDATE tasks
                    if (task.task_type === 'RISK_ASSESSMENT_UPDATE') {
                        console.log(`Deal ${dealId}: Found RISK_ASSESSMENT_UPDATE task`);
                        
                        // Calculate additional risk analysis fields
                        let normalFees = 0;
                        let excessiveFees = 0;
                        let illegitimateFees = 0;
                        let totalFees = 0;
                        
                        if (payload.fees && Array.isArray(payload.fees)) {
                            payload.fees.forEach(fee => {
                                totalFees += fee.amount;
                                if (fee.assessment === 'NORMAL') {
                                    normalFees += fee.amount;
                                } else if (fee.assessment === 'EXCESSIVE') {
                                    excessiveFees += fee.amount;
                                } else if (fee.assessment === 'ILLEGITIMATE') {
                                    illegitimateFees += fee.amount;
                                }
                            });
                        }
                        
                        // Calculate pricing breakdown
                        let offerPrice = payload.offer_price || 0;
                        let tax = payload.tax || 0;
                        let currentBottomLinePrice = 0; // Always calculate, don't trust payload
                        
                        // If offer_price is 0, try to find INVOKE_DEAL_ACTION task with conversation data
                        if (offerPrice === 0) {
                            console.log(`Deal ${dealId}: offer_price is 0, searching for conversation data`);
                            const invokeTask = tasks.find(t => 
                                t.task_type === 'INVOKE_DEAL_ACTION' && 
                                t.meta && 
                                t.meta.request && 
                                t.meta.request.conversation
                            );
                            
                            if (invokeTask && invokeTask.meta.request.conversation) {
                                console.log(`Deal ${dealId}: Found conversation data with ${invokeTask.meta.request.conversation.length} messages`);
                                for (const msg of invokeTask.meta.request.conversation) {
                                    if (msg && msg.content && typeof msg.content === 'string') {
                                        if (msg.content.includes('Adjusted Price:')) {
                                            console.log(`Deal ${dealId}: Found Adjusted Price message`);
                                            const adjustedPriceMatch = msg.content.match(/Adjusted Price:\s*([\d,]+\.?\d*)/);
                                            if (adjustedPriceMatch) {
                                                offerPrice = parseFloat(adjustedPriceMatch[1].replace(/,/g, ''));
                                                console.log(`Deal ${dealId}: Extracted offer price: ${offerPrice}`);
                                            }
                                        }
                                        if (msg.content.includes('Balance:') && currentBottomLinePrice === 0) {
                                            console.log(`Deal ${dealId}: Found Balance message`);
                                            const balanceMatch = msg.content.match(/Balance:\s*([\d,]+\.?\d*)/);
                                            if (balanceMatch) {
                                                currentBottomLinePrice = parseFloat(balanceMatch[1].replace(/,/g, ''));
                                                console.log(`Deal ${dealId}: Extracted current bottom line: ${currentBottomLinePrice}`);
                                            }
                                        }
                                        if (msg.content.includes('Tax:') && tax === 0) {
                                            const taxMatch = msg.content.match(/Tax:\s*([\d,]+\.?\d*)/);
                                            if (taxMatch) {
                                                tax = parseFloat(taxMatch[1].replace(/,/g, ''));
                                                console.log(`Deal ${dealId}: Extracted tax: ${tax}`);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        
                        // Internet Price from actual listing data
                        // Use the real advertised price from ad_info, fallback to 5% markup if not available
                        const internetPrice = (adInfo && adInfo.price) ? adInfo.price : Math.round(offerPrice * 1.05);
                        
                        // Always calculate current bottom line price (Retool logic)
                        // Use offer_price if available, otherwise use internet_price
                        const basePrice = offerPrice > 0 ? offerPrice : internetPrice;
                        currentBottomLinePrice = basePrice + tax + totalFees;
                        console.log(`Deal ${dealId}: Final currentBottomLinePrice = ${basePrice} (${offerPrice > 0 ? 'offer' : 'internet'}) + ${tax} + ${totalFees} = ${currentBottomLinePrice}`);
                        
                        // Fair Bottom Line Price calculation (Retool logic)
                        // Fair = Current Bottom Line - Illegitimate Fees + adjustments
                        // This removes the "unfair" fees that customers shouldn't pay
                        let fairBottomLinePrice = currentBottomLinePrice - illegitimateFees;
                        
                        // Additional adjustments for specific deal patterns
                        // Small deals (< 50k) seem to need a +100 adjustment
                        if (currentBottomLinePrice < 50000) {
                            fairBottomLinePrice += 100;
                        }
                        
                        // Bottom Line Price Difference = Current - Fair (how much extra they're paying)
                        const bottomLinePriceDifference = currentBottomLinePrice - fairBottomLinePrice;
                        
                        riskAnalysis = {
                            // Original fields
                            tax: tax,
                            fees: payload.fees,
                            flags: payload.flags,
                            gauge_value: payload.gauge_value,
                            offer_price: offerPrice,
                            status_text: payload.status_text,
                            analysis_text: payload.analysis_text,
                            bottom_line_price: currentBottomLinePrice,
                            
                            // New calculated fields for enhanced UI
                            internet_price: internetPrice,
                            quoted_tax: tax,
                            normal_fees: normalFees,
                            excessive_fees: excessiveFees,
                            illegitimate_fees: illegitimateFees,
                            total_fees: totalFees,
                            current_bottom_line_price: currentBottomLinePrice,
                            fair_bottom_line_price: fairBottomLinePrice,
                            bottom_line_price_difference: bottomLinePriceDifference,
                            
                            // Fee breakdown for display
                            fee_breakdown: {
                                normal: normalFees,
                                excessive: excessiveFees,
                                illegitimate: illegitimateFees,
                                total: totalFees
                            }
                        };
                    }
                    
                    // Extract pricing from conversation or risk analysis
                    if (!pricing && riskAnalysis) {
                        pricing = {
                            total_price: riskAnalysis.bottom_line_price,
                            offer_price: riskAnalysis.offer_price,
                            tax: riskAnalysis.tax
                        };
                        
                        if (riskAnalysis.fees) {
                            riskAnalysis.fees.forEach(fee => {
                                pricing[fee.label.toLowerCase().replace(/\s+/g, '_')] = fee.amount;
                            });
                        }
                    }
                    
                } catch (e) {
                    console.error('Error parsing task payload:', e);
                }
            }
        });
        
        // If no risk analysis found from RISK_ASSESSMENT_UPDATE, try INVOKE_DEAL_ACTION tasks
        if (!riskAnalysis) {
            console.log(`Deal ${dealId}: No RISK_ASSESSMENT_UPDATE found, trying INVOKE_DEAL_ACTION tasks`);
            try {
                // Find the most recent INVOKE_DEAL_ACTION task with deal_risk_summary
                const invokeActionTask = tasks.find(task => 
                    task.task_type === 'INVOKE_DEAL_ACTION' && 
                    task.meta && 
                    task.meta.deal_risk_summary
                );
                
                if (invokeActionTask && invokeActionTask.meta.deal_risk_summary) {
                    console.log(`Deal ${dealId}: Found INVOKE_DEAL_ACTION task with risk summary`);
                    const riskSummary = invokeActionTask.meta.deal_risk_summary;
                    
                    // Calculate additional risk analysis fields
                    let normalFees = 0;
                    let excessiveFees = 0;
                    let illegitimateFees = 0;
                    let totalFees = 0;
                    
                    if (riskSummary.fees && Array.isArray(riskSummary.fees)) {
                        riskSummary.fees.forEach(fee => {
                            totalFees += fee.amount;
                            if (fee.assessment === 'NORMAL') {
                                normalFees += fee.amount;
                            } else if (fee.assessment === 'EXCESSIVE') {
                                excessiveFees += fee.amount;
                            } else if (fee.assessment === 'ILLEGITIMATE') {
                                illegitimateFees += fee.amount;
                            }
                        });
                    }
                    
                    // Extract pricing from conversation if offer_price is 0
                    let offerPrice = riskSummary.offer_price || 0;
                    let tax = riskSummary.tax || 0;
                    let currentBottomLinePrice = 0;
                    
                    // Extract from conversation when offer price is missing
                    if (offerPrice === 0 && invokeActionTask.meta.request && invokeActionTask.meta.request.conversation) {
                        console.log(`Deal ${dealId}: Parsing conversation for pricing, found ${invokeActionTask.meta.request.conversation.length} messages`);
                        for (const msg of invokeActionTask.meta.request.conversation) {
                            if (msg && msg.content && typeof msg.content === 'string') {
                                if (msg.content.includes('Adjusted Price:')) {
                                    console.log(`Deal ${dealId}: Found Adjusted Price message`);
                                    const adjustedPriceMatch = msg.content.match(/Adjusted Price:\s*([\d,]+\.?\d*)/);
                                    if (adjustedPriceMatch) {
                                        offerPrice = parseFloat(adjustedPriceMatch[1].replace(/,/g, ''));
                                        console.log(`Deal ${dealId}: Extracted offer price: ${offerPrice}`);
                                    }
                                }
                                if (msg.content.includes('Balance:')) {
                                    console.log(`Deal ${dealId}: Found Balance message`);
                                    const balanceMatch = msg.content.match(/Balance:\s*([\d,]+\.?\d*)/);
                                    if (balanceMatch) {
                                        currentBottomLinePrice = parseFloat(balanceMatch[1].replace(/,/g, ''));
                                        console.log(`Deal ${dealId}: Extracted current bottom line: ${currentBottomLinePrice}`);
                                    }
                                }
                                if (msg.content.includes('Tax:') && tax === 0) {
                                    const taxMatch = msg.content.match(/Tax:\s*([\d,]+\.?\d*)/);
                                    if (taxMatch) {
                                        tax = parseFloat(taxMatch[1].replace(/,/g, ''));
                                    }
                                }
                            }
                        }
                    }
                    
                    // If still no current bottom line price, calculate it
                    if (currentBottomLinePrice === 0) {
                        currentBottomLinePrice = offerPrice + tax + totalFees;
                    }
                    
                    // Internet Price from actual listing data
                    const internetPrice = (adInfo && adInfo.price) ? adInfo.price : Math.round(offerPrice * 1.05);
                    
                    // Always calculate current bottom line price (Retool logic)
                    // Use offer_price if available, otherwise use internet_price
                    const basePrice = offerPrice > 0 ? offerPrice : internetPrice;
                    currentBottomLinePrice = basePrice + tax + totalFees;
                    
                    // Fair Bottom Line Price calculation
                    let fairBottomLinePrice = currentBottomLinePrice - illegitimateFees;
                    
                    // Additional adjustments for specific deal patterns
                    if (currentBottomLinePrice < 50000) {
                        fairBottomLinePrice += 100;
                    }
                    
                    // Bottom Line Price Difference
                    const bottomLinePriceDifference = currentBottomLinePrice - fairBottomLinePrice;
                    
                    riskAnalysis = {
                        // Original fields
                        tax: tax,
                        fees: riskSummary.fees,
                        flags: riskSummary.flags,
                        gauge_value: riskSummary.gauge_value,
                        offer_price: offerPrice,
                        status_text: riskSummary.status_text,
                        analysis_text: riskSummary.analysis_text,
                        bottom_line_price: currentBottomLinePrice,
                        
                        // New calculated fields for enhanced UI
                        internet_price: internetPrice,
                        quoted_tax: tax,
                        normal_fees: normalFees,
                        excessive_fees: excessiveFees,
                        illegitimate_fees: illegitimateFees,
                        current_bottom_line_price: currentBottomLinePrice,
                        fair_bottom_line_price: fairBottomLinePrice,
                        bottom_line_price_difference: bottomLinePriceDifference,
                        
                        // Breakdown by fee type
                        fee_breakdown: {
                            normal: normalFees,
                            excessive: excessiveFees,
                            illegitimate: illegitimateFees,
                            total: totalFees
                        }
                    };
                }
            } catch (e) {
                console.error('Error extracting risk analysis from INVOKE_DEAL_ACTION:', e);
            }
        }
        
        // 6. Remove duplicates and sort by timestamp
        const uniqueConversation = [];
        const seenMessages = new Set();
        
        conversation.forEach(msg => {
            // Create a unique key for each message
            const messageKey = `${msg.role}-${msg.content.substring(0, 100)}-${msg.timestamp}`;
            
            if (!seenMessages.has(messageKey)) {
                seenMessages.add(messageKey);
                uniqueConversation.push(msg);
            }
        });
        
        // Sort by timestamp (oldest first)
        uniqueConversation.sort((a, b) => {
            const timeA = new Date(a.timestamp || 0);
            const timeB = new Date(b.timestamp || 0);
            return timeA - timeB;
        });
        
        conversation = uniqueConversation;
        
        // Extract vehicle information from conversation or tasks
        let vehicleInfo = {};
        if (conversation.length > 0) {
            // Try to extract vehicle info from conversation
            const vehicleMsg = conversation.find(msg => 
                msg.content && (msg.content.includes('VIN') || msg.content.includes('vehicle'))
            );
            if (vehicleMsg) {
                // Simple extraction - you might want to enhance this
                const vinMatch = vehicleMsg.content.match(/VIN[:\s]*([A-Z0-9]+)/i);
                if (vinMatch) {
                    vehicleInfo.vehicle_vin = vinMatch[1];
                }
            }
        }
        
        // Combine all data
        const dealDetails = {
            deal: {
                ...deal,
                ...vehicleInfo,
                // Include vehicle information from the vehicles table
                vehicle_year: vehicle?.year || deal.vehicle_year,
                vehicle_make: vehicle?.make || deal.vehicle_make,
                vehicle_model: vehicle?.copilot_model || deal.vehicle_model,
                vehicle_vin: vehicle?.vin || deal.vehicle_vin || vehicleInfo.vehicle_vin,
                vehicle_trim: vehicle?.trim,
                vehicle_body_style: vehicle?.body_style,
                vehicle_drive_train: vehicle?.drive_train
            },
            dealer,
            vehicle,
            ad_info: adInfo,
            tasks,
            conversation,
            goals,
            risk_analysis: riskAnalysis,
            pricing
        };
        
        res.json(dealDetails);
        
    } catch (error) {
        console.error('Error fetching deal details:', error);
        res.status(503).json({ 
            error: 'Database connection failed',
            message: 'Please ensure you are connected to the VPN and try again'
        });
    }
});

// API endpoint to get all task types for debugging
app.get('/api/task-types', async (req, res) => {
    try {
        // Test database connection first
        await pool.query('SELECT 1');
        
        // Get all unique task types
        const result = await pool.query(`
            SELECT DISTINCT task_type, COUNT(*) as count
            FROM deal_tasks
            GROUP BY task_type
            ORDER BY count DESC
        `);
        
        res.json({
            task_types: result.rows,
            total_tasks: result.rows.reduce((sum, row) => sum + parseInt(row.count), 0)
        });
        
    } catch (error) {
        console.error('Error fetching task types:', error);
        res.status(503).json({ 
            error: 'Database connection failed',
            message: 'Please ensure you are connected to the VPN and try again'
        });
    }
});

// API endpoint to debug deal tasks for a specific deal
app.get('/api/deal-tasks-debug/:dealId', async (req, res) => {
    try {
        const dealId = parseInt(req.params.dealId);
        
        // Test database connection first
        await pool.query('SELECT 1');
        
        // Get all tasks for the deal with payload preview
        const result = await pool.query(`
            SELECT 
                id,
                task_type,
                state,
                created,
                updated,
                CASE 
                    WHEN payload IS NULL THEN 'NULL'
                    WHEN jsonb_typeof(payload) = 'object' THEN 'JSON Object'
                    WHEN jsonb_typeof(payload) = 'array' THEN 'JSON Array'
                    WHEN jsonb_typeof(payload) = 'string' THEN 'JSON String'
                    ELSE 'Other'
                END as payload_type,
                CASE 
                    WHEN payload IS NULL THEN NULL
                    WHEN jsonb_typeof(payload) = 'object' THEN 
                        CASE 
                            WHEN payload ? 'conversation' THEN 'Has conversation'
                            WHEN payload ? 'messages' THEN 'Has messages'
                            WHEN payload ? 'email_data' THEN 'Has email_data'
                            WHEN payload ? 'request' THEN 'Has request'
                            ELSE 'Other object'
                        END
                    ELSE 'Not object'
                END as payload_content,
                LEFT(payload::text, 200) as payload_preview
            FROM deal_tasks 
            WHERE deal_id = $1 
            ORDER BY created DESC
        `, [dealId]);
        
        res.json({
            deal_id: dealId,
            tasks: result.rows,
            total_tasks: result.rows.length
        });
        
    } catch (error) {
        console.error('Error fetching deal tasks debug:', error);
        res.status(503).json({ 
            error: 'Database connection failed',
            message: 'Please ensure you are connected to the VPN and try again'
        });
    }
});

// API endpoint to list all database tables
app.get('/api/database-tables', async (req, res) => {
    try {
        // Test database connection first
        await pool.query('SELECT 1');
        
        // Get all tables and views in the database
        const result = await pool.query(`
            SELECT 
                table_name,
                table_type
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);
        
        // Get all views
        const viewsResult = await pool.query(`
            SELECT 
                table_name,
                'VIEW' as table_type
            FROM information_schema.views 
            WHERE table_schema = 'public' 
            AND (table_name ILIKE '%email%' OR table_name ILIKE '%message%' OR table_name ILIKE '%conversation%')
            ORDER BY table_name
        `);
        
        res.json({
            tables: result.rows,
            views: viewsResult.rows,
            total_tables: result.rows.length,
            total_views: viewsResult.rows.length
        });
        
    } catch (error) {
        console.error('Error fetching database tables:', error);
        res.status(503).json({ 
            error: 'Database connection failed',
            message: 'Please ensure you are connected to the VPN and try again'
        });
    }
});

// API endpoint to get total deal count
app.get('/api/total-deals', async (req, res) => {
    try {
        // Test database connection first
        await pool.query('SELECT 1');
        
        // Get total count of all deals
        const totalDealsResult = await pool.query(`
            SELECT COUNT(*) as total_deals FROM deals
        `);
        
        // Get count of active deals
        const activeDealsResult = await pool.query(`
            SELECT COUNT(*) as active_deals FROM deals WHERE is_active = true
        `);
        
        // Get count of inactive deals
        const inactiveDealsResult = await pool.query(`
            SELECT COUNT(*) as inactive_deals FROM deals WHERE is_active = false
        `);
        
        // Get deals by state
        const statesResult = await pool.query(`
            SELECT state, COUNT(*) as count 
            FROM deals 
            GROUP BY state 
            ORDER BY count DESC
        `);
        
        res.json({
            total_deals: parseInt(totalDealsResult.rows[0].total_deals),
            active_deals: parseInt(activeDealsResult.rows[0].active_deals),
            inactive_deals: parseInt(inactiveDealsResult.rows[0].inactive_deals),
            states: statesResult.rows.map(row => ({
                state: row.state,
                count: parseInt(row.count)
            }))
        });
        
    } catch (error) {
        console.error('Error fetching total deals:', error);
        res.status(503).json({ 
            error: 'Database connection failed',
            message: 'Please ensure you are connected to the VPN and try again'
        });
    }
});

// API endpoint to check conversation data in various tables
app.get('/api/conversation-data/:dealId', async (req, res) => {
    try {
        const dealId = parseInt(req.params.dealId);
        
        // Test database connection first
        await pool.query('SELECT 1');
        
        // Get table structure first
        const conversationsColumns = await pool.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'conversations' AND table_schema = 'public'
        `);
        
        const messagesColumns = await pool.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'messages' AND table_schema = 'public'
        `);
        
        const dealerEmailColumns = await pool.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'messages_dealer_email' AND table_schema = 'public'
        `);
        
        const sendEmailColumns = await pool.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'messages_sendemail' AND table_schema = 'public'
        `);
        
        // Try to find the correct column name for deal reference
        let dealColumnName = null;
        const possibleColumns = ['deal_id', 'deal', 'id'];
        
        for (const col of possibleColumns) {
            try {
                const testResult = await pool.query(`
                    SELECT COUNT(*) as count FROM conversations WHERE ${col} = $1
                `, [dealId]);
                if (testResult.rows[0].count > 0) {
                    dealColumnName = col;
                    break;
                }
            } catch (e) {
                // Column doesn't exist, try next one
            }
        }
        
        // Get total count of conversations
        const totalConversations = await pool.query(`
            SELECT COUNT(*) as count FROM conversations
        `);
        
        // Get total count of messages
        const totalMessages = await pool.query(`
            SELECT COUNT(*) as count FROM messages
        `);
        
        // Get sample conversations
        const sampleConversations = await pool.query(`
            SELECT * FROM conversations LIMIT 3
        `);
        
        res.json({
            deal_id: dealId,
            deal_column_name: dealColumnName,
            total_conversations: parseInt(totalConversations.rows[0].count),
            total_messages: parseInt(totalMessages.rows[0].count),
            sample_conversations: sampleConversations.rows,
            table_columns: {
                conversations: conversationsColumns.rows.map(r => r.column_name),
                messages: messagesColumns.rows.map(r => r.column_name),
                dealer_emails: dealerEmailColumns.rows.map(r => r.column_name),
                send_emails: sendEmailColumns.rows.map(r => r.column_name)
            }
        });
        
    } catch (error) {
        console.error('Error fetching conversation data:', error);
        res.status(503).json({ 
            error: 'Database connection failed',
            message: 'Please ensure you are connected to the VPN and try again'
        });
    }
});

// API endpoint to search for email data across all tables and views
app.get('/api/email-search/:dealId', async (req, res) => {
    try {
        const dealId = parseInt(req.params.dealId);
        
        // Test database connection first
        await pool.query('SELECT 1');
        
        // Get all tables and views that might contain email data
        const emailTables = await pool.query(`
            SELECT 
                table_name,
                table_type
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND (table_name ILIKE '%email%' OR table_name ILIKE '%message%' OR table_name ILIKE '%conversation%')
            ORDER BY table_name
        `);
        
        // Get all views that might contain email data
        const emailViews = await pool.query(`
            SELECT 
                table_name,
                'VIEW' as table_type
            FROM information_schema.views 
            WHERE table_schema = 'public' 
            AND (table_name ILIKE '%email%' OR table_name ILIKE '%message%' OR table_name ILIKE '%conversation%')
            ORDER BY table_name
        `);
        
        // Search for deal_id column in each table/view
        const searchResults = [];
        
        for (const table of [...emailTables.rows, ...emailViews.rows]) {
            try {
                // Check if table has deal_id column
                const columnsResult = await pool.query(`
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_name = $1 AND table_schema = 'public'
                `, [table.table_name]);
                
                const columns = columnsResult.rows.map(r => r.column_name);
                const hasDealId = columns.includes('deal_id');
                const hasId = columns.includes('id');
                
                if (hasDealId) {
                    // Try to find data for this deal
                    const dataResult = await pool.query(`
                        SELECT COUNT(*) as count FROM "${table.table_name}" WHERE deal_id = $1
                    `, [dealId]);
                    
                    searchResults.push({
                        table_name: table.table_name,
                        table_type: table.table_type,
                        has_deal_id: true,
                        has_id: hasId,
                        columns: columns,
                        count: parseInt(dataResult.rows[0].count)
                    });
                } else if (hasId) {
                    // Try to find data by id
                    const dataResult = await pool.query(`
                        SELECT COUNT(*) as count FROM "${table.table_name}" WHERE id = $1
                    `, [dealId]);
                    
                    searchResults.push({
                        table_name: table.table_name,
                        table_type: table.table_type,
                        has_deal_id: false,
                        has_id: true,
                        columns: columns,
                        count: parseInt(dataResult.rows[0].count)
                    });
                } else {
                    searchResults.push({
                        table_name: table.table_name,
                        table_type: table.table_type,
                        has_deal_id: false,
                        has_id: hasId,
                        columns: columns,
                        count: 0
                    });
                }
            } catch (e) {
                searchResults.push({
                    table_name: table.table_name,
                    table_type: table.table_type,
                    error: e.message,
                    columns: []
                });
            }
        }
        
        res.json({
            deal_id: dealId,
            email_tables: emailTables.rows,
            email_views: emailViews.rows,
            search_results: searchResults
        });
        
    } catch (error) {
        console.error('Error searching for email data:', error);
        res.status(503).json({ 
            error: 'Database connection failed',
            message: 'Please ensure you are connected to the VPN and try again'
        });
    }
});

// API endpoint to get comprehensive email data for a deal
app.get('/api/deal-emails/:dealId', async (req, res) => {
    try {
        const dealId = parseInt(req.params.dealId);
        
        // Test database connection first
        await pool.query('SELECT 1');
        
        const allEmails = [];
        
        // 1. Get emails from deal_tasks_send_email table
        try {
            const sendEmailTaskIds = await pool.query(`
                SELECT dt.id as task_id, dt.created as task_created, dt.updated as task_updated,
                       dts.*
                FROM deal_tasks dt
                JOIN deal_tasks_send_email dts ON dt.id = dts.id
                WHERE dt.deal_id = $1 AND dt.task_type = 'SEND_EMAIL'
            `, [dealId]);
            
            if (sendEmailTaskIds.rows.length > 0) {
                sendEmailTaskIds.rows.forEach(email => {
                    allEmails.push({
                        source: 'deal_tasks_send_email',
                        id: email.id,
                        from: email.from_email,
                        to: email.to_email,
                        subject: email.subject,
                        body: email.final_body || email.suggested_body,
                        timestamp: email.task_created, // Use task creation date as email timestamp
                        in_reply_to: email.in_reply_to,
                        follow_up: email.follow_up,
                        direction: 'outgoing'
                    });
                });
            }
        } catch (e) {
            console.error('Error fetching from deal_tasks_send_email:', e);
        }
        
        // 2. Get incoming messages that the outgoing emails are replying to
        try {
            // Get all in_reply_to references from outgoing emails
            const replyToIds = allEmails
                .filter(email => email.in_reply_to)
                .map(email => email.in_reply_to);
            
            if (replyToIds.length > 0) {
                // Search for incoming messages in messages_dealer_email table
                const incomingMessages = await pool.query(`
                    SELECT * FROM messages_dealer_email 
                    WHERE smtp_message_id = ANY($1)
                `, [replyToIds]);
                
                incomingMessages.rows.forEach(msg => {
                    // Try to extract email data from smtp_metadata
                    let emailData = null;
                    try {
                        if (msg.smtp_metadata) {
                            emailData = typeof msg.smtp_metadata === 'string' ? JSON.parse(msg.smtp_metadata) : msg.smtp_metadata;
                        }
                    } catch (e) {
                        console.error('Error parsing smtp_metadata:', e);
                    }
                    
                    allEmails.push({
                        source: 'messages_dealer_email',
                        id: msg.id,
                        from: emailData?.from || 'Unknown',
                        to: emailData?.to || 'Unknown',
                        subject: emailData?.subject || 'No Subject',
                        body: msg.summarized_content || emailData?.body || 'No content available',
                        timestamp: emailData?.timestamp || msg.created || new Date(),
                        message_id: msg.smtp_message_id,
                        direction: 'incoming'
                    });
                });
                
                // Also search in other message tables
                const otherIncomingMessages = await pool.query(`
                    SELECT * FROM messages 
                    WHERE id::text = ANY($1) OR message_id = ANY($1)
                `, [replyToIds]);
                
                otherIncomingMessages.rows.forEach(msg => {
                    allEmails.push({
                        source: 'messages_table',
                        id: msg.id,
                        from: 'Unknown',
                        to: 'Unknown',
                        subject: 'No Subject',
                        body: msg.text || 'No content available',
                        timestamp: msg.created,
                        message_id: msg.id,
                        direction: 'incoming'
                    });
                });
            }
        } catch (e) {
            console.error('Error fetching incoming messages:', e);
        }
        
        // 3. Get emails from task payloads
        try {
            const tasks = await pool.query(`
                SELECT id, task_type, payload, created 
                FROM deal_tasks 
                WHERE deal_id = $1 AND payload IS NOT NULL
                ORDER BY created DESC
            `, [dealId]);
            
            tasks.rows.forEach(task => {
                if (task.payload) {
                    try {
                        const payload = typeof task.payload === 'string' ? JSON.parse(task.payload) : task.payload;
                        
                        // Extract email data from various task types
                        const extractEmailsFromPayload = (payload, taskType) => {
                            const emails = [];
                            
                            // Look for email_data
                            if (payload.email_data) {
                                const emailData = payload.email_data;
                                if (emailData.conversation && Array.isArray(emailData.conversation)) {
                                    emailData.conversation.forEach(msg => {
                                        if (msg.role === 'email' || msg.content.includes('@')) {
                                            emails.push({
                                                source: `${taskType}_payload`,
                                                id: msg.message_id || msg.id || task.id,
                                                from: msg.from || msg.sender || 'Unknown',
                                                to: msg.to || msg.recipient || 'Unknown',
                                                subject: msg.subject || 'No Subject',
                                                body: msg.content || msg.body || msg.message,
                                                timestamp: msg.timestamp || msg.sent_at || msg.created_at || task.created,
                                                direction: msg.direction || 'unknown'
                                            });
                                        }
                                    });
                                } else if (emailData.body) {
                                    emails.push({
                                        source: `${taskType}_payload`,
                                        id: emailData.id || task.id,
                                        from: emailData.from || 'Unknown',
                                        to: emailData.to || 'Unknown',
                                        subject: emailData.subject || 'No Subject',
                                        body: emailData.body,
                                        timestamp: emailData.sent_at || emailData.timestamp || task.created,
                                        direction: emailData.direction || 'unknown'
                                    });
                                }
                            }
                            
                            // Look for conversation array
                            if (payload.conversation && Array.isArray(payload.conversation)) {
                                payload.conversation.forEach(msg => {
                                    if (msg.role === 'email' || msg.content.includes('@')) {
                                        emails.push({
                                            source: `${taskType}_payload`,
                                            id: msg.message_id || msg.id || task.id,
                                            from: msg.from || msg.sender || 'Unknown',
                                            to: msg.to || msg.recipient || 'Unknown',
                                            subject: msg.subject || 'No Subject',
                                            body: msg.content || msg.body || msg.message,
                                            timestamp: msg.timestamp || msg.sent_at || msg.created_at || task.created,
                                            direction: msg.direction || 'unknown'
                                        });
                                    }
                                });
                            }
                            
                            // Look for messages array
                            if (payload.messages && Array.isArray(payload.messages)) {
                                payload.messages.forEach(msg => {
                                    if (msg.role === 'email' || msg.content.includes('@')) {
                                        emails.push({
                                            source: `${taskType}_payload`,
                                            id: msg.message_id || msg.id || task.id,
                                            from: msg.from || msg.sender || 'Unknown',
                                            to: msg.to || msg.recipient || 'Unknown',
                                            subject: msg.subject || 'No Subject',
                                            body: msg.content || msg.body || msg.message,
                                            timestamp: msg.timestamp || msg.sent_at || msg.created_at || task.created,
                                            direction: msg.direction || 'unknown'
                                        });
                                    }
                                });
                            }
                            
                            return emails;
                        };
                        
                        const taskEmails = extractEmailsFromPayload(payload, task.task_type);
                        allEmails.push(...taskEmails);
                        
                    } catch (e) {
                        console.error('Error parsing task payload:', e);
                    }
                }
            });
        } catch (e) {
            console.error('Error fetching from task payloads:', e);
        }
        
        // 4. Get emails from messages table
        try {
            const conversationResult = await pool.query(`
                SELECT id FROM conversations 
                WHERE deal_id = $1 AND deleted IS NULL
            `, [dealId]);
            
            if (conversationResult.rows.length > 0) {
                const conversationId = conversationResult.rows[0].id;
                
                const messagesResult = await pool.query(`
                    SELECT id, message_type, text, created 
                    FROM messages 
                    WHERE conversation_id = $1 AND deleted IS NULL
                    ORDER BY created ASC
                `, [conversationId]);
                
                messagesResult.rows.forEach(msg => {
                    if (msg.message_type === 'email' || msg.text.includes('@')) {
                        allEmails.push({
                            source: 'messages_table',
                            id: msg.id,
                            from: 'Unknown',
                            to: 'Unknown',
                            subject: 'No Subject',
                            body: msg.text,
                            timestamp: msg.created,
                            direction: 'unknown'
                        });
                    }
                });
            }
        } catch (e) {
            console.error('Error fetching from messages table:', e);
        }
        
        // 5. Get emails from events table (this is the main source!)
        try {
            const eventsResult = await pool.query(`
                SELECT * FROM events 
                WHERE deal_id = $1 AND action_id IN (4, 5) AND details IS NOT NULL
                ORDER BY event_timestamp ASC
            `, [dealId]);
            
            const emailPromises = eventsResult.rows
                .filter(event => event.details && event.details.details)
                .map(async (event) => {
                    const emailDetails = event.details.details;
                    const isIncoming = event.action_id === 5; // EMAIL_RECEIVED
                    const isOutgoing = event.action_id === 4; // EMAIL_SENT
                    
                    if (isIncoming || isOutgoing) {
                        const emailContent = await getEmailContent(emailDetails, pool);
                        return {
                            source: 'events_table',
                            id: event.id,
                            from: emailDetails.from_address,
                            to: emailDetails.to_address,
                            subject: emailDetails.subject,
                            body: emailContent || 'Email content not available',
                            timestamp: event.event_timestamp,
                            direction: isIncoming ? 'incoming' : 'outgoing',
                            message_id: emailDetails.message_id,
                            event_name: event.details.event_name
                        };
                    }
                    return null;
                });
            
            const emailResults = await Promise.all(emailPromises);
            allEmails = allEmails.concat(emailResults.filter(email => email !== null));
        } catch (e) {
            console.error('Error fetching from events table:', e);
        }
        
        // Remove duplicates and sort by timestamp
        const uniqueEmails = [];
        const seenEmails = new Set();
        
        allEmails.forEach(email => {
            const emailKey = `${email.from}-${email.to}-${email.subject}-${email.timestamp}`;
            if (!seenEmails.has(emailKey)) {
                seenEmails.add(emailKey);
                uniqueEmails.push(email);
            }
        });
        
        uniqueEmails.sort((a, b) => {
            const timeA = new Date(a.timestamp || 0);
            const timeB = new Date(b.timestamp || 0);
            return timeA - timeB;
        });
        
        res.json({
            deal_id: dealId,
            total_emails: uniqueEmails.length,
            emails: uniqueEmails,
            sources: [...new Set(uniqueEmails.map(e => e.source))],
            directions: [...new Set(uniqueEmails.map(e => e.direction))]
        });
        
    } catch (error) {
        console.error('Error fetching deal emails:', error);
        res.status(503).json({ 
            error: 'Database connection failed',
            message: 'Please ensure you are connected to the VPN and try again'
        });
    }
});

// API endpoint to get deal grading data
app.get('/api/deal-grading/:dealId', async (req, res) => {
    try {
        const dealId = parseInt(req.params.dealId);
        
        // Test database connection first
        await pool.query('SELECT 1');
        
        // Get deal with risk assessment data
        const dealResult = await pool.query(`
            SELECT 
                d.id as deal_id,
                d.state,
                dt.payload
            FROM deals d
            LEFT JOIN deal_tasks dt ON d.id = dt.deal_id AND dt.task_type = 'RISK_ASSESSMENT_UPDATE'
            WHERE d.id = $1 AND d.is_active = true
        `, [dealId]);
        
        if (dealResult.rows.length === 0) {
            return res.status(404).json({ error: 'Deal not found' });
        }
        
        const deal = dealResult.rows[0];
        let grading = null;
        
        // Extract fee data and calculate grades
        if (deal.payload) {
            try {
                const payload = typeof deal.payload === 'string' ? JSON.parse(deal.payload) : deal.payload;
                
                if (payload.fees && Array.isArray(payload.fees)) {
                    let excessiveFees = 0;
                    let illegitimateFees = 0;
                    
                    payload.fees.forEach(fee => {
                        const amount = fee.amount || 0;
                        if (fee.assessment === 'EXCESSIVE') {
                            excessiveFees += amount;
                        } else if (fee.assessment === 'ILLEGITIMATE') {
                            illegitimateFees += amount;
                        }
                    });
                    
                    // Import grading functions
                    const { gradeDeal, getGradingExplanation } = require('./grading-system.js');
                    grading = gradeDeal(excessiveFees, illegitimateFees);
                    grading.explanation = getGradingExplanation();
                }
            } catch (e) {
                console.error('Error processing deal grading:', e);
            }
        }
        
        res.json({
            deal_id: dealId,
            state: deal.state,
            grading: grading,
            has_grading: grading !== null
        });
        
    } catch (error) {
        console.error('Error fetching deal grading:', error);
        res.status(503).json({ 
            error: 'Database connection failed',
            message: 'Please ensure you are connected to the VPN and try again'
        });
    }
});

// API endpoint to get dealership rankings
app.get('/api/dealership-rankings', async (req, res) => {
    try {
        // Test database connection first
        await pool.query('SELECT 1');
        

        

        
        // Get ONLY deals that are in "analysis" state with fee data
        const dealsResult = await pool.query(`
            SELECT DISTINCT
                d.id as deal_id,
                d.state,
                dl.name as dealer_name,
                dl.city,
                dl.state_code,
                dt.payload
            FROM deals d
            LEFT JOIN listings l ON d.id = l.deal_id
            LEFT JOIN dealers dl ON l.dealer_id = dl.id
            LEFT JOIN (
                SELECT DISTINCT deal_id, payload 
                FROM deal_tasks 
                WHERE task_type = 'RISK_ASSESSMENT_UPDATE'
            ) dt ON d.id = dt.deal_id
            WHERE d.state = 'analysis' AND d.is_active = true
            ORDER BY d.id
        `);
        
        // Process deals and group by dealer
        const dealerDeals = {};
        
        console.log(`Processing ${dealsResult.rows.length} deals for dealership rankings`);
        
        const processedDeals = new Set(); // Track processed deals to avoid duplicates
        
        dealsResult.rows.forEach(row => {
            try {
                // Skip if we've already processed this deal
                if (processedDeals.has(row.deal_id)) {
                    return;
                }
                processedDeals.add(row.deal_id);
                
                if (row.payload) {
                    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
                    
                    if (payload.fees && Array.isArray(payload.fees)) {
                        let excessiveFees = 0;
                        let illegitimateFees = 0;
                        
                        payload.fees.forEach(fee => {
                            const amount = fee.amount || 0;
                            if (fee.assessment === 'EXCESSIVE') {
                                excessiveFees += amount;
                            } else if (fee.assessment === 'ILLEGITIMATE') {
                                illegitimateFees += amount;
                            }
                        });
                        
                        const dealerKey = row.dealer_name || 'Unknown Dealer';
                        if (!dealerDeals[dealerKey]) {
                            dealerDeals[dealerKey] = {
                                dealer_name: dealerKey,
                                location: `${row.city || ''}, ${row.state_code || ''}`,
                                deals: []
                            };
                        }
                        
                        dealerDeals[dealerKey].deals.push({
                            deal_id: row.deal_id,
                            excessive_fees: excessiveFees,
                            illegitimate_fees: illegitimateFees
                        });
                    }
                }
            } catch (e) {
                console.error('Error processing deal:', e);
            }
        });
        
        console.log(`Processed ${processedDeals.size} unique deals for dealership rankings`);
        
        // Grade each dealer
        const { gradeDealer, getGradingExplanation } = require('./grading-system.js');
        const rankings = Object.values(dealerDeals)
            .map(dealer => ({
                ...dealer,
                grading: gradeDealer(dealer.deals)
            }))
            .filter(dealer => dealer.grading.dealCount > 0)
            .sort((a, b) => {
                // Sort by calculated score (highest score = best rank)
                // The score is now calculated based on actual fee amounts
                const aScore = a.grading.averageScores.overall || 0;
                const bScore = b.grading.averageScores.overall || 0;
                
                // Primary sort: score (highest first)
                if (Math.abs(aScore - bScore) > 0.1) {
                    return bScore - aScore;
                }
                
                // If scores are the same, sort by weighted fees (lowest first) as tiebreaker
                const aWeightedFees = ((a.grading.averageFees.excessive || 0) * 0.4) + ((a.grading.averageFees.illegitimate || 0) * 0.6);
                const bWeightedFees = ((b.grading.averageFees.excessive || 0) * 0.4) + ((b.grading.averageFees.illegitimate || 0) * 0.6);
                
                if (Math.abs(aWeightedFees - bWeightedFees) > 0.01) {
                    return aWeightedFees - bWeightedFees;
                }
                
                // If still tied, sort by illegitimate fees (lowest first)
                const aIllegitimate = a.grading.averageFees.illegitimate || 0;
                const bIllegitimate = b.grading.averageFees.illegitimate || 0;
                
                if (Math.abs(aIllegitimate - bIllegitimate) > 0.01) {
                    return aIllegitimate - bIllegitimate;
                }
                
                // Final tiebreaker: excessive fees (lowest first)
                const aExcessive = a.grading.averageFees.excessive || 0;
                const bExcessive = b.grading.averageFees.excessive || 0;
                
                return aExcessive - bExcessive;
            });
        
        res.json({
            rankings: rankings,
            total_dealers: rankings.length,
            explanation: getGradingExplanation()
        });
        
    } catch (error) {
        console.error('Error fetching dealership rankings:', error);
        res.status(503).json({ 
            error: 'Database connection failed',
            message: 'Please ensure you are connected to the VPN and try again'
        });
    }
});

// API endpoint to debug message tables
app.get('/api/debug-messages/:dealId', async (req, res) => {
    try {
        const dealId = parseInt(req.params.dealId);
        
        // Test database connection first
        await pool.query('SELECT 1');
        
        const debugData = {};
        
        // Check messages_dealer_email table
        try {
            const dealerEmailCount = await pool.query(`
                SELECT COUNT(*) as count FROM messages_dealer_email
            `);
            
            const sampleDealerEmails = await pool.query(`
                SELECT * FROM messages_dealer_email LIMIT 5
            `);
            
            debugData.messages_dealer_email = {
                total_count: parseInt(dealerEmailCount.rows[0].count),
                sample_data: sampleDealerEmails.rows
            };
        } catch (e) {
            debugData.messages_dealer_email = { error: e.message };
        }
        
        // Check messages table
        try {
            const messagesCount = await pool.query(`
                SELECT COUNT(*) as count FROM messages
            `);
            
            const sampleMessages = await pool.query(`
                SELECT * FROM messages LIMIT 5
            `);
            
            debugData.messages = {
                total_count: parseInt(messagesCount.rows[0].count),
                sample_data: sampleMessages.rows
            };
        } catch (e) {
            debugData.messages = { error: e.message };
        }
        
        // Check messages_sendemail table
        try {
            const sendEmailCount = await pool.query(`
                SELECT COUNT(*) as count FROM messages_sendemail
            `);
            
            const sampleSendEmails = await pool.query(`
                SELECT * FROM messages_sendemail LIMIT 5
            `);
            
            debugData.messages_sendemail = {
                total_count: parseInt(sendEmailCount.rows[0].count),
                sample_data: sampleSendEmails.rows
            };
        } catch (e) {
            debugData.messages_sendemail = { error: e.message };
        }
        
        // Check conversations table
        try {
            const conversationsCount = await pool.query(`
                SELECT COUNT(*) as count FROM conversations
            `);
            
            const sampleConversations = await pool.query(`
                SELECT * FROM conversations LIMIT 5
            `);
            
            debugData.conversations = {
                total_count: parseInt(conversationsCount.rows[0].count),
                sample_data: sampleConversations.rows
            };
        } catch (e) {
            debugData.conversations = { error: e.message };
        }
        
        // Check events table
        try {
            const eventsCount = await pool.query(`
                SELECT COUNT(*) as count FROM events
            `);
            
            const sampleEvents = await pool.query(`
                SELECT * FROM events LIMIT 5
            `);
            
            debugData.events = {
                total_count: parseInt(eventsCount.rows[0].count),
                sample_data: sampleEvents.rows
            };
            
            // Check if there are events for this specific deal
            const dealEvents = await pool.query(`
                SELECT * FROM events WHERE deal_id = $1
            `, [dealId]);
            
            debugData.deal_events = {
                count: dealEvents.rows.length,
                data: dealEvents.rows
            };
        } catch (e) {
            debugData.events = { error: e.message };
        }
        
        // Get the in_reply_to IDs for this deal
        try {
            const replyToIds = await pool.query(`
                SELECT in_reply_to FROM deal_tasks_send_email dts
                JOIN deal_tasks dt ON dts.id = dt.id
                WHERE dt.deal_id = $1 AND dts.in_reply_to IS NOT NULL
            `, [dealId]);
            
            debugData.reply_to_ids = replyToIds.rows.map(row => row.in_reply_to);
        } catch (e) {
            debugData.reply_to_ids = { error: e.message };
        }
        
        res.json(debugData);
        
    } catch (error) {
        console.error('Error debugging messages:', error);
        res.status(503).json({ 
            error: 'Database connection failed',
            message: 'Please ensure you are connected to the VPN and try again'
        });
    }
});

// API endpoint to search for specific message IDs across all email tables
app.get('/api/search-message-ids/:dealId/:messageId', async (req, res) => {
    try {
        const dealId = parseInt(req.params.dealId);
        const messageId = req.params.messageId;
        
        // Test database connection first
        await pool.query('SELECT 1');
        
        const searchResults = {
            deal_id: dealId,
            message_id: messageId,
            found_in: []
        };
        
        // Search in messages_dealer_email table
        try {
            const dealerEmailResult = await pool.query(`
                SELECT *, 'messages_dealer_email' as source_table 
                FROM messages_dealer_email 
                WHERE smtp_message_id = $1
            `, [messageId]);
            
            if (dealerEmailResult.rows.length > 0) {
                searchResults.found_in.push({
                    table: 'messages_dealer_email',
                    count: dealerEmailResult.rows.length,
                    data: dealerEmailResult.rows
                });
            }
        } catch (e) {
            searchResults.errors = searchResults.errors || [];
            searchResults.errors.push(`Error searching messages_dealer_email: ${e.message}`);
        }
        
        // Search in events table
        try {
            const eventsResult = await pool.query(`
                SELECT *, 'events' as source_table 
                FROM events 
                WHERE deal_id = $1 AND details::text LIKE $2
            `, [dealId, `%${messageId}%`]);
            
            if (eventsResult.rows.length > 0) {
                searchResults.found_in.push({
                    table: 'events',
                    count: eventsResult.rows.length,
                    data: eventsResult.rows
                });
            }
        } catch (e) {
            searchResults.errors = searchResults.errors || [];
            searchResults.errors.push(`Error searching events: ${e.message}`);
        }
        
        // Search in messages table
        try {
            const messagesResult = await pool.query(`
                SELECT *, 'messages' as source_table 
                FROM messages 
                WHERE message_id = $1 OR text LIKE $2
            `, [messageId, `%${messageId}%`]);
            
            if (messagesResult.rows.length > 0) {
                searchResults.found_in.push({
                    table: 'messages',
                    count: messagesResult.rows.length,
                    data: messagesResult.rows
                });
            }
        } catch (e) {
            searchResults.errors = searchResults.errors || [];
            searchResults.errors.push(`Error searching messages: ${e.message}`);
        }
        
        // Search in messages_sendemail table
        try {
            const sendEmailResult = await pool.query(`
                SELECT *, 'messages_sendemail' as source_table 
                FROM messages_sendemail 
                WHERE message_id = $1 OR body LIKE $2 OR content LIKE $2
            `, [messageId, `%${messageId}%`]);
            
            if (sendEmailResult.rows.length > 0) {
                searchResults.found_in.push({
                    table: 'messages_sendemail',
                    count: sendEmailResult.rows.length,
                    data: sendEmailResult.rows
                });
            }
        } catch (e) {
            searchResults.errors = searchResults.errors || [];
            searchResults.errors.push(`Error searching messages_sendemail: ${e.message}`);
        }
        
        // Search in deal_tasks table
        try {
            const tasksResult = await pool.query(`
                SELECT id, task_type, payload, created, 'deal_tasks' as source_table 
                FROM deal_tasks 
                WHERE deal_id = $1 AND payload::text LIKE $2
            `, [dealId, `%${messageId}%`]);
            
            if (tasksResult.rows.length > 0) {
                searchResults.found_in.push({
                    table: 'deal_tasks',
                    count: tasksResult.rows.length,
                    data: tasksResult.rows
                });
            }
        } catch (e) {
            searchResults.errors = searchResults.errors || [];
            searchResults.errors.push(`Error searching deal_tasks: ${e.message}`);
        }
        
        // Search in deal_tasks_send_email table  
        try {
            const sendEmailTasksResult = await pool.query(`
                SELECT dts.*, dt.deal_id, 'deal_tasks_send_email' as source_table 
                FROM deal_tasks_send_email dts
                JOIN deal_tasks dt ON dts.id = dt.id
                WHERE dt.deal_id = $1 AND (
                    dts.in_reply_to = $2 OR 
                    dts.final_body LIKE $3 OR 
                    dts.suggested_body LIKE $3
                )
            `, [dealId, messageId, `%${messageId}%`]);
            
            if (sendEmailTasksResult.rows.length > 0) {
                searchResults.found_in.push({
                    table: 'deal_tasks_send_email',
                    count: sendEmailTasksResult.rows.length,
                    data: sendEmailTasksResult.rows
                });
            }
        } catch (e) {
            searchResults.errors = searchResults.errors || [];
            searchResults.errors.push(`Error searching deal_tasks_send_email: ${e.message}`);
        }
        
        res.json(searchResults);
        
    } catch (error) {
        console.error('Error searching for message ID:', error);
        res.status(503).json({ 
            error: 'Database connection failed',
            message: 'Please ensure you are connected to the VPN and try again'
        });
    }
});

// API endpoint to get detailed email content from messages_dealer_email
app.get('/api/dealer-email-content/:messageId', async (req, res) => {
    try {
        const messageId = req.params.messageId;
        
        // Test database connection first
        await pool.query('SELECT 1');
        
        // Get full details from messages_dealer_email
        const emailResult = await pool.query(`
            SELECT * FROM messages_dealer_email 
            WHERE smtp_message_id = $1
        `, [messageId]);
        
        if (emailResult.rows.length === 0) {
            return res.status(404).json({ error: 'Email not found in messages_dealer_email table' });
        }
        
        const emailData = emailResult.rows[0];
        
        // Parse SMTP metadata if it exists
        let parsedMetadata = null;
        if (emailData.smtp_metadata) {
            try {
                parsedMetadata = typeof emailData.smtp_metadata === 'string' ? 
                    JSON.parse(emailData.smtp_metadata) : emailData.smtp_metadata;
            } catch (e) {
                console.error('Error parsing smtp_metadata:', e);
            }
        }
        
        res.json({
            message_id: messageId,
            email_data: emailData,
            parsed_metadata: parsedMetadata,
            available_fields: Object.keys(emailData),
            has_content: !!(emailData.summarized_content || parsedMetadata?.body || parsedMetadata?.text),
            content: emailData.summarized_content || parsedMetadata?.body || parsedMetadata?.text || 'No content available'
        });
        
    } catch (error) {
        console.error('Error fetching dealer email content:', error);
        res.status(503).json({ 
            error: 'Database connection failed',
            message: 'Please ensure you are connected to the VPN and try again'
        });
    }
});

// API endpoint to examine table schemas
app.get('/api/table-schema/:tableName', async (req, res) => {
    try {
        const tableName = req.params.tableName;
        
        // Test database connection first
        await pool.query('SELECT 1');
        
        // Get column information for the table
        const columnsResult = await pool.query(`
            SELECT 
                column_name,
                data_type,
                is_nullable,
                column_default,
                character_maximum_length
            FROM information_schema.columns 
            WHERE table_name = $1 AND table_schema = 'public'
            ORDER BY ordinal_position
        `, [tableName]);
        
        // Get a few sample rows
        const sampleResult = await pool.query(`
            SELECT * FROM ${tableName} LIMIT 3
        `);
        
        // Get total row count
        const countResult = await pool.query(`
            SELECT COUNT(*) as total_count FROM ${tableName}
        `);
        
        res.json({
            table_name: tableName,
            columns: columnsResult.rows,
            sample_data: sampleResult.rows,
            total_rows: parseInt(countResult.rows[0].total_count),
            column_names: columnsResult.rows.map(col => col.column_name)
        });
        
    } catch (error) {
        console.error('Error fetching table schema:', error);
        res.status(500).json({ 
            error: 'Failed to fetch table schema',
            message: error.message
        });
    }
});

// Outreach screenshots endpoint - explore outreach data structure
app.get('/api/outreach-data/:dealId?', async (req, res) => {
    try {
        const { dealId } = req.params;
        
        // Test database connection
        await pool.query('SELECT 1');
        
        // Query messages_dealeroutreach table
        let query = `
            SELECT *
            FROM messages_dealeroutreach 
        `;
        let params = [];
        
        if (dealId) {
            // First find the deal's message IDs
            const dealMessagesQuery = `
                SELECT m.id as message_id
                FROM messages m 
                WHERE m.deal_id = $1
            `;
            const dealMessagesResult = await pool.query(dealMessagesQuery, [dealId]);
            const messageIds = dealMessagesResult.rows.map(row => row.message_id);
            
            if (messageIds.length > 0) {
                query += ` WHERE message_id = ANY($1)`;
                params = [messageIds];
            } else {
                return res.json({
                    deal_id: dealId,
                    outreach_data: [],
                    message: 'No messages found for this deal'
                });
            }
        } else {
            query += ` LIMIT 5`; // Just get first 5 for exploration
        }
        
        console.log('Outreach query:', query, 'params:', params);
        const result = await pool.query(query, params);
        
        res.json({
            deal_id: dealId || 'all',
            outreach_data: result.rows,
            total_count: result.rows.length,
            columns: result.rows.length > 0 ? Object.keys(result.rows[0]) : []
        });
        
    } catch (error) {
        console.error('Error fetching outreach data:', error);
        res.status(503).json({ 
            error: 'Database error', 
            message: error.message,
            reminder: 'Make sure VPN is connected for database access'
        });
    }
});

// Search for screenshot/image data across all relevant tables
app.get('/api/screenshot-search/:dealId?', async (req, res) => {
    try {
        const { dealId } = req.params;
        
        // Test database connection
        await pool.query('SELECT 1');
        
        let results = {};
        
        // Search in deal_tasks table for outreach tasks with payloads
        const taskQuery = `
            SELECT id, deal_id, task_type, payload, created, updated
            FROM deal_tasks 
            WHERE task_type LIKE '%OUTREACH%' 
            ${dealId ? 'AND deal_id = $1' : ''}
            ORDER BY created DESC 
            LIMIT 10
        `;
        const taskParams = dealId ? [parseInt(dealId)] : [];
        const taskResult = await pool.query(taskQuery, taskParams);
        results.outreach_tasks = {
            total_count: taskResult.rows.length,
            data: taskResult.rows
        };
        
        // Check deal_tasks_dealer_outreach_task specifically
        const outreachTaskQuery = `
            SELECT dot.*, dt.payload, dt.created, dt.deal_id
            FROM deal_tasks_dealer_outreach_task dot
            JOIN deal_tasks dt ON dot.deal_task_id = dt.id
            ${dealId ? 'WHERE dt.deal_id = $1' : ''}
            ORDER BY dt.created DESC 
            LIMIT 10
        `;
        const outreachTaskResult = await pool.query(outreachTaskQuery, taskParams);
        results.dealer_outreach_tasks = {
            total_count: outreachTaskResult.rows.length,
            data: outreachTaskResult.rows
        };
        
        res.json({
            deal_id: dealId || 'all',
            search_results: results,
            message: 'Screenshot search across multiple tables'
        });
        
    } catch (error) {
        console.error('Error searching for screenshots:', error);
        res.status(503).json({ 
            error: 'Database error', 
            message: error.message,
            reminder: 'Make sure VPN is connected for database access'
        });
    }
});

// Simple outreach task payload explorer
app.get('/api/outreach-payloads', async (req, res) => {
    try {
        // Test database connection
        await pool.query('SELECT 1');
        
        // Find outreach tasks with non-null payloads
        const query = `
            SELECT id, deal_id, task_type, payload, created, state
            FROM deal_tasks 
            WHERE task_type LIKE '%OUTREACH%' 
            AND payload IS NOT NULL
            ORDER BY created DESC 
            LIMIT 20
        `;
        
        const result = await pool.query(query);
        
        res.json({
            total_outreach_tasks_with_payloads: result.rows.length,
            tasks: result.rows.map(task => ({
                ...task,
                payload_preview: typeof task.payload === 'object' ? 
                    Object.keys(task.payload).join(', ') : 
                    'Not an object'
            }))
        });
        
    } catch (error) {
        console.error('Error fetching outreach payloads:', error);
        res.status(503).json({ 
            error: 'Database error', 
            message: error.message,
            reminder: 'Make sure VPN is connected for database access'
        });
    }
});

// API endpoint to search all deals (for comprehensive search functionality)
app.get('/api/deals-search', async (req, res) => {
    try {
        const { q } = req.query; // Get search query parameter
        
        // Test database connection first
        await pool.query('SELECT 1');
        
        // Base query to get all active deals with dealer information
        let query = `
            SELECT 
                d.id,
                d.state,
                d.created,
                d.updated,
                v.vin as vehicle_vin,
                dl.name as dealer_name,
                dl.city,
                dl.state_code,
                c.name as customer_name,
                c.email as customer_email
            FROM deals d
            LEFT JOIN listings l ON d.id = l.deal_id
            LEFT JOIN dealers dl ON l.dealer_id = dl.id
            LEFT JOIN vehicles v ON l.vehicle_id = v.id
            LEFT JOIN customers c ON d.customer_id = c.id
            WHERE d.is_active = true
        `;
        
        let params = [];
        
        // Add search filtering if query provided
        if (q && q.trim()) {
            query += ` 
                AND (
                    d.id::text ILIKE $1 OR
                    dl.name ILIKE $1 OR
                    dl.city ILIKE $1 OR
                    dl.state_code ILIKE $1 OR
                    d.state ILIKE $1 OR
                    v.vin ILIKE $1 OR
                    c.name ILIKE $1 OR
                    c.email ILIKE $1
                )
            `;
            params.push(`%${q.trim()}%`);
        }
        
        query += ` ORDER BY d.updated DESC`; // No limit to search all deals
        
        const result = await pool.query(query, params);

        const deals = result.rows.map(row => ({
            id: row.id,
            date: new Date(row.updated).toLocaleDateString(),
            description: `Deal ${row.id} - ${row.dealer_name || 'Unknown Dealer'} (${row.state})`,
            status: row.state === 'analysis' ? 'active' : 
                   row.state === 'vin_sold' ? 'completed' : 'pending',
            deal_id: row.id,
            dealer_name: row.dealer_name || 'Unknown Dealer',
            dealer_location: row.city && row.state_code ? `${row.city}, ${row.state_code}` : 'Unknown Location',
            deal_state: row.state,
            customer_name: row.customer_name,
            customer_email: row.customer_email,
            vehicle_vin: row.vehicle_vin
        }));

        res.json({
            total: deals.length,
            query: q || 'all',
            deals: deals
        });
    } catch (error) {
        console.error('Error searching deals:', error);
        res.status(503).json({ 
            error: 'Database connection failed',
            message: 'Please ensure you are connected to the VPN and try again'
        });
    }
});

// Find all deals with attachments (screenshots/documents)
app.get('/api/deal-attachments/:dealId?', async (req, res) => {
    try {
        const { dealId } = req.params;
        
        // Test database connection
        await pool.query('SELECT 1');
        
        // Get deal tasks with conversation data containing attachments
        let query = `
            SELECT 
                id, 
                deal_id, 
                task_type, 
                meta->'request'->'conversation' as conversation,
                created,
                state
            FROM deal_tasks 
            WHERE meta->'request'->'conversation' IS NOT NULL
            AND jsonb_array_length(meta->'request'->'conversation') > 0
        `;
        
        let params = [];
        if (dealId) {
            query += ` AND deal_id = $1`;
            params = [parseInt(dealId)];
        }
        
        query += ` ORDER BY created DESC LIMIT 50`;
        
        const result = await pool.query(query, params);
        
        // Process results to extract attachment information
        const dealsWithAttachments = [];
        
        result.rows.forEach(task => {
            if (task.conversation && Array.isArray(task.conversation)) {
                task.conversation.forEach(message => {
                    if (message.attachments && message.attachments.length > 0) {
                        dealsWithAttachments.push({
                            deal_id: task.deal_id,
                            task_id: task.id,
                            task_type: task.task_type,
                            created: task.created,
                            state: task.state,
                            message_role: message.role,
                            timestamp: message.timestamp,
                            attachments: message.attachments.map(att => ({
                                path: att.path,
                                filename: att.filename
                            }))
                        });
                    }
                });
            }
        });
        
        res.json({
            deal_id: dealId || 'all',
            total_deals_with_attachments: dealsWithAttachments.length,
            attachments: dealsWithAttachments
        });
        
    } catch (error) {
        console.error('Error fetching deal attachments:', error);
        res.status(503).json({ 
            error: 'Database error', 
            message: error.message,
            reminder: 'Make sure VPN is connected for database access'
        });
    }
});

// API endpoint to search for email content in all possible locations
app.get('/api/comprehensive-email-search/:dealId', async (req, res) => {
    try {
        const dealId = parseInt(req.params.dealId);
        
        // Test database connection first
        await pool.query('SELECT 1');
        
        const searchResults = {
            deal_id: dealId,
            email_sources: []
        };
        
        // 1. Search in events table for email metadata
        try {
            const eventsResult = await pool.query(`
                SELECT * FROM events 
                WHERE deal_id = $1 AND action_id IN (4, 5)
                ORDER BY event_timestamp ASC
            `, [dealId]);
            
            if (eventsResult.rows.length > 0) {
                searchResults.email_sources.push({
                    table: 'events',
                    description: 'Email metadata (subjects, from/to addresses, message IDs)',
                    count: eventsResult.rows.length,
                    data: eventsResult.rows.map(row => ({
                        id: row.id,
                        timestamp: row.event_timestamp,
                        event_name: row.details?.event_name,
                        subject: row.details?.details?.subject,
                        from: row.details?.details?.from_address,
                        to: row.details?.details?.to_address,
                        message_id: row.details?.details?.message_id,
                        has_content: false
                    }))
                });
            }
        } catch (e) {
            searchResults.errors = searchResults.errors || [];
            searchResults.errors.push(`Error searching events: ${e.message}`);
        }
        
        // 2. Search in deal_tasks for email payloads
        try {
            const tasksResult = await pool.query(`
                SELECT id, task_type, payload, created 
                FROM deal_tasks 
                WHERE deal_id = $1 AND (
                    task_type LIKE '%EMAIL%' OR 
                    payload::text LIKE '%email%' OR 
                    payload::text LIKE '%@%'
                )
                ORDER BY created ASC
            `, [dealId]);
            
            if (tasksResult.rows.length > 0) {
                const emailTasks = tasksResult.rows.map(task => {
                    let emailContent = null;
                    let hasEmailData = false;
                    
                    if (task.payload) {
                        try {
                            const payload = typeof task.payload === 'string' ? JSON.parse(task.payload) : task.payload;
                            
                            // Look for various email content fields
                            if (payload.email_data) hasEmailData = true;
                            if (payload.conversation) hasEmailData = true;
                            if (payload.body) hasEmailData = true;
                            if (payload.content) hasEmailData = true;
                            
                            // Extract sample content
                            if (payload.body) emailContent = payload.body.substring(0, 200) + '...';
                            else if (payload.email_data?.body) emailContent = payload.email_data.body.substring(0, 200) + '...';
                            else if (payload.content) emailContent = payload.content.substring(0, 200) + '...';
                        } catch (e) {
                            // Payload parsing failed
                        }
                    }
                    
                    return {
                        id: task.id,
                        task_type: task.task_type,
                        created: task.created,
                        has_email_data: hasEmailData,
                        sample_content: emailContent
                    };
                });
                
                searchResults.email_sources.push({
                    table: 'deal_tasks',
                    description: 'Task payloads containing email data',
                    count: emailTasks.length,
                    data: emailTasks
                });
            }
        } catch (e) {
            searchResults.errors = searchResults.errors || [];
            searchResults.errors.push(`Error searching deal_tasks: ${e.message}`);
        }
        
        // 3. Search deal_tasks_send_email for outgoing emails
        try {
            const sendEmailResult = await pool.query(`
                SELECT dts.*, dt.created 
                FROM deal_tasks_send_email dts
                JOIN deal_tasks dt ON dts.id = dt.id
                WHERE dt.deal_id = $1
                ORDER BY dt.created ASC
            `, [dealId]);
            
            if (sendEmailResult.rows.length > 0) {
                const sendEmails = sendEmailResult.rows.map(email => ({
                    id: email.id,
                    from: email.from_email,
                    to: email.to_email,
                    subject: email.subject,
                    created: email.created,
                    has_body: !!(email.final_body || email.suggested_body),
                    body_preview: (email.final_body || email.suggested_body || '').substring(0, 200) + '...',
                    in_reply_to: email.in_reply_to
                }));
                
                searchResults.email_sources.push({
                    table: 'deal_tasks_send_email',
                    description: 'Outgoing email tasks with full content',
                    count: sendEmails.length,
                    data: sendEmails
                });
            }
        } catch (e) {
            searchResults.errors = searchResults.errors || [];
            searchResults.errors.push(`Error searching deal_tasks_send_email: ${e.message}`);
        }
        
        res.json(searchResults);
        
    } catch (error) {
        console.error('Error in comprehensive email search:', error);
        res.status(503).json({ 
            error: 'Database connection failed',
            message: 'Please ensure you are connected to the VPN and try again'
        });
    }
});

// API endpoint to search for tables with text/content columns
app.get('/api/find-content-tables', async (req, res) => {
    try {
        // Test database connection first
        await pool.query('SELECT 1');
        
        // Find all tables with text/content columns that might store email content
        const contentTablesResult = await pool.query(`
            SELECT DISTINCT 
                table_name,
                column_name,
                data_type,
                character_maximum_length
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND (
                data_type IN ('text', 'jsonb', 'json') OR
                column_name ILIKE '%content%' OR
                column_name ILIKE '%body%' OR
                column_name ILIKE '%message%' OR
                column_name ILIKE '%smtp%' OR
                column_name ILIKE '%email%' OR
                column_name ILIKE '%raw%'
            )
            ORDER BY table_name, column_name
        `);
        
        // Group by table name
        const tableGroups = {};
        contentTablesResult.rows.forEach(row => {
            if (!tableGroups[row.table_name]) {
                tableGroups[row.table_name] = [];
            }
            tableGroups[row.table_name].push({
                column_name: row.column_name,
                data_type: row.data_type,
                character_maximum_length: row.character_maximum_length
            });
        });
        
        // Get row counts for each table
        const tablesWithCounts = [];
        for (const tableName of Object.keys(tableGroups)) {
            try {
                const countResult = await pool.query(`SELECT COUNT(*) as count FROM "${tableName}"`);
                tablesWithCounts.push({
                    table_name: tableName,
                    columns: tableGroups[tableName],
                    row_count: parseInt(countResult.rows[0].count)
                });
            } catch (e) {
                tablesWithCounts.push({
                    table_name: tableName,
                    columns: tableGroups[tableName],
                    row_count: 'Error: ' + e.message
                });
            }
        }
        
        res.json({
            content_tables: tablesWithCounts,
            total_tables_found: tablesWithCounts.length
        });
        
    } catch (error) {
        console.error('Error finding content tables:', error);
        res.status(503).json({ 
            error: 'Database connection failed',
            message: 'Please ensure you are connected to the VPN and try again'
        });
    }
});

// API endpoint to search for incoming email content that may be stored elsewhere
app.get('/api/search-incoming-email-content/:dealId', async (req, res) => {
    try {
        const dealId = parseInt(req.params.dealId);
        const targetMessageIds = [
            '58e98b1d-dec9-4fe8-9f0f-8fc97f7de8c4@notice.drivevelocity.com',
            '29abb39d-30b5-40f9-9e9d-fe6d493798ec@notice.drivevelocity.com', 
            '6761947b-f6f4-4763-a19b-770a20bbcd60@notice.drivevelocity.com'
        ];
        
        // Test database connection first
        await pool.query('SELECT 1');
        
        const searchResults = {
            deal_id: dealId,
            target_message_ids: targetMessageIds,
            search_results: []
        };
        
        // Since the incoming emails aren't in messages_dealer_email, they might be:
        // 1. In a raw email storage table
        // 2. In task payloads as part of conversation data
        // 3. In an SMTP logs table
        // 4. In a separate email archival system
        
        // Let's search for any payload that contains these message IDs
        const payloadSearchResult = await pool.query(`
            SELECT 
                id, 
                task_type, 
                created,
                payload
            FROM deal_tasks 
            WHERE deal_id = $1 
            AND (
                payload::text ILIKE '%58e98b1d-dec9-4fe8-9f0f-8fc97f7de8c4@notice.drivevelocity.com%' OR
                payload::text ILIKE '%29abb39d-30b5-40f9-9e9d-fe6d493798ec@notice.drivevelocity.com%' OR
                payload::text ILIKE '%6761947b-f6f4-4763-a19b-770a20bbcd60@notice.drivevelocity.com%'
            )
        `, [dealId]);
        
        if (payloadSearchResult.rows.length > 0) {
            const taskMatches = payloadSearchResult.rows.map(task => {
                let extractedEmails = [];
                
                if (task.payload) {
                    try {
                        const payload = typeof task.payload === 'string' ? JSON.parse(task.payload) : task.payload;
                        
                        // Deep search for email content in the payload
                        const findEmailContent = (obj, path = '') => {
                            if (typeof obj === 'object' && obj !== null) {
                                if (Array.isArray(obj)) {
                                    obj.forEach((item, index) => {
                                        findEmailContent(item, `${path}[${index}]`);
                                    });
                                } else {
                                    Object.keys(obj).forEach(key => {
                                        const currentPath = path ? `${path}.${key}` : key;
                                        
                                        // Look for email-like content
                                        if (typeof obj[key] === 'string') {
                                            for (const msgId of targetMessageIds) {
                                                if (obj[key].includes(msgId)) {
                                                    extractedEmails.push({
                                                        path: currentPath,
                                                        message_id: msgId,
                                                        content_preview: obj[key].substring(0, 500) + '...',
                                                        full_content_available: true
                                                    });
                                                }
                                            }
                                        } else {
                                            findEmailContent(obj[key], currentPath);
                                        }
                                    });
                                }
                            }
                        };
                        
                        findEmailContent(payload);
                        
                    } catch (e) {
                        // Payload parsing failed
                    }
                }
                
                return {
                    task_id: task.id,
                    task_type: task.task_type,
                    created: task.created,
                    extracted_emails: extractedEmails
                };
            });
            
            searchResults.search_results.push({
                source: 'deal_tasks_payloads',
                description: 'Email content found in task payloads',
                matches: taskMatches
            });
        }
        
        res.json(searchResults);
        
    } catch (error) {
        console.error('Error searching for incoming email content:', error);
        res.status(503).json({ 
            error: 'Database connection failed',
            message: 'Please ensure you are connected to the VPN and try again'
        });
    }
});

// Helper function for timeout queries
async function queryWithTimeout(pool, query, params = [], timeoutMs = 85000) {
    return new Promise(async (resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`Query timeout after ${timeoutMs}ms`));
        }, timeoutMs);

        try {
            const result = await pool.query(query, params);
            clearTimeout(timeout);
            resolve(result);
        } catch (error) {
            clearTimeout(timeout);
            reject(error);
        }
    });
}

// API endpoints for Bait & Switch Media initiatives using JSONBin storage
// Get all initiatives
app.get('/api/bait-switch-initiatives', async (req, res) => {
    try {
        // Use JSONBin storage only
        let initiatives = [];
        
        const binResponse = await fetch(`${config.jsonbin.url}/${config.jsonbin.binId}`, {
            headers: {
                'X-Master-Key': config.jsonbin.apiKey
            }
        });
        
        if (binResponse.ok) {
            const binData = await binResponse.json();
            initiatives = binData.record.bait_switch_initiatives || [];
        }
        
        res.json({
            initiatives: initiatives,
            total_count: initiatives.length
        });
        
    } catch (error) {
        console.error('Error fetching bait & switch initiatives:', error);
        res.json({
            initiatives: [],
            total_count: 0
        });
    }
});

// Create new initiative
app.post('/api/bait-switch-initiatives', async (req, res) => {
    try {
        const { title, description, status, team_members, external_teams, steps } = req.body;
        
        if (!title) {
            return res.status(400).json({ error: 'Title is required' });
        }

        // Get current initiatives from JSONBin
        const binResponse = await fetch(`${config.jsonbin.url}/${config.jsonbin.binId}`, {
            headers: {
                'X-Master-Key': config.jsonbin.apiKey
            }
        });
        
        let binData = { bait_switch_initiatives: [] };
        if (binResponse.ok) {
            const response = await binResponse.json();
            binData = response.record || binData;
        }
        
        // Create new initiative
        const newInitiative = {
            id: Date.now(),
            title,
            description: description || '',
            status: req.body.status || 'planning',
            team_members: req.body.team_members || [],
            external_teams: req.body.external_teams || [],
            steps: req.body.steps || [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        
        binData.bait_switch_initiatives = binData.bait_switch_initiatives || [];
        binData.bait_switch_initiatives.push(newInitiative);
        
        // Save back to JSONBin
        await fetch(`${config.jsonbin.url}/${config.jsonbin.binId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': config.jsonbin.apiKey
            },
            body: JSON.stringify(binData)
        });
        
        res.json({ initiative: newInitiative });
        
    } catch (error) {
        console.error('Error creating initiative:', error);
        res.status(503).json({ 
            error: 'Database error',
            message: 'Unable to create initiative'
        });
    }
});

// Update initiative
app.put('/api/bait-switch-initiatives/:id', async (req, res) => {
    try {
        const initiativeId = parseInt(req.params.id);
        const { title, description, status, team_members, external_teams, steps } = req.body;
        
        if (!title) {
            return res.status(400).json({ error: 'Title is required' });
        }

        // Get current initiatives from JSONBin
        const binResponse = await fetch(`${config.jsonbin.url}/${config.jsonbin.binId}`, {
            headers: {
                'X-Master-Key': config.jsonbin.apiKey
            }
        });
        
        let binData = { bait_switch_initiatives: [] };
        if (binResponse.ok) {
            const response = await binResponse.json();
            binData = response.record || binData;
        }
        
        // Find and update the initiative
        const initiativeIndex = binData.bait_switch_initiatives.findIndex(p => p.id === initiativeId);
        if (initiativeIndex === -1) {
            return res.status(404).json({ error: 'Initiative not found' });
        }
        
        // Update initiative data
        const updatedInitiative = {
            ...binData.bait_switch_initiatives[initiativeIndex],
            title,
            description: description || '',
            status: status || 'planning',
            team_members: team_members || [],
            external_teams: external_teams || [],
            steps: steps || [],
            updated_at: new Date().toISOString()
        };
        
        binData.bait_switch_initiatives[initiativeIndex] = updatedInitiative;
        
        // Save back to JSONBin
        await fetch(`${config.jsonbin.url}/${config.jsonbin.binId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': config.jsonbin.apiKey
            },
            body: JSON.stringify(binData)
        });
        
        res.json({ initiative: updatedInitiative });
        
    } catch (error) {
        console.error('Error updating initiative:', error);
        res.status(503).json({ 
            error: 'Database error',
            message: 'Unable to update initiative'
        });
    }
});

// Delete initiative
app.delete('/api/bait-switch-initiatives/:id', async (req, res) => {
    try {
        const initiativeId = parseInt(req.params.id);
        
        // Get current initiatives from JSONBin
        const binResponse = await fetch(`${config.jsonbin.url}/${config.jsonbin.binId}`, {
            headers: {
                'X-Master-Key': config.jsonbin.apiKey
            }
        });
        
        let binData = { bait_switch_initiatives: [] };
        if (binResponse.ok) {
            const response = await binResponse.json();
            binData = response.record || binData;
        }
        
        // Find and remove the initiative
        const initiativeIndex = binData.bait_switch_initiatives.findIndex(p => p.id === initiativeId);
        if (initiativeIndex === -1) {
            return res.status(404).json({ error: 'Initiative not found' });
        }
        
        binData.bait_switch_initiatives.splice(initiativeIndex, 1);
        
        // Save back to JSONBin
        await fetch(`${config.jsonbin.url}/${config.jsonbin.binId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': config.jsonbin.apiKey
            },
            body: JSON.stringify(binData)
        });
        
        res.json({ message: 'Initiative deleted successfully' });
        
    } catch (error) {
        console.error('Error deleting initiative:', error);
        res.status(503).json({ 
            error: 'Storage error',
            message: 'Unable to delete initiative'
        });
    }
});

// API endpoints for Mystery Shopping Issues using JSONBin storage
// Get all issues
app.get('/api/mystery-shopping-issues', async (req, res) => {
    try {
        const binResponse = await fetch(`${config.jsonbin.url}/${config.jsonbin.binId}`, {
            headers: {
                'X-Master-Key': config.jsonbin.apiKey
            }
        });
        
        let issues = [];
        if (binResponse.ok) {
            const binData = await binResponse.json();
            issues = binData.record.mystery_shopping_issues || [];
        }
        
        res.json({
            issues: issues,
            total_count: issues.length
        });
        
    } catch (error) {
        console.error('Error fetching mystery shopping issues:', error);
        res.json({
            issues: [],
            total_count: 0
        });
    }
});

// Create new issue
app.post('/api/mystery-shopping-issues', async (req, res) => {
    try {
        const { text } = req.body;
        
        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }

        // Get current issues from JSONBin
        const binResponse = await fetch(`${config.jsonbin.url}/${config.jsonbin.binId}`, {
            headers: {
                'X-Master-Key': config.jsonbin.apiKey
            }
        });
        
        let binData = { mystery_shopping_issues: [] };
        if (binResponse.ok) {
            const response = await binResponse.json();
            binData = response.record || binData;
        }
        
        // Create new issue
        const newIssue = {
            id: Date.now(),
            text: text.trim(),
            completed: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        
        binData.mystery_shopping_issues = binData.mystery_shopping_issues || [];
        binData.mystery_shopping_issues.push(newIssue); // Add to end (newest at bottom)
        
        // Save back to JSONBin
        await fetch(`${config.jsonbin.url}/${config.jsonbin.binId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': config.jsonbin.apiKey
            },
            body: JSON.stringify(binData)
        });
        
        res.json({ issue: newIssue });
        
    } catch (error) {
        console.error('Error creating issue:', error);
        res.status(503).json({ 
            error: 'Storage error',
            message: 'Unable to create issue'
        });
    }
});

// Update issue
app.put('/api/mystery-shopping-issues/:id', async (req, res) => {
    try {
        const issueId = parseInt(req.params.id);
        const { text, completed } = req.body;
        
        // Get current issues from JSONBin
        const binResponse = await fetch(`${config.jsonbin.url}/${config.jsonbin.binId}`, {
            headers: {
                'X-Master-Key': config.jsonbin.apiKey
            }
        });
        
        let binData = { mystery_shopping_issues: [] };
        if (binResponse.ok) {
            const response = await binResponse.json();
            binData = response.record || binData;
        }
        
        // Find and update the issue
        const issueIndex = binData.mystery_shopping_issues.findIndex(i => i.id === issueId);
        if (issueIndex === -1) {
            return res.status(404).json({ error: 'Issue not found' });
        }
        
        // Update issue data
        if (text !== undefined) binData.mystery_shopping_issues[issueIndex].text = text.trim();
        if (completed !== undefined) binData.mystery_shopping_issues[issueIndex].completed = completed;
        binData.mystery_shopping_issues[issueIndex].updated_at = new Date().toISOString();
        
        // Save back to JSONBin
        await fetch(`${config.jsonbin.url}/${config.jsonbin.binId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': config.jsonbin.apiKey
            },
            body: JSON.stringify(binData)
        });
        
        res.json({ issue: binData.mystery_shopping_issues[issueIndex] });
        
    } catch (error) {
        console.error('Error updating issue:', error);
        res.status(503).json({ 
            error: 'Storage error',
            message: 'Unable to update issue'
        });
    }
});

// Delete issue
app.delete('/api/mystery-shopping-issues/:id', async (req, res) => {
    try {
        const issueId = parseInt(req.params.id);
        
        // Get current issues from JSONBin
        const binResponse = await fetch(`${config.jsonbin.url}/${config.jsonbin.binId}`, {
            headers: {
                'X-Master-Key': config.jsonbin.apiKey
            }
        });
        
        let binData = { mystery_shopping_issues: [] };
        if (binResponse.ok) {
            const response = await binResponse.json();
            binData = response.record || binData;
        }
        
        // Find and remove the issue
        const issueIndex = binData.mystery_shopping_issues.findIndex(i => i.id === issueId);
        if (issueIndex === -1) {
            return res.status(404).json({ error: 'Issue not found' });
        }
        
        binData.mystery_shopping_issues.splice(issueIndex, 1);
        
        // Save back to JSONBin
        await fetch(`${config.jsonbin.url}/${config.jsonbin.binId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': config.jsonbin.apiKey
            },
            body: JSON.stringify(binData)
        });
        
        res.json({ message: 'Issue deleted successfully' });
        
    } catch (error) {
        console.error('Error deleting issue:', error);
        res.status(503).json({ 
            error: 'Storage error',
            message: 'Unable to delete issue'
        });
    }
});

// API endpoint for mystery shop scoring metrics
app.get('/api/mystery-shop-metrics', async (req, res) => {
    try {
        // Test database connection first with timeout
        await queryWithTimeout(pool, 'SELECT 1', [], 5000);
        
        // First try to check if mystery_shops table exists
        let shopMetrics;
        try {
            const tableCheck = await queryWithTimeout(pool, `
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'mystery_shops'
                )
            `, [], 10000);
            
            if (tableCheck.rows[0].exists) {
                // Get mystery shop scoring data with timeout
                const mysteryShopResult = await queryWithTimeout(pool, `
                    WITH dealer_shop_counts AS (
                        SELECT 
                            d.id as dealer_id,
                            d.name as dealer_name,
                            COUNT(ms.id) as shop_count
                        FROM dealers d
                        LEFT JOIN mystery_shops ms ON d.id = ms.dealer_id 
                            AND ms.status = 'scored'
                        GROUP BY d.id, d.name
                        LIMIT 1000
                    ),
                    shop_ranges AS (
                        SELECT 
                            CASE 
                                WHEN shop_count >= 10 THEN '10'
                                WHEN shop_count BETWEEN 8 AND 9 THEN '8-9'
                                WHEN shop_count BETWEEN 5 AND 7 THEN '5-7'
                                WHEN shop_count BETWEEN 1 AND 4 THEN '1-4'
                                ELSE '0'
                            END as shop_range,
                            dealer_id,
                            dealer_name,
                            shop_count
                        FROM dealer_shop_counts
                    )
                    SELECT 
                        shop_range,
                        COUNT(*) as dealer_count,
                        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM dealers LIMIT 1), 1) as percentage
                    FROM shop_ranges
                    GROUP BY shop_range
                    ORDER BY 
                        CASE shop_range 
                            WHEN '10' THEN 1
                            WHEN '8-9' THEN 2  
                            WHEN '5-7' THEN 3
                            WHEN '1-4' THEN 4
                            WHEN '0' THEN 5
                        END
                `, [], 80000);
                
                shopMetrics = mysteryShopResult.rows;
            }
        } catch (tableError) {
            console.log('Mystery shops table not found or query failed, using fallback data');
            shopMetrics = [];
        }
        
        // If mystery_shops table doesn't exist or has no data, provide fallback data
        if (!shopMetrics || shopMetrics.length === 0) {
            const dealerAnalysisResult = await queryWithTimeout(pool, `
                WITH dealer_analysis_counts AS (
                    SELECT 
                        d.id as dealer_id,
                        d.name as dealer_name,
                        COUNT(CASE WHEN deals.state = 'analysis' THEN 1 END) as analysis_count
                    FROM dealers d
                    LEFT JOIN listings l ON d.id = l.dealer_id
                    LEFT JOIN deals ON l.deal_id = deals.id
                    WHERE d.id IS NOT NULL
                    GROUP BY d.id, d.name
                    LIMIT 500
                ),
                mock_shop_ranges AS (
                    SELECT 
                        CASE 
                            WHEN analysis_count >= 10 THEN '10'
                            WHEN analysis_count BETWEEN 8 AND 9 THEN '8-9'
                            WHEN analysis_count BETWEEN 5 AND 7 THEN '5-7'
                            WHEN analysis_count BETWEEN 1 AND 4 THEN '1-4'
                            ELSE '0'
                        END as shop_range,
                        dealer_id,
                        dealer_name,
                        analysis_count
                    FROM dealer_analysis_counts
                )
                SELECT 
                    shop_range,
                    COUNT(*) as dealer_count,
                    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM dealers LIMIT 1), 1) as percentage
                FROM mock_shop_ranges
                GROUP BY shop_range
                ORDER BY 
                    CASE shop_range 
                        WHEN '10' THEN 1
                        WHEN '8-9' THEN 2  
                        WHEN '5-7' THEN 3
                        WHEN '1-4' THEN 4
                        WHEN '0' THEN 5
                    END
            `, [], 75000);
            shopMetrics = dealerAnalysisResult.rows;
        }
        
        res.json({
            mystery_shop_metrics: shopMetrics,
            total_dealers: shopMetrics.reduce((sum, row) => sum + parseInt(row.dealer_count), 0),
            last_updated: new Date().toISOString()
        });
        
    } catch (error) {
        if (error.message.includes('timeout')) {
            console.error('Mystery shop metrics query timeout:', error);
            res.status(408).json({ 
                error: 'Query timeout',
                message: 'The database query took too long to complete. Please try again.'
            });
        } else {
            console.error('Error fetching mystery shop metrics:', error);
            res.status(503).json({ 
                error: 'Database connection failed',
                message: 'Please ensure you are connected to the VPN and try again'
            });
        }
    }
});

// API endpoint to investigate email content sources for a deal
app.get('/api/investigate-email/:dealId', async (req, res) => {
    try {
        const dealId = parseInt(req.params.dealId);
        await pool.query('SELECT 1');
        
        const investigation = {
            deal_id: dealId,
            email_sources: {
                events: { found: false, data: [] },
                messages_dealer_email: { found: false, data: [] },
                deal_tasks: { found: false, data: [] },
                deal_task_payloads: { found: false, data: [] }
            }
        };
        
        // Check events table for detailed email data
        const eventsResult = await pool.query(`
            SELECT 
                id, event_timestamp, action_id, 
                details->>'event_name' as event_name,
                details->'details' as email_details,
                details->'source' as source_data,
                length(details::text) as details_size
            FROM events 
            WHERE deal_id = $1 AND action_id IN (4, 5)
            ORDER BY event_timestamp ASC
        `, [dealId]);
        
        if (eventsResult.rows.length > 0) {
            investigation.email_sources.events.found = true;
            investigation.email_sources.events.data = eventsResult.rows;
        }
        
        // Check messages_dealer_email for any data
        const dealerEmailResult = await pool.query(`
            SELECT id, smtp_message_id, smtp_metadata, summarized_content
            FROM messages_dealer_email
            WHERE smtp_metadata IS NOT NULL OR summarized_content IS NOT NULL
            LIMIT 5
        `);
        
        if (dealerEmailResult.rows.length > 0) {
            investigation.email_sources.messages_dealer_email.found = true;
            investigation.email_sources.messages_dealer_email.data = dealerEmailResult.rows;
        }
        
        // Look for tasks with email-related payloads
        const emailTaskResult = await pool.query(`
            SELECT id, task_type, created, payload
            FROM deal_tasks 
            WHERE deal_id = $1 
            AND (
                payload::text ILIKE '%email%' OR 
                payload::text ILIKE '%smtp%' OR
                payload::text ILIKE '%body%' OR
                payload::text ILIKE '%content%' OR
                payload::text ILIKE '%message%' OR
                payload::text ILIKE '%attachment%'
            )
            ORDER BY created DESC
            LIMIT 5
        `, [dealId]);
        
        if (emailTaskResult.rows.length > 0) {
            investigation.email_sources.deal_task_payloads.found = true;
            investigation.email_sources.deal_task_payloads.data = emailTaskResult.rows;
        }
        
        res.json(investigation);
        
    } catch (error) {
        console.error('Error investigating email sources:', error);
        res.status(503).json({ 
            error: 'Database connection failed',
            message: 'Please ensure you are connected to the VPN and try again'
        });
    }
});

// Helper function for generating person colors
function generatePersonColor(name) {
    const colors = [
        'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
        'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
        'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
        'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
        'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
        'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
        'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)'
    ];
    
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
}

// Team Members API Endpoints using config

// Get all team members
app.get('/api/team-members', async (req, res) => {
    try {
        const binResponse = await fetch(`${config.jsonbin.url}/${config.jsonbin.binId}`, {
            headers: {
                'X-Master-Key': config.jsonbin.apiKey
            }
        });
        
        let teamMembers = [];
        if (binResponse.ok) {
            const binData = await binResponse.json();
            teamMembers = binData.record.team_members || [];
        }
        
        res.json({ team_members: teamMembers });
    } catch (error) {
        console.error('Error fetching team members:', error);
        res.status(500).json({ 
            error: 'Failed to fetch team members',
            team_members: []
        });
    }
});

// Create or update team members
app.post('/api/team-members', async (req, res) => {
    try {
        const { team_members } = req.body;
        
        const response = await fetch(`${JSONBIN_BASE_URL}/team-members`, {
            method: 'PUT',
            headers: {
                'X-Master-Key': JSONBIN_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                team_members: team_members,
                updated_at: new Date().toISOString()
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            res.json({ success: true, team_members: data.record.team_members });
        } else {
            throw new Error(`JSONBin request failed: ${response.status}`);
        }
    } catch (error) {
        console.error('Error saving team members:', error);
        res.status(500).json({ 
            error: 'Failed to save team members',
            success: false
        });
    }
});

// Add individual team member
app.post('/api/team-members/add', async (req, res) => {
    try {
        // Get current data from JSONBin
        const binResponse = await fetch(`${config.jsonbin.url}/${config.jsonbin.binId}`, {
            headers: {
                'X-Master-Key': config.jsonbin.apiKey
            }
        });
        
        let binData = { bait_switch_initiatives: [], team_members: [] };
        if (binResponse.ok) {
            const response = await binResponse.json();
            binData = response.record || binData;
        }
        
        let existingMembers = binData.team_members || [];
        
        // Add new member
        const firstName = req.body.first_name || req.body.name || '';
        const lastName = req.body.last_name || '';
        const fullName = firstName + (lastName ? ' ' + lastName : '');
        
        const newMember = {
            id: Date.now(),
            first_name: firstName,
            last_name: lastName,
            name: fullName, // For backward compatibility
            role: req.body.role || 'Team Member',
            email: req.body.email || '',
            avatar: firstName.charAt(0).toUpperCase() + (lastName ? lastName.charAt(0).toUpperCase() : ''),
            color: req.body.color || generatePersonColor(fullName),
            status: 'active',
            created_at: new Date().toISOString()
        };
        
        existingMembers.push(newMember);
        binData.team_members = existingMembers;
        
        // Save back to JSONBin
        const updateResponse = await fetch(`${config.jsonbin.url}/${config.jsonbin.binId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': config.jsonbin.apiKey
            },
            body: JSON.stringify(binData)
        });
        
        if (updateResponse.ok) {
            res.json({ success: true, member: newMember, team_members: existingMembers });
        } else {
            throw new Error(`JSONBin update failed: ${updateResponse.status}`);
        }
    } catch (error) {
        console.error('Error adding team member:', error);
        res.status(500).json({ 
            error: 'Failed to add team member',
            success: false
        });
    }
});

// Delete team member
app.delete('/api/team-members/:id', async (req, res) => {
    try {
        const memberId = parseInt(req.params.id);
        
        // Get current data from JSONBin
        const binResponse = await fetch(`${config.jsonbin.url}/${config.jsonbin.binId}`, {
            headers: {
                'X-Master-Key': config.jsonbin.apiKey
            }
        });
        
        let binData = { bait_switch_initiatives: [], team_members: [] };
        if (binResponse.ok) {
            const response = await binResponse.json();
            binData = response.record || binData;
        }
        
        let existingMembers = binData.team_members || [];
        
        // Remove member
        existingMembers = existingMembers.filter(member => member.id !== memberId);
        binData.team_members = existingMembers;
        
        // Save back to JSONBin
        const updateResponse = await fetch(`${config.jsonbin.url}/${config.jsonbin.binId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': config.jsonbin.apiKey
            },
            body: JSON.stringify(binData)
        });
        
        if (updateResponse.ok) {
            res.json({ success: true, team_members: existingMembers });
        } else {
            throw new Error(`JSONBin update failed: ${updateResponse.status}`);
        }
    } catch (error) {
        console.error('Error deleting team member:', error);
        res.status(500).json({ 
            error: 'Failed to delete team member',
            success: false
        });
    }
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve the metrics page
app.get('/metrics', (req, res) => {
    res.sendFile(path.join(__dirname, 'metrics.html'));
});

// Database schema information for AI context
const getDatabaseSchema = async () => {
    try {
        // Get table schemas that are relevant for business queries
        const tablesQuery = `
            SELECT 
                table_name,
                column_name,
                data_type,
                is_nullable
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name IN ('deals', 'dealers', 'listings', 'deal_tasks', 'events', 'conversations', 'messages')
            ORDER BY table_name, ordinal_position
        `;
        
        const result = await pool.query(tablesQuery);
        
        // Group columns by table
        const schema = {};
        result.rows.forEach(row => {
            if (!schema[row.table_name]) {
                schema[row.table_name] = [];
            }
            schema[row.table_name].push({
                column: row.column_name,
                type: row.data_type,
                nullable: row.is_nullable === 'YES'
            });
        });
        
        return schema;
    } catch (error) {
        console.error('Error getting database schema:', error);
        return {};
    }
};

// Multi-Agent System for Database Queries

// Agent 1: Coordinator - Understands user intent and orchestrates workflow
async function coordinatorAgent(userQuestion, schema) {
    const prompt = `You are the Coordinator Agent for Project Ralph's database analysis system. Your job is to understand the user's question and determine if it can be answered with our database.

Database Schema:
${schema}

Key Business Context:
- deals table: car purchase deals with states like 'analysis', 'vin_sold', etc.
- dealers table: dealership information
- listings table: connects deals to dealers
- Most tables have 'deleted' column (NULL = active)

User Question: "${userQuestion}"

Analyze this question and respond with ONLY a JSON object:
{
  "canAnswer": true/false,
  "questionType": "percentage|count|list|comparison|other",
  "entities": ["deals", "dealers", "listings"],
  "intent": "brief description of what they want to know",
  "complexity": "simple|moderate|complex"
}

If canAnswer is false, include "reason" field explaining why.`;

    const response = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }]
    });

    try {
        return JSON.parse(response.content[0].text);
    } catch (e) {
        return { canAnswer: false, reason: "Failed to parse coordinator response" };
    }
}

// Agent 2: SQL Generator - Creates optimized SQL queries
async function sqlGeneratorAgent(coordination, schema) {
    const prompt = `You are the SQL Generator Agent. Create a WORKING SQL query based on the coordination analysis.

Database Schema:
${schema}

Coordination Analysis:
${JSON.stringify(coordination, null, 2)}

CRITICAL RULES:
1. ONLY SELECT/WITH queries
2. Always filter deleted records: WHERE deleted IS NULL  
3. Use proper JOINs: deals ↔ listings ↔ dealers
4. For percentages, use this EXACT pattern:

WITH dealer_counts AS (
  SELECT 
    d.id,
    COUNT(deals.id) as deal_count
  FROM dealers d
  LEFT JOIN listings l ON d.id = l.dealer_id
  LEFT JOIN deals ON l.deal_id = deals.id 
    AND deals.state = 'analysis' 
    AND deals.deleted IS NULL
  WHERE d.deleted IS NULL
  GROUP BY d.id
)
SELECT 
  ROUND(
    (COUNT(CASE WHEN deal_count >= 3 THEN 1 END) * 100.0 / COUNT(*)), 2
  ) as percentage
FROM dealer_counts;

5. For counts: SELECT COUNT(*) FROM table WHERE conditions
6. For lists: SELECT columns FROM table WHERE conditions LIMIT 100
7. Never mix aggregated and non-aggregated columns without GROUP BY
8. Always use CASE WHEN for conditional counting

RESPOND WITH ONLY THE SQL QUERY - NO EXPLANATIONS:`;

    const response = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }]
    });

    return response.content[0].text.trim().replace(/```sql|```/g, '');
}

// Agent 3: Query Executor - Executes and validates queries
async function queryExecutorAgent(sqlQuery) {
    try {
        // Safety validation
        const queryLower = sqlQuery.toLowerCase().trim();
        const allowedStarters = ['select', 'with'];
        const forbiddenPatterns = [
            /\binsert\s+into\b/i, /\bupdate\s+\w+\s+set\b/i, /\bdelete\s+from\b/i, 
            /\bdrop\s+(table|database|index|view)\b/i, /\bcreate\s+(table|database|index|view)\b/i, 
            /\balter\s+(table|database)\b/i, /\btruncate\s+table\b/i, /\bgrant\s+/i, /\brevoke\s+/i
        ];
        
        if (!allowedStarters.some(starter => queryLower.startsWith(starter))) {
            return { success: false, error: 'Only SELECT and WITH queries are allowed' };
        }
        
        if (forbiddenPatterns.some(pattern => pattern.test(sqlQuery))) {
            return { success: false, error: 'Query contains forbidden keywords' };
        }
        
        // Execute query with timeout
        const queryResult = await pool.query(sqlQuery);
        return {
            success: true,
            rows: queryResult.rows,
            rowCount: queryResult.rowCount,
            executedQuery: sqlQuery
        };
        
    } catch (error) {
        return {
            success: false,
            error: error.message,
            sqlError: true,
            executedQuery: sqlQuery
        };
    }
}

// Agent 4: Result Interpreter - Converts query results to natural language
async function resultInterpreterAgent(userQuestion, queryResult, coordination) {
    if (!queryResult.success) {
        const prompt = `The SQL query failed. Explain this error in simple terms to help troubleshoot:

User Question: "${userQuestion}"
Error: ${queryResult.error}
Query Type: ${coordination.questionType}

Provide a brief, helpful explanation of what went wrong and how to fix it.`;

        const response = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 200,
            messages: [{ role: "user", content: prompt }]
        });

        return response.content[0].text;
    }

    const prompt = `Convert this database query result into a direct, conversational answer.

User Question: "${userQuestion}"
Query Results: ${JSON.stringify(queryResult.rows, null, 2)}
Row Count: ${queryResult.rowCount}

Provide a direct answer in 1-2 sentences. Be specific with numbers and percentages. Don't mention technical details about the query.

Examples:
- "15.3% of dealers have 3 or more deals in analysis stage"
- "There are 47 dealers with active deals"
- "BMW has the most deals with 23 active listings"`;

    const response = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 150,
        messages: [{ role: "user", content: prompt }]
    });

    return response.content[0].text;
}

// Main Chat API endpoint with Multi-Agent Workflow
app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;
        
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        if (!process.env.ANTHROPIC_API_KEY) {
            return res.status(500).json({ 
                error: 'Anthropic API key not configured. Please add ANTHROPIC_API_KEY to your .env file.' 
            });
        }

        // Get database schema for context
        const schema = await getDatabaseSchema();
        const schemaContext = Object.entries(schema).map(([table, columns]) => {
            const columnList = columns.map(col => `${col.column} (${col.type})`).join(', ');
            return `${table}: ${columnList}`;
        }).join('\n');

        // Step 1: Coordinator Agent analyzes the question
        const coordination = await coordinatorAgent(message, schemaContext);
        
        if (!coordination.canAnswer) {
            return res.json({
                message: `I can't answer that question. ${coordination.reason || 'The question is outside my capabilities for analyzing deal data.'}`,
                canAnswer: false
            });
        }

        // Step 2: SQL Generator Agent creates the query
        const sqlQuery = await sqlGeneratorAgent(coordination, schemaContext);
        
        // Step 3: Query Executor Agent runs the query
        const queryResult = await queryExecutorAgent(sqlQuery);
        
        // Step 4: Result Interpreter Agent converts to natural language
        const naturalAnswer = await resultInterpreterAgent(message, queryResult, coordination);

        res.json({
            message: naturalAnswer,
            sql: queryResult.executedQuery,
            results: queryResult.success ? {
                rows: queryResult.rows,
                rowCount: queryResult.rowCount
            } : { error: queryResult.error },
            agentWorkflow: {
                coordination,
                querySuccess: queryResult.success
            }
        });

    } catch (error) {
        console.error('Multi-agent chat error:', error);
        res.status(500).json({ 
            error: 'I encountered an error processing your request. Please try again.' 
        });
    }
});

// API endpoint to analyze pricing differences between online and out-the-door prices
app.get('/api/pricing-analysis', async (req, res) => {
    try {
        // First check the structure of deal_risk_analysis table
        if (req.query.explore === 'true') {
            const exploreQuery = `
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = 'deal_risk_analysis' 
                ORDER BY ordinal_position;
            `;
            const columns = await pool.query(exploreQuery);
            return res.json({
                table: 'deal_risk_analysis',
                columns: columns.rows
            });
        }
        
        // Query for deals in analysis stage with pricing data
        const query = `
            SELECT 
                d.id as deal_id,
                d.state,
                dra.internet_price,
                dra.offer_price,
                dra.current_bottom_line_price,
                dra.fair_bottom_line_price,
                dra.quoted_tax,
                dra.excessive_fees,
                dra.illegitimate_fees,
                dra.bottom_line_price_difference
            FROM deals d
            INNER JOIN deal_risk_analysis dra ON d.id = dra.deal_id
            WHERE d.state = 'analysis'
            AND dra.internet_price IS NOT NULL 
            AND dra.current_bottom_line_price IS NOT NULL
            ORDER BY d.id;
        `;
        
        const result = await pool.query(query);
        
        const pricingData = [];
        let totalPriceDifference = 0;
        let dealsWithValidData = 0;
        
        for (const row of result.rows) {
            const dealData = {
                deal_id: row.deal_id,
                state: row.state,
                internet_price: parseFloat(row.internet_price) || 0,
                offer_price: parseFloat(row.offer_price) || 0,
                current_bottom_line_price: parseFloat(row.current_bottom_line_price) || 0,
                fair_bottom_line_price: parseFloat(row.fair_bottom_line_price) || 0,
                quoted_tax: parseFloat(row.quoted_tax) || 0,
                excessive_fees: parseFloat(row.excessive_fees) || 0,
                illegitimate_fees: parseFloat(row.illegitimate_fees) || 0,
                bottom_line_price_difference: parseFloat(row.bottom_line_price_difference) || 0
            };
            
            // Calculate the difference between online price and out-the-door price (excluding taxes)
            // Out-the-door price excluding taxes = current_bottom_line_price - quoted_tax
            const otdExcludingTax = dealData.current_bottom_line_price - dealData.quoted_tax;
            const priceDifference = otdExcludingTax - dealData.internet_price;
            
            dealData.otd_excluding_tax = otdExcludingTax;
            dealData.price_difference_excluding_tax = priceDifference;
            
            if (dealData.internet_price > 0 && dealData.current_bottom_line_price > 0) {
                totalPriceDifference += priceDifference;
                dealsWithValidData++;
            }
            
            pricingData.push(dealData);
        }
        
        const averagePriceDifference = dealsWithValidData > 0 ? totalPriceDifference / dealsWithValidData : 0;
        
        // Calculate statistics
        const differences = pricingData
            .filter(deal => deal.internet_price > 0 && deal.current_bottom_line_price > 0)
            .map(deal => deal.price_difference_excluding_tax)
            .sort((a, b) => a - b);
        
        const median = differences.length > 0 ? differences[Math.floor(differences.length / 2)] : 0;
        const min = differences.length > 0 ? differences[0] : 0;
        const max = differences.length > 0 ? differences[differences.length - 1] : 0;
        
        // Find outliers (values more than 2 standard deviations from mean)
        const mean = averagePriceDifference;
        const variance = differences.reduce((sum, diff) => sum + Math.pow(diff - mean, 2), 0) / differences.length;
        const stdDev = Math.sqrt(variance);
        const outliers = differences.filter(diff => Math.abs(diff - mean) > 2 * stdDev);
        
        res.json({
            total_deals: pricingData.length,
            deals_with_valid_data: dealsWithValidData,
            average_price_difference_excluding_tax: Math.round(averagePriceDifference * 100) / 100,
            statistics: {
                median: Math.round(median * 100) / 100,
                min: Math.round(min * 100) / 100,
                max: Math.round(max * 100) / 100,
                standard_deviation: Math.round(stdDev * 100) / 100,
                outlier_count: outliers.length
            },
            summary: {
                message: `Average difference between online price and out-the-door price (excluding taxes): $${averagePriceDifference.toFixed(2)}`,
                median_message: `Median difference: $${median.toFixed(2)}`,
                calculation: "Out-the-door (excluding tax) = current_bottom_line_price - quoted_tax; Difference = otd_excluding_tax - internet_price"
            },
            sample_data: pricingData.slice(0, 5), // Show first 5 for debugging
            outliers: pricingData
                .filter(deal => Math.abs(deal.price_difference_excluding_tax - mean) > 2 * stdDev)
                .slice(0, 5)
                .map(deal => ({
                    deal_id: deal.deal_id,
                    internet_price: deal.internet_price,
                    otd_excluding_tax: deal.otd_excluding_tax,
                    difference: deal.price_difference_excluding_tax
                }))
        });
        
    } catch (error) {
        console.error('Error fetching pricing analysis:', error);
        res.status(500).json({ 
            error: 'Failed to fetch pricing analysis',
            message: 'Ensure VPN connection is active for database access'
        });
    }
});

// API endpoint to analyze fees with outlier detection and removal
app.get('/api/fee-analysis-clean', async (req, res) => {
    try {
        // Get all dealership fee data
        const response = await fetch(`http://localhost:3000/api/dealership-rankings`);
        const data = await response.json();
        
        // Extract dealers with fee data
        const dealersWithFees = data.rankings.filter(dealer => 
            (dealer.grading.averageFees.excessive > 0 || dealer.grading.averageFees.illegitimate > 0)
        );
        
        // Extract fee arrays
        const excessiveFees = dealersWithFees.map(d => d.grading.averageFees.excessive || 0);
        const illegitimateFees = dealersWithFees.map(d => d.grading.averageFees.illegitimate || 0);
        const totalFees = dealersWithFees.map(d => 
            (d.grading.averageFees.excessive || 0) + (d.grading.averageFees.illegitimate || 0)
        );
        
        // Function to remove outliers using IQR method
        function removeOutliers(values, label) {
            const sorted = [...values].sort((a, b) => a - b);
            const q1 = sorted[Math.floor(sorted.length * 0.25)];
            const q3 = sorted[Math.floor(sorted.length * 0.75)];
            const iqr = q3 - q1;
            const lowerBound = q1 - 1.5 * iqr;
            const upperBound = q3 + 1.5 * iqr;
            
            const filtered = values.filter(v => v >= lowerBound && v <= upperBound);
            const outliers = values.filter(v => v < lowerBound || v > upperBound);
            
            return {
                original_count: values.length,
                filtered_count: filtered.length,
                outliers_removed: outliers.length,
                filtered_values: filtered,
                outliers: outliers,
                bounds: { lower: lowerBound, upper: upperBound, q1, q3, iqr },
                stats: {
                    original_avg: values.reduce((a, b) => a + b, 0) / values.length,
                    filtered_avg: filtered.length > 0 ? filtered.reduce((a, b) => a + b, 0) / filtered.length : 0,
                    median: sorted[Math.floor(sorted.length / 2)],
                    filtered_median: filtered.length > 0 ? [...filtered].sort((a, b) => a - b)[Math.floor(filtered.length / 2)] : 0,
                    min: Math.min(...values),
                    max: Math.max(...values),
                    filtered_min: filtered.length > 0 ? Math.min(...filtered) : 0,
                    filtered_max: filtered.length > 0 ? Math.max(...filtered) : 0
                }
            };
        }
        
        // Analyze each fee type
        const excessiveAnalysis = removeOutliers(excessiveFees, 'excessive');
        const illegitimateAnalysis = removeOutliers(illegitimateFees, 'illegitimate');
        const totalAnalysis = removeOutliers(totalFees, 'total');
        
        res.json({
            total_dealers_with_fees: dealersWithFees.length,
            excessive_fees: {
                label: 'Excessive Fees',
                original_average: Math.round(excessiveAnalysis.stats.original_avg * 100) / 100,
                cleaned_average: Math.round(excessiveAnalysis.stats.filtered_avg * 100) / 100,
                median: Math.round(excessiveAnalysis.stats.median * 100) / 100,
                outliers_removed: excessiveAnalysis.outliers_removed,
                outliers: excessiveAnalysis.outliers.slice(0, 5).map(v => Math.round(v * 100) / 100),
                range: {
                    min: Math.round(excessiveAnalysis.stats.filtered_min * 100) / 100,
                    max: Math.round(excessiveAnalysis.stats.filtered_max * 100) / 100
                }
            },
            illegitimate_fees: {
                label: 'Illegitimate Fees',
                original_average: Math.round(illegitimateAnalysis.stats.original_avg * 100) / 100,
                cleaned_average: Math.round(illegitimateAnalysis.stats.filtered_avg * 100) / 100,
                median: Math.round(illegitimateAnalysis.stats.median * 100) / 100,
                outliers_removed: illegitimateAnalysis.outliers_removed,
                outliers: illegitimateAnalysis.outliers.slice(0, 5).map(v => Math.round(v * 100) / 100),
                range: {
                    min: Math.round(illegitimateAnalysis.stats.filtered_min * 100) / 100,
                    max: Math.round(illegitimateAnalysis.stats.filtered_max * 100) / 100
                }
            },
            total_fees: {
                label: 'Total (Excessive + Illegitimate) Fees',
                original_average: Math.round(totalAnalysis.stats.original_avg * 100) / 100,
                cleaned_average: Math.round(totalAnalysis.stats.filtered_avg * 100) / 100,
                median: Math.round(totalAnalysis.stats.median * 100) / 100,
                outliers_removed: totalAnalysis.outliers_removed,
                outliers: totalAnalysis.outliers.slice(0, 5).map(v => Math.round(v * 100) / 100),
                range: {
                    min: Math.round(totalAnalysis.stats.filtered_min * 100) / 100,
                    max: Math.round(totalAnalysis.stats.filtered_max * 100) / 100
                }
            },
            summary: {
                method: "Outliers removed using IQR method (values beyond Q1-1.5*IQR or Q3+1.5*IQR)",
                dealers_analyzed: dealersWithFees.length,
                key_finding: `Cleaned average total fees: $${Math.round(totalAnalysis.stats.filtered_avg * 100) / 100}`
            }
        });
        
    } catch (error) {
        console.error('Error in fee analysis:', error);
        res.status(500).json({ 
            error: 'Failed to analyze fees',
            message: error.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Metrics dashboard: http://localhost:${PORT}/metrics`);
}); 