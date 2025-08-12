// Grading System for Deal and Dealer Ratings
// Based on Fee Distribution Analysis of analysis-stage deals only

const GRADING_THRESHOLDS = {
    excessive_fees: {
        A: { min: 0, max: 450, label: 'Excellent', color: '#10b981', description: 'Very low excessive fees' },
        B: { min: 450, max: 550, label: 'Good', color: '#3b82f6', description: 'Low excessive fees' },
        C: { min: 550, max: 1248, label: 'Average', color: '#f59e0b', description: 'Typical excessive fees' },
        D: { min: 1248, max: 12767, label: 'Poor', color: '#ef4444', description: 'High excessive fees' },
        F: { min: 12767, max: Infinity, label: 'Failing', color: '#dc2626', description: 'Extremely high excessive fees' }
    },
    illegitimate_fees: {
        A: { min: 0, max: 451.50, label: 'Excellent', color: '#10b981', description: 'Very low illegitimate fees' },
        B: { min: 451.50, max: 1231.25, label: 'Good', color: '#3b82f6', description: 'Low illegitimate fees' },
        C: { min: 1231.25, max: 2674.25, label: 'Average', color: '#f59e0b', description: 'Typical illegitimate fees' },
        D: { min: 2674.25, max: 19039.45, label: 'Poor', color: '#ef4444', description: 'High illegitimate fees' },
        F: { min: 19039.45, max: Infinity, label: 'Failing', color: '#dc2626', description: 'Extremely high illegitimate fees' }
    }
};

// Function to grade a single deal
function gradeDeal(excessiveFees, illegitimateFees) {
    const excessiveGrade = getGrade(excessiveFees, 'excessive_fees');
    const illegitimateGrade = getGrade(illegitimateFees, 'illegitimate_fees');
    
    // Add fee type information to grade objects for scoring
    excessiveGrade.feeType = 'excessive';
    illegitimateGrade.feeType = 'illegitimate';
    
    // Calculate overall grade (weighted average)
    const excessiveScore = getGradeScore(excessiveGrade);
    const illegitimateScore = getGradeScore(illegitimateGrade);
    
    // Weight: 40% excessive, 60% illegitimate (illegitimate fees are more serious)
    const overallScore = (excessiveScore * 0.4) + (illegitimateScore * 0.6);
    const overallGrade = getGradeFromScore(overallScore);
    
    return {
        excessive: excessiveGrade,
        illegitimate: illegitimateGrade,
        overall: overallGrade,
        scores: {
            excessive: excessiveScore,
            illegitimate: illegitimateScore,
            overall: overallScore
        }
    };
}

// Function to get grade for a specific fee amount
function getGrade(amount, feeType) {
    const thresholds = GRADING_THRESHOLDS[feeType];
    
    for (const [grade, criteria] of Object.entries(thresholds)) {
        if (amount >= criteria.min && amount < criteria.max) {
            return {
                grade: grade,
                label: criteria.label,
                color: criteria.color,
                description: criteria.description,
                amount: amount
            };
        }
    }
    
    return {
        grade: 'F',
        label: 'Failing',
        color: '#dc2626',
        description: 'Extremely high fees',
        amount: amount
    };
}

// Convert grade to numerical score based on actual fee amounts
function getGradeScore(gradeInfo) {
    // Calculate score based on actual fee amount relative to thresholds
    const amount = gradeInfo.amount;
    const feeType = gradeInfo.feeType; // 'excessive' or 'illegitimate'
    
    if (amount === 0) return 100; // Perfect score for $0 fees
    
    // Use more reasonable thresholds based on actual data ranges
    // For excessive fees: use $1000 as the "high" threshold (instead of $12,767)
    // For illegitimate fees: use $2000 as the "high" threshold (instead of $19,039)
    const maxThreshold = feeType === 'excessive' ? 1000 : 2000;
    
    // Calculate score: 100 - (amount / max_threshold * 100)
    // This gives 100 for $0 fees and decreases as fees increase
    const score = Math.max(0, 100 - (amount / maxThreshold * 100));
    
    return Math.round(score);
}

