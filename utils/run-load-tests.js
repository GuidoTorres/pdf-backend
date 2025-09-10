#!/usr/bin/env node

/**
 * Load Test Runner Script
 * 
 * This script runs comprehensive load and performance tests for the scalable PDF processing system.
 * It includes tests for concurrent processing, priority queues, auto-scaling, and memory management.
 */

import { spawn } from 'child_process';
import { performance } from 'perf_hooks';
import fs from 'fs/promises';
import path from 'path';

const LOAD_TEST_CONFIG = {
  // Test categories to run
  categories: [
    'concurrent-processing',
    'priority-queue', 
    'auto-scaling',
    'memory-management',
    'load-test-runner' // Integration tests
  ],
  
  // Test execution options
  options: {
    timeout: 300000, // 5 minutes per test file
    verbose: true,
    bail: false, // Continue even if some tests fail
    reporter: 'verbose'
  },
  
  // Performance thresholds
  thresholds: {
    maxDuration: 600000, // 10 minutes total
    minSuccessRate: 80,  // 80% tests must pass
    maxMemoryUsage: 4096 // 4GB max memory usage
  }
};

class LoadTestRunner {
  constructor() {
    this.results = {
      startTime: null,
      endTime: null,
      totalDuration: 0,
      categories: {},
      summary: {
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        skippedTests: 0,
        successRate: 0
      }
    };
  }

  async run() {
    console.log('🚀 Starting Scalable PDF Processing Load Tests');
    console.log('=' .repeat(80));
    console.log(`Test Categories: ${LOAD_TEST_CONFIG.categories.length}`);
    console.log(`Max Duration: ${LOAD_TEST_CONFIG.thresholds.maxDuration / 1000}s`);
    console.log(`Success Threshold: ${LOAD_TEST_CONFIG.thresholds.minSuccessRate}%`);
    console.log('=' .repeat(80));

    this.results.startTime = performance.now();

    try {
      // Check prerequisites
      await this.checkPrerequisites();
      
      // Run load tests by category
      for (const category of LOAD_TEST_CONFIG.categories) {
        await this.runTestCategory(category);
      }
      
      // Generate final report
      await this.generateReport();
      
    } catch (error) {
      console.error('❌ Load test execution failed:', error.message);
      process.exit(1);
    } finally {
      this.results.endTime = performance.now();
      this.results.totalDuration = this.results.endTime - this.results.startTime;
    }
  }

  async checkPrerequisites() {
    console.log('\n🔍 Checking Prerequisites...');
    
    // Check if test files exist
    const testDir = path.join(process.cwd(), 'test', 'load');
    
    try {
      await fs.access(testDir);
      console.log('✅ Load test directory found');
    } catch (error) {
      throw new Error('Load test directory not found. Please ensure test/load/ exists.');
    }

    // Check for required test files
    for (const category of LOAD_TEST_CONFIG.categories) {
      const testFile = path.join(testDir, `${category}.test.js`);
      try {
        await fs.access(testFile);
        console.log(`✅ ${category} test file found`);
      } catch (error) {
        console.warn(`⚠️  ${category} test file not found, skipping...`);
      }
    }

    // Check system resources
    const memoryUsage = process.memoryUsage();
    const availableMemory = memoryUsage.heapTotal;
    
    console.log(`📊 System Check:`);
    console.log(`  - Node.js Version: ${process.version}`);
    console.log(`  - Available Memory: ${(availableMemory / 1024 / 1024).toFixed(2)}MB`);
    console.log(`  - Platform: ${process.platform}`);
    console.log(`  - CPU Architecture: ${process.arch}`);
  }

