// Script to find all deals with fee data and calculate averages
const fetch = require('node-fetch');

async function calculateFeeAverages() {
    const dealsWithFees = [];
    const maxDealId = 100; // Check first 100 deals for faster testing
    
    console.log('Searching for deals with fee data...');
    
    for (let i = 1; i <= maxDealId; i++) {
        if (i % 100 === 0) {
            console.log(`Checked ${i} deals so far, found ${dealsWithFees.length} with fee data`);
        }
        
        try {
            const response = await fetch(`http://localhost:3000/api/deal-grading/${i}`);
            const data = await response.json();
            
            if (data.grading) {
                const excessive = data.grading.excessive?.amount || 0;
                const illegitimate = data.grading.illegitimate?.amount || 0;
                const total = excessive + illegitimate;
                
                dealsWithFees.push({
                    dealId: i,
                    excessive: excessive,
                    illegitimate: illegitimate,
                    total: total,
                    state: data.state
                });
                
                console.log(`Deal ${i} (${data.state}): Excessive=$${excessive}, Illegitimate=$${illegitimate}, Total=$${total}`);
            }
        } catch (error) {
            // Skip errors and continue
        }
    }
    
    console.log(`\n=== RESULTS ===`);
    console.log(`Found ${dealsWithFees.length} deals with fee data`);
    
    // Separate analysis stage deals
    const analysisDeals = dealsWithFees.filter(deal => deal.state === 'analysis');
    console.log(`Of those, ${analysisDeals.length} are in analysis stage`);
    
    if (analysisDeals.length === 0) {
        console.log('No deals found with fee data in analysis stage');
        if (dealsWithFees.length > 0) {
            console.log('But found fee data in other states. Showing all deals with fees:');
            // Calculate averages for all deals with fees
            const totalExcessive = dealsWithFees.reduce((sum, deal) => sum + deal.excessive, 0);
            const totalIllegitimate = dealsWithFees.reduce((sum, deal) => sum + deal.illegitimate, 0);
            const totalCombined = dealsWithFees.reduce((sum, deal) => sum + deal.total, 0);
            
            const avgExcessive = totalExcessive / dealsWithFees.length;
            const avgIllegitimate = totalIllegitimate / dealsWithFees.length;
            const avgTotal = totalCombined / dealsWithFees.length;
            
            console.log(`\nAll Deals with Fee Data (${dealsWithFees.length} deals):`);
            console.log(`Average Excessive Fees: $${avgExcessive.toFixed(2)}`);
            console.log(`Average Illegitimate Fees: $${avgIllegitimate.toFixed(2)}`);
            console.log(`Average Total (Excessive + Illegitimate): $${avgTotal.toFixed(2)}`);
        }
        return;
    }
    
    // Calculate averages for analysis stage deals
    const totalExcessive = analysisDeals.reduce((sum, deal) => sum + deal.excessive, 0);
    const totalIllegitimate = analysisDeals.reduce((sum, deal) => sum + deal.illegitimate, 0);
    const totalCombined = analysisDeals.reduce((sum, deal) => sum + deal.total, 0);
    
    const avgExcessive = totalExcessive / analysisDeals.length;
    const avgIllegitimate = totalIllegitimate / analysisDeals.length;
    const avgTotal = totalCombined / analysisDeals.length;
    
    console.log(`\nAverage Excessive Fees: $${avgExcessive.toFixed(2)}`);
    console.log(`Average Illegitimate Fees: $${avgIllegitimate.toFixed(2)}`);
    console.log(`Average Total (Excessive + Illegitimate): $${avgTotal.toFixed(2)}`);
    
    // Show some stats
    console.log(`\nFee Distribution:`);
    dealsWithFees.sort((a, b) => b.total - a.total);
    console.log(`Highest Total: $${dealsWithFees[0].total} (Deal ${dealsWithFees[0].dealId})`);
    console.log(`Lowest Total: $${dealsWithFees[dealsWithFees.length - 1].total} (Deal ${dealsWithFees[dealsWithFees.length - 1].dealId})`);
    
    const median = dealsWithFees[Math.floor(dealsWithFees.length / 2)].total;
    console.log(`Median Total: $${median}`);
}

calculateFeeAverages().catch(console.error);