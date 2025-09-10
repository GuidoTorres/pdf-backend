#!/usr/bin/env node

/**
 * Script to start the complete system
 * This ensures all components are running correctly
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 Starting PDF Processing System...');

// Start the main application and worker
const processes = [];

// 1. Start the main Express server
console.log('📡 Starting Express server...');
const serverProcess = spawn('node', ['src/app.js'], {
  cwd: __dirname,
  stdio: 'inherit'
});
processes.push(serverProcess);

// 2. Start the PDF processing worker
console.log('⚙️  Starting PDF processing worker...');
const workerProcess = spawn('node', ['src/workers/pdfProcessor.js'], {
  cwd: __dirname,
  stdio: 'inherit'
});
processes.push(workerProcess);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down system...');
  
  processes.forEach((proc, index) => {
    console.log(`Stopping process ${index + 1}...`);
    proc.kill('SIGTERM');
  });
  
  setTimeout(() => {
    console.log('✅ System shutdown complete');
    process.exit(0);
  }, 2000);
});

// Handle process errors
processes.forEach((proc, index) => {
  proc.on('error', (error) => {
    console.error(`❌ Process ${index + 1} error:`, error);
  });
  
  proc.on('exit', (code, signal) => {
    if (code !== 0) {
      console.error(`❌ Process ${index + 1} exited with code ${code} (signal: ${signal})`);
    }
  });
});

console.log('✅ System started successfully!');
console.log('📝 Logs will appear below...');
console.log('🔄 Press Ctrl+C to stop the system');
console.log('─'.repeat(50));