  async runTestCategory(category) {
    console.log(`\n🧪 Running ${category} tests...`);
    console.log('-' .repeat(60));
    
    const categoryStartTime = performance.now();
    const testFile = path.join('test', 'load', `${category}.test.js`);
    
    try {
      // Check if test file exists
      await fs.access(testFile);
    } catch (error) {
      console.log(`⏭️  Skipping ${category} - test file not found`);
      this.results.categories[category] = {
        status: 'skipped',
        reason: 'Test file not found'
      };
      return;
    }

    const testResult = await this.executeVitest(testFile);
    const categoryDuration = performance.now() - categoryStartTime;
    
    this.results.categories[category] = {
      status: testResult.success ? 'passed' : 'failed',
      duration: categoryDuration,
      tests: testResult.tests,
      output: testResult.output,
      errors: testResult.errors
    };

    // Update summary
    this.results.summary.totalTests += testResult.tests.total || 0;
    this.results.summary.passedTests += testResult.tests.passed || 0;
    this.results.summary.failedTests += testResult.tests.failed || 0;
    this.results.summary.skippedTests += testResult.tests.skipped || 0;

    const statusIcon = testResult.success ? '✅' : '❌';
    console.log(`${statusIcon} ${category} completed in ${(categoryDuration / 1000).toFixed(2)}s`);
    
    if (testResult.tests.total > 0) {
      console.log(`   Tests: ${testResult.tests.passed}/${testResult.tests.total} passed`);
    }
    
    if (!testResult.success && testResult.errors.length > 0) {
      console.log(`   Errors: ${testResult.errors.length}`);
      testResult.errors.slice(0, 3).forEach(error => {
        console.log(`   - ${error}`);
      });
    }
  }

  async executeVitest(testFile) {
    return new Promise((resolve) => {
      const vitestArgs = [
        'run',
        testFile,
        '--reporter=verbose',
        `--testTimeout=${LOAD_TEST_CONFIG.options.timeout}`,
        '--no-coverage'
      ];

      const vitestProcess = spawn('npx', ['vitest', ...vitestArgs], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd()
      });

      let stdout = '';
      let stderr = '';
      const errors = [];

      vitestProcess.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        if (LOAD_TEST_CONFIG.options.verbose) {
          process.stdout.write(output);
        }
      });

