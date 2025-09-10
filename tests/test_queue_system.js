#!/usr/bin/env node

/**
 * Test script to verify the queue system is working
 */

import { pdfProcessingQueue } from './src/config/queue.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('[QUEUE-TEST] Starting queue system test...');

async function testQueueSystem() {
  try {
    // Test 1: Add a job to the queue
    console.log('[QUEUE-TEST] Adding test job to queue...');
    
    const testPdfPath = path.join(__dirname, 'pdf', 'estado_unlocked.pdf');
    
    // Verify PDF exists
    await fs.access(testPdfPath);
    console.log(`[QUEUE-TEST] Test PDF found: ${testPdfPath}`);
    
    // Add job to queue
    const job = await pdfProcessingQueue.add('process-pdf', {
      tempFilePath: testPdfPath,
      originalName: 'test-estado_unlocked.pdf',
      userId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', // Use the test user UUID
    });
    
    console.log(`[QUEUE-TEST] Job added with ID: ${job.id}`);
    
    // Test 2: Monitor job status
    console.log('[QUEUE-TEST] Monitoring job status...');
    
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds timeout
    
    while (attempts < maxAttempts) {
      const jobStatus = await job.getState();
      const progress = job.progress;
      
      console.log(`[QUEUE-TEST] Attempt ${attempts + 1}: Job status = ${jobStatus}, Progress = ${progress}`);
      
      if (jobStatus === 'completed') {
        console.log('[QUEUE-TEST] ✅ Job completed successfully!');
        console.log('[QUEUE-TEST] Result:', job.returnvalue);
        return true;
      } else if (jobStatus === 'failed') {
        console.error('[QUEUE-TEST] ❌ Job failed:', job.failedReason);
        return false;
      }
      
      // Wait 1 second before checking again
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    
    console.error('[QUEUE-TEST] ❌ Job timed out after 30 seconds');
    return false;
    
  } catch (error) {
    console.error('[QUEUE-TEST] ❌ Error:', error);
    return false;
  }
}

// Run the test
testQueueSystem()
  .then(success => {
    if (success) {
      console.log('[QUEUE-TEST] ✅ Queue system test PASSED');
      process.exit(0);
    } else {
      console.log('[QUEUE-TEST] ❌ Queue system test FAILED');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('[QUEUE-TEST] ❌ Unexpected error:', error);
    process.exit(1);
  });