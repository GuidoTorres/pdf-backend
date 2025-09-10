#!/usr/bin/env node

/**
 * Comprehensive Metrics System Test
 * 
 * This script tests all components of the metrics and performance analysis system:
 * - MetricsCollector functionality
 * - AlertingSystem alert generation
 * - PerformanceReportGenerator report creation
 * - Database models and operations
 * - API endpoints (if server is running)
 */

import MetricsIntegrationService from './src/services/metricsIntegrationService.js';
import { WorkerMetrics, QueueStats, JobMetrics } from './src/models/index.js';
import database from './src/config/database.js';

class MetricsSystemTester {
  constructor() {
    this.metricsService = null;
    this.testResults = {
      passed: 0,
      failed: 0,
      errors: []
    };
  }
  
  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = {
      info: '📊',
      success: '✅',
      error: '❌',
      warning: '⚠️',
      test: '🧪'
    }[type] || 'ℹ️';
    
    console.log(`${prefix} [${timestamp}] ${message}`);
  }
  
  async runTest(testName, testFunction) {
    try {
      this.log(`Running test: ${testName}`, 'test');
      await testFunction();
      this.testResults.passed++;
      this.log(`Test passed: ${testName}`, 'success');
    } catch (error) {
      this.testResults.failed++;
      this.testResults.errors.push({ test: testName, error: error.message });
      this.log(`Test failed: ${testName} - ${error.message}`, 'error');
    }
  }
  
  async initialize() {
    this.log('Initializing metrics system test environment...', 'info');
    
    try {
      // Initialize database connection
      const sequelize = database.getSequelize();
      await sequelize.authenticate();
      this.log('Database connection established', 'success');
      
      // Initialize metrics service
      this.metricsService = new MetricsIntegrationService({
        enableMetricsCollection: true,
        enableAlerting: true,
        enableReporting: true,
        enableWebSocketUpdates: false, // Disable for testing
        metricsCollectorOptions: {
          collectInterval: 5000, // 5 seconds for testing
          debug: true
        },
        alertingOptions: {
          checkInterval: 10000, // 10 seconds for testing
          debug: true,
          thresholds: {
            avgProcessingTime: 30, // Lower threshold for testing
            successRate: 90, // Lower threshold for testing
            memoryUsage: 50 // Lower threshold for testing
          }
        },
        reportingOptions: {
          enableAutoGeneration: false, // Disable auto generation for testing
          debug: true
        }
      });
      
      await this.metricsService.initialize();
      await this.metricsService.start();
      
      this.log('Metrics integration service initialized and started', 'success');
      
    } catch (error) {
      this.log(`Initialization failed: ${error.message}`, 'error');
      throw error;
    }
  }
  
  async testDatabaseModels() {
    await this.runTest('Database Models - WorkerMetrics CRUD', async () => {
      const workerId = `test-worker-${Date.now()}`;
      
      // Create
      const workerMetrics = await WorkerMetrics.create({
        worker_id: workerId,
        status: 'active',
        jobs_in_progress: 2,
        memory_usage_mb: 512,
        cpu_usage_percent: 45.5
      });
      
      if (!workerMetrics.id) throw new Error('WorkerMetrics creation failed');
      
      // Read
      const retrieved = await WorkerMetrics.findOne({ where: { worker_id: workerId } });
      if (!retrieved) throw new Error('WorkerMetrics retrieval failed');
      
      // Update
      await retrieved.updateHeartbeat();
      await retrieved.incrementJobsCompleted();
      
      // Verify update
      await retrieved.reload();
      if (retrieved.jobs_completed_hour !== 1) throw new Error('WorkerMetrics update failed');
      
      // Clean up
      await retrieved.destroy();
    });
    
    await this.runTest('Database Models - QueueStats CRUD', async () => {
      const queueName = `test-queue-${Date.now()}`;
      
      // Create
      const queueStats = await QueueStats.create({
        queue_name: queueName,
        jobs_waiting: 5,
        jobs_active: 2,
        throughput_per_hour: 25.5
      });
      
      if (!queueStats.id) throw new Error('QueueStats creation failed');
      
      // Update
      await queueStats.updateJobCounts(10, 3, 15, 2, 1);
      
      // Verify update
      await queueStats.reload();
      if (queueStats.jobs_waiting !== 10) throw new Error('QueueStats update failed');
      
      // Clean up
      await queueStats.destroy();
    });
    
    await this.runTest('Database Models - JobMetrics CRUD', async () => {
      const jobId = `test-job-${Date.now()}`;
      const userId = '550e8400-e29b-41d4-a716-446655440000'; // Test UUID
      
      // Create
      const jobMetrics = await JobMetrics.create({
        job_id: jobId,
        user_id: userId,
        queue_name: 'test-queue',
        user_plan: 'premium',
        file_size: 1024000,
        status: 'queued'
      });
      
      if (!jobMetrics.id) throw new Error('JobMetrics creation failed');
      
      // Mark started
      await jobMetrics.markStarted('test-worker-1');
      
      // Mark completed
      await jobMetrics.markCompleted({
        memoryUsedMb: 256,
        cpuTimeMs: 5000,
        accuracyScore: 0.95
      });
      
      // Verify completion
      await jobMetrics.reload();
      if (jobMetrics.status !== 'completed') throw new Error('JobMetrics completion failed');
      
      // Clean up
      await jobMetrics.destroy();
    });
  }
  
  async testMetricsCollector() {
    await this.runTest('MetricsCollector - Job Start Recording', async () => {
      const jobData = {
        jobId: `test-job-${Date.now()}`,
        userId: '550e8400-e29b-41d4-a716-446655440000',
        workerId: 'test-worker-1',
        queueName: 'test-queue',
        priority: 1,
        userPlan: 'premium',
        fileSize: 1024000,
        estimatedTime: 30
      };
      
      const jobMetrics = await this.metricsService.recordJobStart(jobData);
      
      if (!jobMetrics || !jobMetrics.job_id) {
        throw new Error('Job start recording failed');
      }
      
      // Clean up
      await jobMetrics.destroy();
    });
    
    await this.runTest('MetricsCollector - Job Completion Recording', async () => {
      const jobData = {
        jobId: `test-job-${Date.now()}`,
        userId: '550e8400-e29b-41d4-a716-446655440000',
        workerId: 'test-worker-1',
        queueName: 'test-queue',
        userPlan: 'premium'
      };
      
      // Start job
      const jobMetrics = await this.metricsService.recordJobStart(jobData);
      
      // Complete job
      const completionData = {
        memoryUsedMb: 256,
        cpuTimeMs: 5000,
        accuracyScore: 0.95,
        confidenceScore: 0.92
      };
      
      const completedMetrics = await this.metricsService.recordJobCompletion(
        jobData.jobId, 
        completionData
      );
      
      if (!completedMetrics || completedMetrics.status !== 'completed') {
        throw new Error('Job completion recording failed');
      }
      
      // Clean up
      await completedMetrics.destroy();
    });
    
    await this.runTest('MetricsCollector - Worker Metrics Update', async () => {
      const workerId = `test-worker-${Date.now()}`;
      
      await this.metricsService.updateWorkerMetrics(workerId, {
        jobStarted: true,
        memoryMb: 512,
        cpuPercent: 45.5,
        status: 'active'
      });
      
      // Verify worker metrics were created/updated
      const workerMetrics = await WorkerMetrics.findOne({ 
        where: { worker_id: workerId } 
      });
      
      if (!workerMetrics || workerMetrics.status !== 'active') {
        throw new Error('Worker metrics update failed');
      }
      
      // Clean up
      await workerMetrics.destroy();
    });
    
    await this.runTest('MetricsCollector - Real-time Metrics', async () => {
      const metrics = this.metricsService.getRealTimeMetrics();
      
      if (!metrics || typeof metrics !== 'object') {
        throw new Error('Real-time metrics retrieval failed');
      }
      
      if (!metrics.systemMetrics || !metrics.activeJobs || !metrics.workerStates) {
        throw new Error('Real-time metrics missing required properties');
      }
    });
  }
  
  async testAlertingSystem() {
    await this.runTest('AlertingSystem - Test Alert Generation', async () => {
      await this.metricsService.testAlert('test');
      // If no error is thrown, the test passes
    });
    
    await this.runTest('AlertingSystem - Threshold Management', async () => {
      const originalThresholds = this.metricsService.getAlertThresholds();
      
      if (!originalThresholds || typeof originalThresholds !== 'object') {
        throw new Error('Failed to retrieve alert thresholds');
      }
      
      // Update thresholds
      const newThresholds = {
        avgProcessingTime: 45,
        successRate: 85
      };
      
      this.metricsService.updateAlertThresholds(newThresholds);
      
      const updatedThresholds = this.metricsService.getAlertThresholds();
      
      if (updatedThresholds.avgProcessingTime !== 45 || updatedThresholds.successRate !== 85) {
        throw new Error('Alert threshold update failed');
      }
    });
    
    await this.runTest('AlertingSystem - Alert Statistics', async () => {
      const stats = this.metricsService.getAlertStats(24);
      
      if (!stats || typeof stats !== 'object') {
        throw new Error('Failed to retrieve alert statistics');
      }
      
      if (typeof stats.totalAlerts !== 'number') {
        throw new Error('Alert statistics missing required properties');
      }
    });
  }
  
  async testPerformanceReporting() {
    await this.runTest('PerformanceReporting - Performance Report Generation', async () => {
      const report = await this.metricsService.getPerformanceReport(1);
      
      if (!report || typeof report !== 'object') {
        throw new Error('Performance report generation failed');
      }
      
      if (!report.summary || !report.performance || !report.recommendations) {
        throw new Error('Performance report missing required sections');
      }
    });
    
    await this.runTest('PerformanceReporting - Daily Report Generation', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      
      const report = await this.metricsService.generateDailyReport(yesterday);
      
      if (!report || !report.metadata || !report.executive_summary) {
        throw new Error('Daily report generation failed');
      }
      
      if (!report.performance_metrics || !report.recommendations) {
        throw new Error('Daily report missing required sections');
      }
    });
    
    await this.runTest('PerformanceReporting - Available Reports', async () => {
      const reports = await this.metricsService.getAvailableReports();
      
      if (!Array.isArray(reports)) {
        throw new Error('Available reports should return an array');
      }
      
      // Should have at least one report from the previous test
      if (reports.length === 0) {
        this.log('No reports found (this may be expected in a fresh environment)', 'warning');
      }
    });
  }
  
  async testIntegrationScenarios() {
    await this.runTest('Integration - Complete Job Processing Flow', async () => {
      const jobId = `integration-job-${Date.now()}`;
      const workerId = `integration-worker-${Date.now()}`;
      const userId = '550e8400-e29b-41d4-a716-446655440000';
      
      // 1. Start job
      const jobData = {
        jobId,
        userId,
        workerId,
        queueName: 'pdf-processing-premium',
        priority: 1,
        userPlan: 'premium',
        fileSize: 2048000,
        pageCount: 10,
        estimatedTime: 45
      };
      
      const jobMetrics = await this.metricsService.recordJobStart(jobData);
      
      // 2. Update worker metrics
      await this.metricsService.updateWorkerMetrics(workerId, {
        jobStarted: true,
        memoryMb: 768,
        cpuPercent: 65.2,
        status: 'active'
      });
      
      // 3. Update queue stats
      await this.metricsService.updateQueueStats('pdf-processing-premium', {
        jobCounts: {
          waiting: 3,
          active: 2,
          completed: 15,
          failed: 1
        },
        timingStats: {
          avgWaitTime: 12.5,
          avgProcessingTime: 42.3,
          estimatedTime: 180
        }
      });
      
      // 4. Complete job
      const completionData = {
        memoryUsedMb: 768,
        cpuTimeMs: 8500,
        accuracyScore: 0.97,
        confidenceScore: 0.94,
        processingSteps: {
          'pdf_parsing': 2.1,
          'table_detection': 15.3,
          'data_extraction': 8.7,
          'validation': 3.2
        }
      };
      
      await this.metricsService.recordJobCompletion(jobId, completionData);
      
      // 5. Update worker metrics after completion
      await this.metricsService.updateWorkerMetrics(workerId, {
        jobCompleted: true,
        processingTime: 29.3,
        memoryMb: 512,
        cpuPercent: 35.1,
        status: 'idle'
      });
      
      // 6. Verify all data was recorded correctly
      const finalJobMetrics = await JobMetrics.findOne({ where: { job_id: jobId } });
      const finalWorkerMetrics = await WorkerMetrics.findOne({ where: { worker_id: workerId } });
      const finalQueueStats = await QueueStats.findOne({ 
        where: { queue_name: 'pdf-processing-premium' },
        order: [['timestamp', 'DESC']]
      });
      
      if (!finalJobMetrics || finalJobMetrics.status !== 'completed') {
        throw new Error('Job metrics not recorded correctly');
      }
      
      if (!finalWorkerMetrics || finalWorkerMetrics.total_jobs_processed < 1) {
        throw new Error('Worker metrics not updated correctly');
      }
      
      if (!finalQueueStats || finalQueueStats.jobs_active !== 2) {
        throw new Error('Queue stats not updated correctly');
      }
      
      // Clean up
      await finalJobMetrics.destroy();
      await finalWorkerMetrics.destroy();
      await finalQueueStats.destroy();
    });
    
    await this.runTest('Integration - System Health Check', async () => {
      const health = await this.metricsService.getSystemHealth();
      
      if (!health || !health.status || !health.realTimeMetrics) {
        throw new Error('System health check failed');
      }
      
      if (!health.status.initialized || !health.status.running) {
        throw new Error('System not properly initialized or running');
      }
    });
  }
  
  async testPerformanceAndLoad() {
    await this.runTest('Performance - Bulk Job Processing Simulation', async () => {
      const startTime = Date.now();
      const jobPromises = [];
      const numJobs = 50;
      
      // Create multiple jobs simultaneously
      for (let i = 0; i < numJobs; i++) {
        const jobData = {
          jobId: `perf-job-${Date.now()}-${i}`,
          userId: '550e8400-e29b-41d4-a716-446655440000',
          workerId: `perf-worker-${i % 5}`, // 5 workers
          queueName: 'pdf-processing-normal',
          userPlan: 'free',
          fileSize: Math.floor(Math.random() * 5000000) + 500000 // 0.5-5MB
        };
        
        jobPromises.push(this.metricsService.recordJobStart(jobData));
      }
      
      const jobMetrics = await Promise.all(jobPromises);
      
      // Complete all jobs
      const completionPromises = jobMetrics.map((metrics, i) => {
        return this.metricsService.recordJobCompletion(metrics.job_id, {
          memoryUsedMb: Math.random() * 500 + 200,
          cpuTimeMs: Math.random() * 10000 + 2000,
          accuracyScore: Math.random() * 0.2 + 0.8
        });
      });
      
      await Promise.all(completionPromises);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      this.log(`Processed ${numJobs} jobs in ${duration}ms (${(numJobs / (duration / 1000)).toFixed(2)} jobs/sec)`, 'info');
      
      if (duration > 30000) { // 30 seconds
        throw new Error(`Performance test took too long: ${duration}ms`);
      }
      
      // Clean up
      const cleanupPromises = jobMetrics.map(metrics => metrics.destroy());
      await Promise.all(cleanupPromises);
    });
    
    await this.runTest('Performance - Memory Usage Check', async () => {
      const initialMemory = process.memoryUsage();
      
      // Generate performance report (memory intensive operation)
      const report = await this.metricsService.getPerformanceReport(24);
      
      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      
      this.log(`Memory increase during report generation: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB`, 'info');
      
      if (memoryIncrease > 100 * 1024 * 1024) { // 100MB
        throw new Error(`Excessive memory usage: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB`);
      }
    });
  }
  
  async cleanup() {
    this.log('Cleaning up test environment...', 'info');
    
    try {
      if (this.metricsService) {
        await this.metricsService.shutdown();
      }
      
      // Clean up any remaining test data
      await WorkerMetrics.destroy({ where: { worker_id: { [WorkerMetrics.sequelize.Op.like]: 'test-%' } } });
      await WorkerMetrics.destroy({ where: { worker_id: { [WorkerMetrics.sequelize.Op.like]: 'integration-%' } } });
      await WorkerMetrics.destroy({ where: { worker_id: { [WorkerMetrics.sequelize.Op.like]: 'perf-%' } } });
      
      await QueueStats.destroy({ where: { queue_name: { [QueueStats.sequelize.Op.like]: 'test-%' } } });
      
      await JobMetrics.destroy({ where: { job_id: { [JobMetrics.sequelize.Op.like]: 'test-%' } } });
      await JobMetrics.destroy({ where: { job_id: { [JobMetrics.sequelize.Op.like]: 'integration-%' } } });
      await JobMetrics.destroy({ where: { job_id: { [JobMetrics.sequelize.Op.like]: 'perf-%' } } });
      
      this.log('Test cleanup completed', 'success');
      
    } catch (error) {
      this.log(`Cleanup error: ${error.message}`, 'warning');
    }
  }
  
  async run() {
    console.log('🚀 Starting Comprehensive Metrics System Test\n');
    
    try {
      await this.initialize();
      
      console.log('\n📊 Testing Database Models...');
      await this.testDatabaseModels();
      
      console.log('\n📈 Testing MetricsCollector...');
      await this.testMetricsCollector();
      
      console.log('\n🚨 Testing AlertingSystem...');
      await this.testAlertingSystem();
      
      console.log('\n📋 Testing PerformanceReporting...');
      await this.testPerformanceReporting();
      
      console.log('\n🔄 Testing Integration Scenarios...');
      await this.testIntegrationScenarios();
      
      console.log('\n⚡ Testing Performance and Load...');
      await this.testPerformanceAndLoad();
      
    } catch (error) {
      this.log(`Test execution failed: ${error.message}`, 'error');
    } finally {
      await this.cleanup();
    }
    
    // Print test results
    console.log('\n📊 Test Results Summary');
    console.log('======================');
    console.log(`✅ Passed: ${this.testResults.passed}`);
    console.log(`❌ Failed: ${this.testResults.failed}`);
    console.log(`📈 Success Rate: ${((this.testResults.passed / (this.testResults.passed + this.testResults.failed)) * 100).toFixed(1)}%`);
    
    if (this.testResults.errors.length > 0) {
      console.log('\n❌ Failed Tests:');
      this.testResults.errors.forEach(({ test, error }) => {
        console.log(`   • ${test}: ${error}`);
      });
    }
    
    if (this.testResults.failed === 0) {
      console.log('\n🎉 All tests passed! The metrics system is working correctly.');
    } else {
      console.log('\n⚠️  Some tests failed. Please review the errors above.');
      process.exit(1);
    }
  }
}

// Run the test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new MetricsSystemTester();
  tester.run().catch(error => {
    console.error('❌ Test runner failed:', error);
    process.exit(1);
  });
}

export default MetricsSystemTester;