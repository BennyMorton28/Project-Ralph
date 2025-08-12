const config = require('./config');
const { Pool } = require('pg');

const pool = new Pool(config.database);

async function testDeal3581() {
    try {
        const dealId = 3581;
        
        // Get basic deal info
        const dealResult = await pool.query('SELECT * FROM deals WHERE id = $1', [dealId]);
        const deal = dealResult.rows[0];
        console.log('Deal state:', deal.state);
        
        // Get tasks
        const tasksResult = await pool.query('SELECT * FROM deal_tasks WHERE deal_id = $1 ORDER BY created DESC', [dealId]);
        console.log('Total tasks:', tasksResult.rows.length);
        
        // Check for RISK_ASSESSMENT_UPDATE tasks
        const riskTasks = tasksResult.rows.filter(t => t.task_type === 'RISK_ASSESSMENT_UPDATE');
        console.log('RISK_ASSESSMENT_UPDATE tasks:', riskTasks.length);
        
        // Check for INVOKE_DEAL_ACTION tasks with deal_risk_summary
        const invokeActionTasks = tasksResult.rows.filter(t => 
            t.task_type === 'INVOKE_DEAL_ACTION' && 
            t.meta && 
            t.meta.deal_risk_summary
        );
        console.log('INVOKE_DEAL_ACTION tasks with risk summary:', invokeActionTasks.length);
        
        if (invokeActionTasks.length > 0) {
            const task = invokeActionTasks[0];
            const riskSummary = task.meta.deal_risk_summary;
            console.log('Risk summary offer_price:', riskSummary.offer_price);
            console.log('Risk summary tax:', riskSummary.tax);
            console.log('Risk summary bottom_line_price:', riskSummary.bottom_line_price);
            
            // Check if conversation data exists
            if (task.meta.request && task.meta.request.conversation) {
                console.log('Conversation messages:', task.meta.request.conversation.length);
                
                // Extract pricing from conversation
                for (const msg of task.meta.request.conversation) {
                    if (msg && msg.content && msg.content.includes('Adjusted Price:')) {
                        console.log('Found Adjusted Price message:', msg.content);
                        const match = msg.content.match(/Adjusted Price:\s*([\d,]+\.?\d*)/);
                        if (match) {
                            console.log('Extracted offer price:', parseFloat(match[1].replace(/,/g, '')));
                        }
                    }
                    if (msg && msg.content && msg.content.includes('Balance:')) {
                        const match = msg.content.match(/Balance:\s*([\d,]+\.?\d*)/);
                        if (match) {
                            console.log('Extracted balance:', parseFloat(match[1].replace(/,/g, '')));
                        }
                    }
                    if (msg && msg.content && msg.content.includes('Tax:')) {
                        const match = msg.content.match(/Tax:\s*([\d,]+\.?\d*)/);
                        if (match) {
                            console.log('Extracted tax:', parseFloat(match[1].replace(/,/g, '')));
                        }
                    }
                }
            }
        }
        
        // Get ad_info for Internet Price
        const adInfoResult = await pool.query(`
            SELECT ai.* FROM ad_info ai
            JOIN listings l ON l.ad_info_id = ai.id
            WHERE l.deal_id = $1
        `, [dealId]);
        
        if (adInfoResult.rows.length > 0) {
            console.log('Ad info price (Internet Price):', adInfoResult.rows[0].price);
        }
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await pool.end();
    }
}

testDeal3581();