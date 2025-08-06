const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for frontend
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Load configuration
const config = require('./config');

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
            LIMIT 15
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
        
        // Get dealer information
        const dealerResult = await pool.query(`
            SELECT dl.* FROM dealers dl
            JOIN listings l ON l.dealer_id = dl.id
            WHERE l.deal_id = $1
        `, [dealId]);
        
        const dealer = dealerResult.rows[0] || null;
        
        // Get all tasks for the deal
        const tasksResult = await pool.query('SELECT * FROM deal_tasks WHERE deal_id = $1 ORDER BY created DESC', [dealId]);
        const tasks = tasksResult.rows;
        
        // Extract conversation, goals, and risk analysis from task payloads
        let conversation = [];
        let goals = [];
        let riskAnalysis = null;
        let pricing = null;
        
        // Process tasks to extract rich data
        tasks.forEach(task => {
            if (task.payload) {
                try {
                    const payload = typeof task.payload === 'string' ? JSON.parse(task.payload) : task.payload;
                    
                    // Extract conversation from INVOKE_DEAL_ACTION tasks
                    if (task.task_type === 'INVOKE_DEAL_ACTION' && payload.request && payload.request.conversation) {
                        conversation = payload.request.conversation.map(msg => ({
                            role: msg.role,
                            content: msg.content,
                            timestamp: msg.timestamp,
                            message_id: msg.message_id
                        }));
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
                        riskAnalysis = {
                            tax: payload.tax,
                            fees: payload.fees,
                            flags: payload.flags,
                            gauge_value: payload.gauge_value,
                            offer_price: payload.offer_price,
                            status_text: payload.status_text,
                            analysis_text: payload.analysis_text,
                            bottom_line_price: payload.bottom_line_price
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
                ...vehicleInfo
            },
            dealer,
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
                // Sort by weighted fee amounts (lowest fees = best rank)
                // Weighted formula: (Excessive × 0.4) + (Illegitimate × 0.6)
                const aWeightedFees = ((a.grading.averageFees.excessive || 0) * 0.4) + ((a.grading.averageFees.illegitimate || 0) * 0.6);
                const bWeightedFees = ((b.grading.averageFees.excessive || 0) * 0.4) + ((b.grading.averageFees.illegitimate || 0) * 0.6);
                
                // Primary sort: weighted fees (lowest first)
                if (Math.abs(aWeightedFees - bWeightedFees) > 0.01) {
                    return aWeightedFees - bWeightedFees;
                }
                
                // If weighted fees are the same, sort by illegitimate fees (lowest first)
                const aIllegitimate = a.grading.averageFees.illegitimate || 0;
                const bIllegitimate = b.grading.averageFees.illegitimate || 0;
                
                if (Math.abs(aIllegitimate - bIllegitimate) > 0.01) {
                    return aIllegitimate - bIllegitimate;
                }
                
                // If illegitimate fees are the same, sort by excessive fees (lowest first)
                const aExcessive = a.grading.averageFees.excessive || 0;
                const bExcessive = b.grading.averageFees.excessive || 0;
                
                if (Math.abs(aExcessive - bExcessive) > 0.01) {
                    return aExcessive - bExcessive;
                }
                
                // If all fees are the same, sort by grade (highest grade first) as final tiebreaker
                const gradeOrder = { 'A': 5, 'B': 4, 'C': 3, 'D': 2, 'F': 1, 'N/A': 0 };
                const aGrade = gradeOrder[a.grading.grade] || 0;
                const bGrade = gradeOrder[b.grading.grade] || 0;
                
                return bGrade - aGrade;
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

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve the metrics page
app.get('/metrics', (req, res) => {
    res.sendFile(path.join(__dirname, 'metrics.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Metrics dashboard: http://localhost:${PORT}/metrics`);
}); 