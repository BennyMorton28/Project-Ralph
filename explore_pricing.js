// Explore pricing data in the database
const { Pool } = require('pg');
const config = require('./config.js');

const pool = new Pool({
    connectionString: config.database.connectionString
});

async function explorePricingData() {
    try {
        console.log('=== Exploring deals table structure ===');
        
        // Get column names from deals table
        const columnsQuery = `
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'deals' 
            ORDER BY ordinal_position;
        `;
        
        const columns = await pool.query(columnsQuery);
        console.log('Deals table columns:');
        columns.rows.forEach(row => {
            console.log(`  ${row.column_name}: ${row.data_type}`);
        });
        
        console.log('\n=== Looking for price-related fields ===');
        const priceColumns = columns.rows.filter(row => 
            row.column_name.toLowerCase().includes('price') ||
            row.column_name.toLowerCase().includes('cost') ||
            row.column_name.toLowerCase().includes('amount') ||
            row.column_name.toLowerCase().includes('total')
        );
        
        if (priceColumns.length > 0) {
            console.log('Price-related columns found:');
            priceColumns.forEach(row => {
                console.log(`  ${row.column_name}: ${row.data_type}`);
            });
            
            // Sample some data from these columns
            console.log('\n=== Sample pricing data ===');
            const priceFieldNames = priceColumns.map(col => col.column_name).join(', ');
            const sampleQuery = `
                SELECT id, state, ${priceFieldNames}
                FROM deals 
                WHERE state = 'analysis'
                LIMIT 10;
            `;
            
            const sampleData = await pool.query(sampleQuery);
            console.log('Sample deals with pricing data:');
            sampleData.rows.forEach(row => {
                console.log(`Deal ${row.id} (${row.state}):`, JSON.stringify(row, null, 2));
            });
        } else {
            console.log('No obvious price-related columns found in deals table.');
        }
        
        console.log('\n=== Checking deal_tasks for pricing data ===');
        // Check if pricing data is in deal_tasks (JSON payload)
        const taskQuery = `
            SELECT dt.deal_id, dt.task_type, dt.input::text
            FROM deal_tasks dt
            JOIN deals d ON dt.deal_id = d.id
            WHERE d.state = 'analysis'
            AND dt.input::text ILIKE '%price%'
            LIMIT 5;
        `;
        
        const taskData = await pool.query(taskQuery);
        console.log(`Found ${taskData.rows.length} deal tasks with 'price' in the data`);
        taskData.rows.forEach(row => {
            console.log(`Deal ${row.deal_id} - ${row.task_type}:`);
            try {
                const parsed = JSON.parse(row.input);
                const priceFields = Object.keys(parsed).filter(key => 
                    key.toLowerCase().includes('price') ||
                    key.toLowerCase().includes('cost') ||
                    key.toLowerCase().includes('total')
                );
                if (priceFields.length > 0) {
                    console.log('  Price fields found:', priceFields);
                    priceFields.forEach(field => {
                        console.log(`    ${field}: ${parsed[field]}`);
                    });
                }
            } catch (e) {
                console.log('  Could not parse JSON data');
            }
        });
        
    } catch (error) {
        console.error('Error exploring pricing data:', error);
        console.log('Note: This requires VPN connection for database access');
    } finally {
        await pool.end();
    }
}

explorePricingData();