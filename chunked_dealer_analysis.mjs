// chunked_dealer_analysis.mjs
// Real dealer analysis using chunked MCP evaluation to avoid token limits

export async function evaluateTextChunks(url, options = {}) {
  const {
    maxCharsPerChunk = 6000,
    maxChunks = 15,
    totalCharBudget = 80000,
    applyFilter = true
  } = options;

  console.log(`Starting chunked evaluation for: ${url}`);
  
  const chunks = [];
  let start = 0;
  let usedBudget = 0;

  for (let i = 0; i < maxChunks; i++) {
    const end = start + maxCharsPerChunk;
    
    console.log(`Extracting chunk ${i}: chars ${start}-${end}`);

    // JavaScript code that returns only a small slice to avoid token limits
    const jsCode = `
      (() => {
        try {
          const fullText = document.body?.innerText || '';
          const totalLength = fullText.length;
          const slice = fullText.slice(${start}, ${end});
          
          return JSON.stringify({
            ok: true,
            slice: slice,
            totalLength: totalLength,
            start: ${start},
            end: ${end}
          });
        } catch (e) {
          return JSON.stringify({ ok: false, error: e.message });
        }
      })()
    `;

    try {
      // Use the actual MCP browser_evaluate tool
      const response = await globalThis.mcp__playwright__browser_evaluate({
        function: jsCode
      });

      // Parse the response
      let parsed;
      try {
        const rawResult = typeof response === 'string' ? response : 
                         (response?.content || response?.result || JSON.stringify(response));
        parsed = JSON.parse(rawResult);
      } catch (parseError) {
        console.error(`Failed to parse chunk ${i} response:`, parseError);
        break;
      }

      if (!parsed?.ok) {
        console.error(`Chunk ${i} error:`, parsed?.error);
        break;
      }

      let slice = parsed.slice || '';
      
      // Apply filtering to reduce noise and focus on fee-related content
      if (applyFilter && slice) {
        const lines = slice.split('\n')
          .map(l => l.trim())
          .filter(l => l.length > 0)
          .filter(l => {
            // Keep lines that might contain fee information
            return /fee|price|cost|charge|\$|documentation|dealer|financing|tax|title|registration/i.test(l);
          });
        
        const filtered = lines.join('\n');
        if (filtered.length > 20) { // Only use filtered if it has substantial content
          slice = filtered;
        }
      }

      // Enforce overall budget
      if (totalCharBudget && usedBudget + slice.length > totalCharBudget) {
        const remaining = totalCharBudget - usedBudget;
        if (remaining > 0) {
          chunks.push({
            index: i,
            text: slice.slice(0, remaining),
            start: parsed.start,
            end: parsed.end,
            truncated: true
          });
        }
        break;
      } else {
        if (slice.length > 0) {
          chunks.push({
            index: i,
            text: slice,
            start: parsed.start,
            end: parsed.end,
            truncated: false
          });
        }
      }

      usedBudget += slice.length;
      console.log(`Chunk ${i}: ${slice.length} chars, budget used: ${usedBudget}/${totalCharBudget}`);

      // Stop if we reached the end
      if (parsed.end >= parsed.totalLength || slice.length === 0) {
        console.log(`Reached end of content at chunk ${i}`);
        break;
      }
      
      start += maxCharsPerChunk;

    } catch (error) {
      console.error(`Error extracting chunk ${i}:`, error.message);
      break;
    }
  }

  return {
    url,
    createdAt: new Date().toISOString(),
    totalChunks: chunks.length,
    chunks,
    usedBudget
  };
}

export function analyzeFeeContent(chunks) {
  console.log('\nAnalyzing chunks for fee information...');
  
  const feeFindings = {
    feesFound: false,
    feeLocation: 'Not Found',
    feeDetails: [],
    screenshots: [],
    analysis: 'No fee information detected'
  };

  let allText = chunks.map(c => c.text).join('\n');
  
  // Look for common fee patterns
  const feePatterns = [
    /\$\d+.*(?:fee|charge)/gi,
    /(?:dealer|doc|documentation|processing|service)\s*fee/gi,
    /\$\d+.*(?:dealer|doc|documentation)/gi,
    /fee.*\$\d+/gi,
    /charge.*\$\d+/gi
  ];

  const foundFees = [];
  for (const pattern of feePatterns) {
    const matches = allText.match(pattern);
    if (matches) {
      foundFees.push(...matches);
    }
  }

  if (foundFees.length > 0) {
    feeFindings.feesFound = true;
    feeFindings.feeLocation = 'Found in page content';
    feeFindings.feeDetails = [...new Set(foundFees)]; // Remove duplicates
    feeFindings.analysis = `Found ${foundFees.length} fee-related mentions`;
  } else {
    // Check for disclaimer or fine print sections
    const disclaimerKeywords = /disclaimer|fine print|terms|conditions|additional.*fee/gi;
    if (disclaimerKeywords.test(allText)) {
      feeFindings.feeLocation = 'May be in disclaimer/terms section';
      feeFindings.analysis = 'Potential fee information in terms/disclaimer';
    }
  }

  return feeFindings;
}

// Export the functions for use in the main analysis
export default { evaluateTextChunks, analyzeFeeContent };