#!/usr/bin/env node

/**
 * Test script to directly test the PDF worker functionality
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import the worker processor function directly
import { spawn } from 'child_process';

console.log('[TEST] Starting direct worker test...');

async function testWorkerDirectly() {
  const pdfPath = path.join(__dirname, 'pdf', 'extracto1.pdf');
  
  try {
    // Check if PDF exists
    await fs.access(pdfPath);
    console.log(`[TEST] PDF found: ${pdfPath}`);
    
    // Test the Python processor directly
    console.log('[TEST] Testing Python processor...');
    
    const pythonScriptPath = path.join(__dirname, 'unified_pdf_processor.py');
    
    return new Promise((resolve, reject) => {
      const pythonProcess = spawn('python3', [pythonScriptPath, pdfPath, '--debug']);
      
      let stdoutBuffer = '';
      let errorOutput = '';
      
      pythonProcess.stdout.on('data', (data) => {
        const output = data.toString();
        stdoutBuffer += output;
        console.log(`[PYTHON] ${output.trim()}`);
      });
      
      pythonProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
        console.error(`[PYTHON ERROR] ${data}`);
      });
      
      pythonProcess.on('close', (code) => {
        if (code === 0) {
          console.log('[TEST] Python processor completed successfully');
          
          // Extract result
          const resultStartMarker = '___RESULT_START___';
          const resultEndMarker = '___RESULT_END___';
          
          const startIndex = stdoutBuffer.indexOf(resultStartMarker);
          const endIndex = stdoutBuffer.indexOf(resultEndMarker);
          
          if (startIndex !== -1 && endIndex !== -1) {
            const jsonStr = stdoutBuffer.substring(
              startIndex + resultStartMarker.length,
              endIndex
            ).trim();
            
            try {
              const result = JSON.parse(jsonStr);
              console.log(`[TEST] SUCCESS: ${result.transactions?.length || 0} transactions extracted`);
              console.log(`[TEST] Processing time: ${result.processing_time?.toFixed(2) || 0}s`);
              resolve(result);
            } catch (parseErr) {
              console.error(`[TEST] JSON parse error:`, parseErr);
              reject(new Error(`Failed to parse result JSON: ${parseErr.message}`));
            }
          } else {
            console.error('[TEST] No result markers found in output');
            reject(new Error('No valid result found in processor output'));
          }
        } else {
          console.error(`[TEST] Python processor failed with code ${code}`);
          console.error(`[TEST] Error output: ${errorOutput}`);
          reject(new Error(errorOutput || `Processor failed with exit code ${code}`));
        }
      });
      
      pythonProcess.on('error', (err) => {
        console.error(`[TEST] Failed to start Python processor:`, err);
        reject(new Error(`Failed to start processor: ${err.message}`));
      });
    });
    
  } catch (error) {
    console.error('[TEST] Error:', error);
    throw error;
  }
}

// Run the test
testWorkerDirectly()
  .then(result => {
    console.log('[TEST] ✅ Worker test completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('[TEST] ❌ Worker test failed:', error);
    process.exit(1);
  });