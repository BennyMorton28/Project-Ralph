// test_chunked_extraction.mjs
// Test script to demonstrate chunked car extraction using available MCP tools
// This integrates with Claude Code's existing MCP Playwright tools

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple chunked text extraction that works with small responses
async function extractTextChunksSimple(url) {
  const chunks = [];
  const maxCharsPerChunk = 8000;
  const maxChunks = 10;
  
  for (let i = 0; i < maxChunks; i++) {
    const start = i * maxCharsPerChunk;
    const end = start + maxCharsPerChunk;
    
    // Use a simple approach that returns just a slice
    const code = `
      (() => {
        try {
          const fullText = document.body?.innerText || '';
          const slice = fullText.slice(${start}, ${end});
          const totalLen = fullText.length;
          return JSON.stringify({ 
            ok: true, 
            slice: slice,
            totalLen: totalLen,
            start: ${start},
            end: ${end}
          });
        } catch (e) {
          return JSON.stringify({ ok: false, error: String(e) });
        }
      })()
    `;
    
    console.log(`Chunk ${i}: chars ${start}-${end}`);
    
    // This would need to be replaced with actual MCP browser_evaluate call
    // For testing, we'll simulate the response
    const mockResult = {
      ok: true,
      slice: `Mock chunk ${i} for URL ${url}`,
      totalLen: maxCharsPerChunk * 5, // simulate 5 chunks total
      start,
      end
    };
    
    if (!mockResult.ok) {
      console.error('Error in chunk extraction:', mockResult.error);
      break;
    }
    
    if (mockResult.slice && mockResult.slice.length > 0) {
      chunks.push({
        index: i,
        text: mockResult.slice,
        start: mockResult.start,
        end: mockResult.end
      });
    }
    
    // Stop if we've reached the end
    if (mockResult.end >= mockResult.totalLen) {
      break;
    }
  }
  
  return {
    url,
    totalChunks: chunks.length,
    chunks
  };
}

// Simple regex extraction for car data
function extractCarData(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const cars = [];
  
  const priceRe = /\$\s?(\d{1,3}(?:[,\d]{3})+)/;
  const yearRe = /\b(19|20)\d{2}\b/;
  const mileageRe = /\b(\d{1,3}(?:[,\d]{3}))\s*(?:mi|miles)\b/i;
  
  for (const line of lines) {
    const priceMatch = line.match(priceRe);
    const yearMatch = line.match(yearRe);
    
    if (priceMatch || yearMatch) {
      const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
      const year = yearMatch ? parseInt(yearMatch[0]) : null;
      const mileageMatch = line.match(mileageRe);
      const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null;
      
      cars.push({
        year,
        price,
        mileage,
        raw: line
      });
    }
  }
  
  return cars;
}

async function main() {
  const url = process.argv[2] || "https://www.bramanmotorsbmw.com/used-vehicles/";
  
  console.log(`Testing chunked extraction for: ${url}`);
  
  try {
    const payload = await extractTextChunksSimple(url);
    
    console.log(`Extracted ${payload.totalChunks} chunks`);
    
    const allCars = [];
    for (const chunk of payload.chunks) {
      console.log(`Processing chunk ${chunk.index}`);
      const cars = extractCarData(chunk.text);
      allCars.push(...cars);
    }
    
    console.log(`Found ${allCars.length} potential car listings`);
    
    // Write results
    const resultPath = path.join(__dirname, 'test_extraction_results.json');
    const result = {
      url: payload.url,
      totalChunks: payload.totalChunks,
      carsFound: allCars.length,
      cars: allCars,
      timestamp: new Date().toISOString()
    };
    
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    console.log(`Results written to: ${resultPath}`);
    
    // Output summary
    console.log(JSON.stringify({
      url: payload.url,
      totalChunks: payload.totalChunks,
      extractedCount: allCars.length,
      testFile: resultPath
    }));
    
  } catch (error) {
    console.error('Error during extraction:', error);
    process.exit(1);
  }
}

// Always run main when this file is executed directly
main().catch(err => {
  console.error('Main error:', err);
  process.exit(1);
});