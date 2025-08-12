// Test deal 7 specifically
const fetch = require('node-fetch');

async function testDeal7() {
    try {
        const response = await fetch(`http://localhost:3000/api/deal-grading/7`);
        const data = await response.json();
        
        console.log('Full response:', JSON.stringify(data, null, 2));
        
        if (data.grading) {
            console.log('Has grading data!');
            console.log('State:', data.state);
            console.log('Excessive:', data.grading.excessive?.amount);
            console.log('Illegitimate:', data.grading.illegitimate?.amount);
        } else {
            console.log('No grading data found');
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

testDeal7();