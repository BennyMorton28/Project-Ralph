// Temporary script to query fee data for analysis stage deals
const { Pool } = require('pg');
const config = require('./config.js');

const pool = new Pool({
    connectionString: config.database.connectionString
});

async function queryFeeData() {
    try {
        // Query to find deals in analysis stage and check for fee data
        const query = `
            SELECT 
                d.id as deal_id,
                d.state,
                dt.input as task_data
            FROM deals d
            LEFT JOIN deal_tasks dt ON d.id = dt.deal_id 
            WHERE d.state = 'analysis'
            AND dt.input IS NOT NULL
            AND dt.input::text LIKE '%fee%'
            LIMIT 10
        `;
        
        const result = await pool.query(query);
        console.log(`Found ${result.rows.length} deals with potential fee data`);
        
        for (const row of result.rows) {
            console.log(`\nDeal ID: ${row.deal_id}`);
            console.log(`State: ${row.state}`);
            
            try {
                const taskData = JSON.parse(row.task_data);
                // Look for fee-related data in the task
                console.log('Task data keys:', Object.keys(taskData));
                
                // Check for common fee fields
                if (taskData.fees) console.log('Fees found:', taskData.fees);
                if (taskData.excessive_fees) console.log('Excessive fees:', taskData.excessive_fees);
                if (taskData.illegitimate_fees) console.log('Illegitimate fees:', taskData.illegitimate_fees);
                
            } catch (e) {
                console.log('Could not parse task data as JSON');
            }
        }
        
    } catch (error) {
        console.error('Error querying fee data:', error);
    } finally {
        await pool.end();
    }
}

queryFeeData();