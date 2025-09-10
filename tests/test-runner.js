#!/usr/bin/env node
/**
 * Master Test Runner
 * Runs all tests in the correct order and generates a comprehensive report
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

console.log('🧪 SaaS Test Suite - Master Test Runner\n');
console.log('=' .repeat(60));

class TestRunner {
  constructor() {
    this.results = {
      passed: 0,
      failed: 0,
      skipped: 0,
      tests: []
    };
  }

  async runAllTests() {
    console.log('🚀 Starting comprehensive test suite...\n');

    const testSuites = [
      {
        name: 'Database Connection Test',
        command: 'node',
        args: ['test-db.js'],
        cwd: 'backend',
        critical: true,
        description: 'Tests database connectivity and models'
      },
      {
        name: 'Authentication Endpoint Test',
        command: 'node',
        args: ['test-auth-endpoint.js'],
        cwd: 'backend',
        critical: true,
        description: 'Tests authentication endpoints and JWT'
      },
      {
        name: 'Queue System Test',
        command: 'node',
        args: ['test_queue_system.js'],
        cwd: 'backend',
        critical: true,
        description: 'Tests PDF processing queue system'
      },
      {
        name: 'API Response Test',
        command: 'node',
        args: ['backend/test_api_response.js'],
        critical: true,
        description: 'Tests API response formats'
      },
      {
        name: 'Complete API Endpoints Test',
        command: 'node',
        args: ['backend/test_api_endpoints_complete.js'],
        critical: true,
        description: 'Tests all API endpoints comprehensively'
      },
      {
        name: 'Security Validation Test',
        command: 'node',
        args: ['backend/test_security_validation.js'],
        critical: true,
        description: 'Tests security measures and input validation'
      },
      {
        name: 'E2E Complete Flow Test',
        command: 'node',
        args: ['backend/test_e2e_complete_flow.js'],
        critical: true,
        description: 'Tests complete user flow end-to-end'
      },
      {
        name: 'Performance and Load Test',
        command: 'node',
        args: ['backend/test_performance_load.js'],
        critical: false,
        description: 'Tests system performance under load'
      },
      {
        name: 'Frontend Unit Tests',
        command: 'npm',
        args: ['test'],
        cwd: 'frontend-design',
        critical: false,
        description: 'Tests React components and services'
      }
    ];

    for (const suite of testSuites) {
      await this.runTestSuite(suite);
    }

    this.generateFinalReport();
    return this.results.failed === 0;
  }

  async runTestSuite(suite) {
    console.log(`\n🔍 Running: ${suite.name}`);
    console.log(`📝 ${suite.description}`);
    console.log('-' .repeat(50));

    const startTime = Date.now();

    try {
      const result = await this.executeTest(suite);
      const endTime = Date.now();
      const duration = endTime - startTime;

      if (result.success) {
        console.log(`✅ ${suite.name} PASSED (${duration}ms)`);
        this.results.passed++;
        this.results.tests.push({
          name: suite.name,
          status: 'PASSED',
          duration,
          critical: suite.critical
        });
      } else {
        console.log(`❌ ${suite.name} FAILED (${duration}ms)`);
        if (result.error) {
          console.log(`   Error: ${result.error}`);
        }
        this.results.failed++;
        this.results.tests.push({
          name: suite.name,
          status: 'FAILED',
          duration,
          critical: suite.critical,
          error: result.error
        });

        // Stop on critical test failures
        if (suite.critical) {
          console.log(`\n🚨 Critical test failed. Stopping test suite.`);
          return false;
        }
      }
    } catch (error) {
      console.log(`❌ ${suite.name} ERROR: ${error.message}`);
      this.results.failed++;
      this.results.tests.push({
        name: suite.name,
        status: 'ERROR',
        duration: Date.now() - startTime,
        critical: suite.critical,
        error: error.message
      });

      if (suite.critical) {
        console.log(`\n🚨 Critical test error. Stopping test suite.`);
        return false;
      }
    }

    return true;
  }

  executeTest(suite) {
    return new Promise((resolve) => {
      const process = spawn(suite.command, suite.args, {
        cwd: suite.cwd || '.',
        stdio: 'pipe'
      });

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        // Show real-time output for important messages
        if (output.includes('✅') || output.includes('❌') || output.includes('⚠️')) {
          console.log(output.trim());
        }
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true });
        } else {
          resolve({ 
            success: false, 
            error: stderr || `Process exited with code ${code}` 
          });
        }
      });

      process.on('error', (error) => {
        resolve({ 
          success: false, 
          error: error.message 
        });
      });
    });
  }

  generateFinalReport() {
    console.log('\n' + '=' .repeat(60));
    console.log('📊 FINAL TEST REPORT');
    console.log('=' .repeat(60));

    console.log(`\n📈 Summary:`);
    console.log(`   Total Tests: ${this.results.passed + this.results.failed}`);
    console.log(`   ✅ Passed: ${this.results.passed}`);
    console.log(`   ❌ Failed: ${this.results.failed}`);
    
    const successRate = (this.results.passed / (this.results.passed + this.results.failed)) * 100;
    console.log(`   📊 Success Rate: ${successRate.toFixed(1)}%`);

    // Critical tests status
    const criticalTests = this.results.tests.filter(t => t.critical);
    const criticalPassed = criticalTests.filter(t => t.status === 'PASSED').length;
    const criticalFailed = criticalTests.filter(t => t.status !== 'PASSED').length;

    console.log(`\n🚨 Critical Tests:`);
    console.log(`   ✅ Passed: ${criticalPassed}`);
    console.log(`   ❌ Failed: ${criticalFailed}`);

    // Detailed results
    console.log(`\n📋 Detailed Results:`);
    this.results.tests.forEach(test => {
      const status = test.status === 'PASSED' ? '✅' : '❌';
      const critical = test.critical ? '🚨' : '  ';
      console.log(`   ${status} ${critical} ${test.name} (${test.duration}ms)`);
      if (test.error) {
        console.log(`      Error: ${test.error}`);
      }
    });

    // Production readiness assessment
    console.log(`\n🚀 Production Readiness Assessment:`);
    
    if (criticalFailed === 0) {
      console.log(`   ✅ All critical tests passed - Core functionality working`);
    } else {
      console.log(`   ❌ ${criticalFailed} critical tests failed - NOT ready for production`);
    }

    if (successRate >= 90) {
      console.log(`   ✅ High success rate (${successRate.toFixed(1)}%) - Good quality`);
    } else if (successRate >= 70) {
      console.log(`   ⚠️  Moderate success rate (${successRate.toFixed(1)}%) - Needs improvement`);
    } else {
      console.log(`   ❌ Low success rate (${successRate.toFixed(1)}%) - Significant issues`);
    }

    // Recommendations
    console.log(`\n💡 Recommendations:`);
    
    if (criticalFailed === 0 && successRate >= 85) {
      console.log(`   🎉 Your SaaS is ready for production launch!`);
      console.log(`   📝 Consider implementing the failed non-critical tests for better robustness`);
    } else if (criticalFailed === 0) {
      console.log(`   ⚠️  Core functionality works, but fix non-critical issues before launch`);
    } else {
      console.log(`   🚨 Fix critical issues before considering production deployment`);
    }

    // Next steps
    console.log(`\n🎯 Next Steps:`);
    console.log(`   1. Fix any failed critical tests`);
    console.log(`   2. Implement missing non-critical tests`);
    console.log(`   3. Set up CI/CD pipeline with these tests`);
    console.log(`   4. Configure monitoring and alerting`);
    console.log(`   5. Prepare deployment infrastructure`);

    console.log('\n' + '=' .repeat(60));
  }

  async saveReport() {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        total: this.results.passed + this.results.failed,
        passed: this.results.passed,
        failed: this.results.failed,
        success_rate: (this.results.passed / (this.results.passed + this.results.failed)) * 100
      },
      tests: this.results.tests
    };

    try {
      await fs.writeFile('test-report.json', JSON.stringify(report, null, 2));
      console.log('📄 Test report saved to test-report.json');
    } catch (error) {
      console.log('⚠️  Could not save test report:', error.message);
    }
  }
}

// Run the test suite
const runner = new TestRunner();
runner.runAllTests()
  .then(async (success) => {
    await runner.saveReport();
    
    if (success) {
      console.log('\n🎉 TEST SUITE COMPLETED SUCCESSFULLY');
      process.exit(0);
    } else {
      console.log('\n❌ TEST SUITE COMPLETED WITH FAILURES');
      process.exit(1);
    }
  })
  .catch(async (error) => {
    console.error('\n💥 TEST SUITE CRASHED:', error);
    await runner.saveReport();
    process.exit(1);
  });