      vitestProcess.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        
        // Extract error messages
        const errorLines = output.split('\n').filter(line => 
          line.includes('Error:') || line.includes('Failed:') || line.includes('✗')
        );
        errors.push(...errorLines);
      });

      vitestProcess.on('close', (code) => {
        // Parse test results from output
        const testResults = this.parseVitestOutput(stdout);
        
        resolve({
          success: code === 0,
          exitCode: code,
          tests: testResults,
          output: stdout,
          errors: errors.filter(e => e.trim().length > 0),
          stderr
        });
      });

      vitestProcess.on('error', (error) => {
        resolve({
          success: false,
          exitCode: -1,
          tests: { total: 0, passed: 0, failed: 0, skipped: 0 },
          output: '',
          errors: [error.message],
          stderr: error.message
        });
      });
    });
  }

  parseVitestOutput(output) {
    const results = {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0
    };

    // Parse vitest output for test counts
    const lines = output.split('\n');
    
    for (const line of lines) {
      // Look for test result summary lines
      if (line.includes('Test Files')) {
        const match = line.match(/(\d+) passed/);
        if (match) {
          results.total += parseInt(match[1]);
          results.passed += parseInt(match[1]);
        }
        
        const failedMatch = line.match(/(\d+) failed/);
        if (failedMatch) {
          results.failed += parseInt(failedMatch[1]);
          results.total += parseInt(failedMatch[1]);
        }
      }
      
      // Count individual test results
      if (line.includes('✓') || line.includes('✅')) {
        results.passed++;
        results.total++;
      } else if (line.includes('✗') || line.includes('❌')) {
        results.failed++;
        results.total++;
      } else if (line.includes('⏭') || line.includes('skipped')) {
        results.skipped++;
        results.total++;
      }
    }

    return results;
  }

  async generateReport() {
    console.log('\n📊 Generating Load Test Report...');
    
    // Calculate final metrics
    this.results.summary.successRate = this.results.summary.totalTests > 0 ? 
      (this.results.summary.passedTests / this.results.summary.totalTests) * 100 : 0;

    const reportData = {
      timestamp: new Date().toISOString(),
      duration: this.results.totalDuration,
      summary: this.results.summary,
      categories: this.results.categories,
      thresholds: LOAD_TEST_CONFIG.thresholds,
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        memory: process.memoryUsage()
      }
    };

    // Write detailed report to file
    const reportPath = path.join(process.cwd(), 'load-test-report.json');
    await fs.writeFile(reportPath, JSON.stringify(reportData, null, 2));

    // Display summary
    console.log('\n🎯 Load Test Summary');
    console.log('=' .repeat(80));
    console.log(`Total Duration: ${(this.results.totalDuration / 1000).toFixed(2)}s`);
    console.log(`Total Tests: ${this.results.summary.totalTests}`);
    console.log(`Passed: ${this.results.summary.passedTests} (${this.results.summary.successRate.toFixed(1)}%)`);
    console.log(`Failed: ${this.results.summary.failedTests}`);
    console.log(`Skipped: ${this.results.summary.skippedTests}`);
    console.log('');

    // Category breakdown
    console.log('📋 Category Results:');
    Object.entries(this.results.categories).forEach(([category, result]) => {
      const statusIcon = result.status === 'passed' ? '✅' : 
                        result.status === 'failed' ? '❌' : '⏭️';
      const duration = result.duration ? `(${(result.duration / 1000).toFixed(2)}s)` : '';
      console.log(`  ${statusIcon} ${category} ${duration}`);
    });

    console.log('');
    console.log(`📄 Detailed report saved to: ${reportPath}`);

    // Check if we met thresholds
    const meetsThresholds = this.checkThresholds();
    
    if (meetsThresholds) {
      console.log('\n🎉 All load test thresholds met! System is ready for production.');
    } else {
      console.log('\n⚠️  Some thresholds not met. Review results before production deployment.');
    }

    return meetsThresholds;
  }

  checkThresholds() {
    let allThresholdsMet = true;

    // Check duration threshold
    if (this.results.totalDuration > LOAD_TEST_CONFIG.thresholds.maxDuration) {
      console.log(`❌ Duration threshold exceeded: ${(this.results.totalDuration / 1000).toFixed(2)}s > ${LOAD_TEST_CONFIG.thresholds.maxDuration / 1000}s`);
      allThresholdsMet = false;
    } else {
      console.log(`✅ Duration threshold met: ${(this.results.totalDuration / 1000).toFixed(2)}s`);
    }

    // Check success rate threshold
    if (this.results.summary.successRate < LOAD_TEST_CONFIG.thresholds.minSuccessRate) {
      console.log(`❌ Success rate threshold not met: ${this.results.summary.successRate.toFixed(1)}% < ${LOAD_TEST_CONFIG.thresholds.minSuccessRate}%`);
      allThresholdsMet = false;
    } else {
      console.log(`✅ Success rate threshold met: ${this.results.summary.successRate.toFixed(1)}%`);
    }

    // Check memory usage
    const memoryUsageMB = process.memoryUsage().heapUsed / 1024 / 1024;
    if (memoryUsageMB > LOAD_TEST_CONFIG.thresholds.maxMemoryUsage) {
      console.log(`❌ Memory usage threshold exceeded: ${memoryUsageMB.toFixed(2)}MB > ${LOAD_TEST_CONFIG.thresholds.maxMemoryUsage}MB`);
      allThresholdsMet = false;
    } else {
      console.log(`✅ Memory usage threshold met: ${memoryUsageMB.toFixed(2)}MB`);
    }

    return allThresholdsMet;
  }
}

// Run the load tests if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const runner = new LoadTestRunner();
  
  runner.run()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export default LoadTestRunner;