// Convert numerical score back to grade
function getGradeFromScore(score) {
    if (score >= 90) return { grade: 'A', label: 'Excellent', color: '#10b981' };
    if (score >= 80) return { grade: 'B', label: 'Good', color: '#3b82f6' };
    if (score >= 70) return { grade: 'C', label: 'Average', color: '#f59e0b' };
    if (score >= 60) return { grade: 'D', label: 'Poor', color: '#ef4444' };
    return { grade: 'F', label: 'Failing', color: '#dc2626' };
}

// Function to grade a dealer based on multiple deals
function gradeDealer(deals) {
    if (!deals || deals.length === 0) {
        return {
            grade: 'N/A',
            label: 'No Data',
            color: '#64748b',
            dealCount: 0,
            averageScores: { excessive: 0, illegitimate: 0, overall: 0 },
            explanation: 'No analysis-stage deals available for grading'
        };
    }
    
    const dealGrades = deals.map(deal => gradeDeal(deal.excessive_fees, deal.illegitimate_fees));
    
    const avgExcessiveScore = dealGrades.reduce((sum, d) => sum + d.scores.excessive, 0) / dealGrades.length;
    const avgIllegitimateScore = dealGrades.reduce((sum, d) => sum + d.scores.illegitimate, 0) / dealGrades.length;
    const avgOverallScore = dealGrades.reduce((sum, d) => sum + d.scores.overall, 0) / dealGrades.length;
    
    const overallGrade = getGradeFromScore(avgOverallScore);
    
    // Calculate grade distribution
    const gradeDistribution = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    dealGrades.forEach(d => {
        gradeDistribution[d.overall.grade]++;
    });
    
    // Calculate average fee amounts for hover display
    const avgExcessiveFees = deals.reduce((sum, d) => sum + d.excessive_fees, 0) / deals.length;
    const avgIllegitimateFees = deals.reduce((sum, d) => sum + d.illegitimate_fees, 0) / deals.length;
    
    return {
        grade: overallGrade.grade,
        label: overallGrade.label,
        color: overallGrade.color,
        dealCount: deals.length,
        averageScores: {
            excessive: avgExcessiveScore,
            illegitimate: avgIllegitimateScore,
            overall: avgOverallScore
        },
        averageFees: {
            excessive: avgExcessiveFees,
            illegitimate: avgIllegitimateFees
        },
        dealGrades: dealGrades,
        gradeDistribution: gradeDistribution,
        explanation: generateDealerExplanation(overallGrade, deals.length, avgOverallScore, gradeDistribution)
    };
}

// Generate explanation for dealer grade
function generateDealerExplanation(grade, dealCount, avgScore, distribution) {
    const totalDeals = Object.values(distribution).reduce((sum, count) => sum + count, 0);
    const topGrades = distribution.A + distribution.B;
    const topGradePercentage = totalDeals > 0 ? Math.round((topGrades / totalDeals) * 100) : 0;
    
    return `Based on ${dealCount} analysis-stage deals with an average score of ${avgScore.toFixed(1)}/100. 
    ${topGradePercentage}% of deals received A or B grades. 
    Grade distribution: A(${distribution.A}), B(${distribution.B}), C(${distribution.C}), D(${distribution.D}), F(${distribution.F}).`;
}

// Get grading system explanation
function getGradingExplanation() {
    return {
        overview: "This grading system is based on analysis of deals currently in the 'analysis' state that have fee data available.",
        excessive_fees: {
            description: "Fees that are higher than typical market rates but may be legitimate",
            thresholds: GRADING_THRESHOLDS.excessive_fees,
            weight: "40% of overall grade"
        },
        illegitimate_fees: {
            description: "Fees that are unnecessary, deceptive, or potentially illegal",
            thresholds: GRADING_THRESHOLDS.illegitimate_fees,
            weight: "60% of overall grade (weighted higher due to severity)"
        },
        calculation: "Overall grade is calculated as a weighted average: (Excessive Score × 0.4) + (Illegitimate Score × 0.6)",
        scoring: "Grades are converted to scores: A=95, B=85, C=75, D=65, F=55"
    };
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        gradeDeal,
        gradeDealer,
        getGrade,
        getGradingExplanation,
        GRADING_THRESHOLDS
    };
} 