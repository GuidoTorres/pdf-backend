#!/usr/bin/env node
/**
 * Performance and Load Tests
 * Tests system performance under various load conditions
 */

import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'http://localhost:3001/api';

console.log('⚡ Starting Performance and Load Tests...\n');

class PerformanceTest {
  constructor() {
    this.authToken = null;
    this.results = {
      concurrent_users: [],
      response_times: [],
      memory_usage: [],
      error_rates: []
    };
  }

  async runAllTests() {
    try {
      console.log('🔐 Setting up authentication...');
      await this.setupAuth();
      
      console.log('⚡ Test 1: Response Time Benchmarks');
      await this.testResponseTimes();
      
      console.log('👥 Test 2: Concurrent Users');
      await this.testConcurrentUsers();
      
      console.log('📄 Test 3: Large File Processing');
      await this.testLargeFileProcessing();
      
      console.log('🔄 Test 4: API Rate Limits');
      await this.testApiRateLimits();
      
      console.log('💾 Test 5: Memory Usage');
      await this.testMemoryUsage();
      
      console.log('📊 Generating Performance Report...');
      this.generateReport();
      
      console.log('✅ All performance tests completed!');
      return true;
      
    } catch (error) {
      console.error('❌ Performance test failed:', error.message);
      return false;
    }
  }

  async setupAuth() {
    try {
      const loginResponse = await axios.post(`${BASE_URL}/auth/login`, {
        email: 'hectortorresdurand@gmail.com',
        password: 'password123'
      });
      
      this.authToken = loginResponse.data.token;
      console.log('   ✅ Authentication setup successful');
    } catch (error) {
      throw new Error('Authentication setup failed');
    }
  }

  async testResponseTimes() {
    const endpoints = [
      { name: 'GET /auth/me', url: `${BASE_URL}/auth/me`, method: 'GET' },
      { name: 'GET /documents/history', url: `${BASE_URL}/documents/history`, method: 'GET' },
      { name: 'POST /auth/login', url: `${BASE_URL}/auth/login`, method: 'POST', data: { email: 'test@example.com', password: 'wrong' } }
    ];

    for (const endpoint of endpoints) {
      const times = [];
      const iterations = 10;

      console.log(`   Testing ${endpoint.name}...`);

      for (let i = 0; i < iterations; i++) {
        const startTime = Date.now();
        
        try {
          if (endpoint.method === 'GET') {
            await axios.get(endpoint.url, {
              headers: { Authorization: `Bearer ${this.authToken}` }
            });
          } else {
            await axios.post(endpoint.url, endpoint.data);
          }
        } catch (error) {
          // Expected for some endpoints
        }
        
        const endTime = Date.now();
        times.push(endTime - startTime);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const minTime = Math.min(...times);
      const maxTime = Math.max(...times);

      console.log(`     Average: ${avgTime.toFixed(2)}ms, Min: ${minTime}ms, Max: ${maxTime}ms`);
      
      this.results.response_times.push({
        endpoint: endpoint.name,
        average: avgTime,
        min: minTime,
        max: maxTime
      });

      // Performance thresholds
      if (avgTime > 1000) {
        console.log(`     ⚠️  Warning: Slow response time (${avgTime.toFixed(2)}ms)`);
      } else if (avgTime < 200) {
        console.log(`     ✅ Excellent response time`);
      }
    }
  }

  async testConcurrentUsers() {
    const concurrentLevels = [5, 10, 20];
    
    for (const userCount of concurrentLevels) {
      console.log(`   Testing ${userCount} concurrent users...`);
      
      const startTime = Date.now();
      const promises = [];
      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < userCount; i++) {
        const promise = axios.get(`${BASE_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${this.authToken}` }
        })
        .then(() => successCount++)
        .catch(() => errorCount++);
        
        promises.push(promise);
      }

      await Promise.all(promises);
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      const errorRate = (errorCount / userCount) * 100;

      console.log(`     Completed in ${totalTime}ms`);
      console.log(`     Success: ${successCount}, Errors: ${errorCount} (${errorRate.toFixed(1)}% error rate)`);

      this.results.concurrent_users.push({
        user_count: userCount,
        total_time: totalTime,
        success_count: successCount,
        error_count: errorCount,
        error_rate: errorRate
      });

      // Performance thresholds
      if (errorRate > 10) {
        console.log(`     ⚠️  Warning: High error rate under load`);
      } else if (errorRate === 0) {
        console.log(`     ✅ No errors under concurrent load`);
      }
    }
  }

  async testLargeFileProcessing() {
    console.log('   Testing large file processing...');
    
    const pdfPath = path.join(__dirname, 'pdf', 'estado_unlocked.pdf');
    
    try {
      await fs.access(pdfPath);
    } catch {
      console.log('     ⚠️  Test PDF not found, skipping large file test');
      return;
    }

    const startTime = Date.now();
    
    try {
      const formData = new FormData();
      const pdfBuffer = await fs.readFile(pdfPath);
      const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
      formData.append('pdf', blob, 'performance-test.pdf');

      const uploadResponse = await axios.post(`${BASE_URL}/documents/upload`, formData, {
        headers: {
          Authorization: `Bearer ${this.authToken}`,
          'Content-Type': 'multipart/form-data'
        },
        timeout: 60000 // 60 second timeout
      });

      if (uploadResponse.data.jobId) {
        // Monitor processing time
        const jobId = uploadResponse.data.jobId;
        let processingComplete = false;
        let attempts = 0;
        const maxAttempts = 60;

        while (!processingComplete && attempts < maxAttempts) {
          const statusResponse = await axios.get(`${BASE_URL}/documents/status/${jobId}`, {
            headers: { Authorization: `Bearer ${this.authToken}` }
          });

          if (statusResponse.data.state === 'completed') {
            processingComplete = true;
          } else if (statusResponse.data.state === 'failed') {
            throw new Error('Processing failed');
          }

          await new Promise(resolve => setTimeout(resolve, 1000));
          attempts++;
        }

        const endTime = Date.now();
        const totalTime = endTime - startTime;

        console.log(`     File processed in ${totalTime}ms`);
        
        if (totalTime > 30000) {
          console.log(`     ⚠️  Warning: Slow processing time (${(totalTime/1000).toFixed(1)}s)`);
        } else {
          console.log(`     ✅ Good processing performance`);
        }
      }

    } catch (error) {
      console.log(`     ❌ Large file processing failed: ${error.message}`);
    }
  }

  async testApiRateLimits() {
    console.log('   Testing API rate limits...');
    
    const rapidRequests = 50;
    const promises = [];
    let successCount = 0;
    let rateLimitedCount = 0;
    let errorCount = 0;

    const startTime = Date.now();

    for (let i = 0; i < rapidRequests; i++) {
      const promise = axios.get(`${BASE_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${this.authToken}` }
      })
      .then(() => successCount++)
      .catch(error => {
        if (error.response?.status === 429) {
          rateLimitedCount++;
        } else {
          errorCount++;
        }
      });
      
      promises.push(promise);
    }

    await Promise.all(promises);
    const endTime = Date.now();
    const totalTime = endTime - startTime;

    console.log(`     ${rapidRequests} requests in ${totalTime}ms`);
    console.log(`     Success: ${successCount}, Rate Limited: ${rateLimitedCount}, Errors: ${errorCount}`);

    if (rateLimitedCount > 0) {
      console.log(`     ✅ Rate limiting is working`);
    } else {
      console.log(`     ⚠️  No rate limiting detected`);
    }
  }

  async testMemoryUsage() {
    console.log('   Testing memory usage patterns...');
    
    // This is a basic test - in production you'd use more sophisticated monitoring
    const initialMemory = process.memoryUsage();
    
    // Perform memory-intensive operations
    const largeArray = [];
    for (let i = 0; i < 100; i++) {
      const response = await axios.get(`${BASE_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${this.authToken}` }
      }).catch(() => {});
      
      largeArray.push(response);
    }

    const finalMemory = process.memoryUsage();
    const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

    console.log(`     Memory increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)} MB`);
    
    if (memoryIncrease > 50 * 1024 * 1024) { // 50MB
      console.log(`     ⚠️  Warning: High memory usage increase`);
    } else {
      console.log(`     ✅ Acceptable memory usage`);
    }

    // Cleanup
    largeArray.length = 0;
  }

  generateReport() {
    console.log('\n📊 Performance Test Report');
    console.log('=' .repeat(50));
    
    console.log('\n⚡ Response Times:');
    this.results.response_times.forEach(result => {
      console.log(`   ${result.endpoint}: ${result.average.toFixed(2)}ms avg`);
    });

    console.log('\n👥 Concurrent Users:');
    this.results.concurrent_users.forEach(result => {
      console.log(`   ${result.user_count} users: ${result.error_rate.toFixed(1)}% error rate`);
    });

    // Performance recommendations
    console.log('\n💡 Recommendations:');
    
    const slowEndpoints = this.results.response_times.filter(r => r.average > 500);
    if (slowEndpoints.length > 0) {
      console.log('   - Consider optimizing slow endpoints');
    }

    const highErrorRates = this.results.concurrent_users.filter(r => r.error_rate > 5);
    if (highErrorRates.length > 0) {
      console.log('   - Investigate high error rates under load');
    }

    if (slowEndpoints.length === 0 && highErrorRates.length === 0) {
      console.log('   ✅ Performance looks good for production!');
    }
  }
}

// Run the performance tests
const test = new PerformanceTest();
test.runAllTests()
  .then(success => {
    if (success) {
      console.log('\n⚡ Performance and Load Tests COMPLETED');
      process.exit(0);
    } else {
      console.log('\n❌ Performance and Load Tests FAILED');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('\n❌ Performance test error:', error);
    process.exit(1);
  });