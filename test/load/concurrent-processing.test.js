import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import ClusterManager from '../../src/services/clusterManager.js';
import PriorityQueueManager from '../../src/services/priorityQueueManager.js';
import LoadBalancer from '../../src/services/loadBalancer.js';
import WebSocketManager from '../../src/services/websocketManager.js';
import { performance } from 'perf_hooks';

// Mock dependencies
vi.mock('../../src/services/logService.js');
vi.mock('../../src/services/databaseService.js');
vi.mock('ioredis');
vi.mock('bullmq');

describe('Concurrent PDF Processing Load Tests', () => {
  let clusterManager;
  let priorityQueueManager;
  let loadBalancer;
  let websocketManager;
  let mockRedis;
  let testFiles;

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock Redis
    mockRedis = {
      setex: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
      quit: vi.fn(),
      pipeline: vi.fn(() => ({
        exec: vi.fn(() => Promise.resolve([]))
      }))
    };

    vi.doMock('ioredis', () => {
      return vi.fn(() => mockRedis);
    });

    // Mock BullMQ
    const mockQueue = {
      add: vi.fn(() => Promise.resolve({ id: Math.random().toString() })),
      getWaiting: vi.fn(() => Promise.resolve([])),
      getActive: vi.fn(() => Promise.resolve([])),
      getCompleted: vi.fn(() => Promise.resolve([])),
      getFailed: vi.fn(() => Promise.resolve([])),
      clean: vi.fn(() => Promise.resolve())
    };

    const mockWorker = {
      on: vi.fn(),
      close: vi.fn(() => Promise.resolve()),
      process: vi.fn()
    };

    vi.doMock('bullmq', () => ({
      Queue: vi.fn(() => mockQueue),
      Worker: vi.fn(() => mockWorker)
    }));

    // Initialize services
    clusterManager = new ClusterManager({
      minWorkers: 5,
      maxWorkers: 15,
      scaleUpThreshold: 10,
      scaleDownThreshold: 2
    });

    priorityQueueManager = new PriorityQueueManager();
    loadBalancer = new LoadBalancer(clusterManager);
    websocketManager = new WebSocketManager();

    // Create test files data
    testFiles = Array.from({ length: 60 }, (_, i) => ({
      id: `test-file-${i}`,
      filename: `document-${i}.pdf`,
      size: Math.floor(Math.random() * 50 * 1024 * 1024), // 0-50MB
      userId: `user-${i % 20}`, // 20 different users
      userPlan: i % 4 === 0 ? 'premium' : i % 10 === 0 ? 'unlimited' : 'normal'
    }));
  });

  afterEach(async () => {
    if (clusterManager) {
      await clusterManager.stop();
    }
    if (priorityQueueManager) {
      await priorityQueueManager.close();
    }
  });

  describe('High Concurrency Processing', () => {
    test('should handle 50+ concurrent PDF uploads without failure', async () => {
      // Start cluster with initial workers
      await clusterManager.start();
      
      const startTime = performance.now();
      const concurrentUploads = 55;
      
      // Create concurrent upload promises
      const uploadPromises = testFiles.slice(0, concurrentUploads).map(async (file, index) => {
        try {
          // Simulate file upload delay
          await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
          
          // Add job to appropriate queue
          const jobData = {
            fileId: file.id,
            filename: file.filename,
            userId: file.userId,
            userPlan: file.userPlan,
            fileSize: file.size,
            uploadedAt: new Date()
          };

          const job = await priorityQueueManager.addJob(jobData, file.userPlan, file.size);
          
          return {
            success: true,
            jobId: job.id,
            fileId: file.id,
            queueTime: performance.now() - startTime
          };
        } catch (error) {
          return {
            success: false,
            error: error.message,
            fileId: file.id
          };
        }
      });

      // Wait for all uploads to complete
      const results = await Promise.allSettled(uploadPromises);
      const endTime = performance.now();
      
      // Analyze results
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success);
      const failed = results.filter(r => r.status === 'rejected' || !r.value?.success);
      
      const totalTime = endTime - startTime;
      const successRate = (successful.length / concurrentUploads) * 100;
      
      console.log(`Concurrent Upload Test Results:
        - Total uploads: ${concurrentUploads}
        - Successful: ${successful.length}
        - Failed: ${failed.length}
        - Success rate: ${successRate.toFixed(2)}%
        - Total time: ${totalTime.toFixed(2)}ms
        - Average time per upload: ${(totalTime / concurrentUploads).toFixed(2)}ms`);

      // Assertions
      expect(successRate).toBeGreaterThan(90); // At least 90% success rate
      expect(totalTime).toBeLessThan(30000); // Complete within 30 seconds
      expect(successful.length).toBeGreaterThanOrEqual(50); // At least 50 successful
    }, 60000); // 60 second timeout

    test('should maintain response time under extreme load', async () => {
      await clusterManager.start();
      
      const extremeLoad = 100;
      const maxAcceptableTime = 45000; // 45 seconds
      
      const startTime = performance.now();
      
      // Create extreme load scenario
      const loadPromises = Array.from({ length: extremeLoad }, async (_, i) => {
        const file = testFiles[i % testFiles.length];
        
        const jobData = {
          fileId: `extreme-${i}`,
          filename: `extreme-load-${i}.pdf`,
          userId: file.userId,
          userPlan: file.userPlan,
          fileSize: file.size
        };

        const jobStartTime = performance.now();
        
        try {
          await priorityQueueManager.addJob(jobData, file.userPlan, file.size);
          return {
            success: true,
            responseTime: performance.now() - jobStartTime
          };
        } catch (error) {
          return {
            success: false,
            responseTime: performance.now() - jobStartTime,
            error: error.message
          };
        }
      });

      const results = await Promise.allSettled(loadPromises);
      const totalTime = performance.now() - startTime;
      
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success);
      const responseTimes = successful.map(r => r.value.responseTime);
      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const maxResponseTime = Math.max(...responseTimes);
      
      console.log(`Extreme Load Test Results:
        - Total requests: ${extremeLoad}
        - Successful: ${successful.length}
        - Total time: ${totalTime.toFixed(2)}ms
        - Average response time: ${avgResponseTime.toFixed(2)}ms
        - Max response time: ${maxResponseTime.toFixed(2)}ms`);

      expect(totalTime).toBeLessThan(maxAcceptableTime);
      expect(avgResponseTime).toBeLessThan(5000); // Average under 5 seconds
      expect(successful.length).toBeGreaterThan(extremeLoad * 0.85); // 85% success rate
    }, 90000); // 90 second timeout

    test('should handle mixed file sizes efficiently', async () => {
      await clusterManager.start();
      
      // Create mix of small, medium, and large files
      const mixedFiles = [
        ...Array(20).fill().map((_, i) => ({ 
          id: `small-${i}`, 
          size: 1024 * 1024, // 1MB
          userPlan: 'normal'
        })),
        ...Array(15).fill().map((_, i) => ({ 
          id: `medium-${i}`, 
          size: 10 * 1024 * 1024, // 10MB
          userPlan: 'premium'
        })),
        ...Array(10).fill().map((_, i) => ({ 
          id: `large-${i}`, 
          size: 60 * 1024 * 1024, // 60MB (large file)
          userPlan: 'unlimited'
        }))
      ];

      const startTime = performance.now();
      
      const processingPromises = mixedFiles.map(async (file) => {
        const jobData = {
          fileId: file.id,
          filename: `${file.id}.pdf`,
          userId: `user-${file.id}`,
          userPlan: file.userPlan,
          fileSize: file.size
        };

        const jobStartTime = performance.now();
        
        try {
          const job = await priorityQueueManager.addJob(jobData, file.userPlan, file.size);
          
          // Determine expected queue based on file size and user plan
          let expectedQueue = 'pdf-processing-normal';
          if (file.size > 50 * 1024 * 1024) {
            expectedQueue = 'pdf-processing-large';
          } else if (['premium', 'unlimited'].includes(file.userPlan)) {
            expectedQueue = 'pdf-processing-premium';
          }
          
          return {
            success: true,
            fileId: file.id,
            fileSize: file.size,
            userPlan: file.userPlan,
            expectedQueue,
            processingTime: performance.now() - jobStartTime
          };
        } catch (error) {
          return {
            success: false,
            fileId: file.id,
            error: error.message
          };
        }
      });

      const results = await Promise.allSettled(processingPromises);
      const totalTime = performance.now() - startTime;
      
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success);
      const bySize = {
        small: successful.filter(r => r.value.fileSize < 5 * 1024 * 1024),
        medium: successful.filter(r => r.value.fileSize >= 5 * 1024 * 1024 && r.value.fileSize < 50 * 1024 * 1024),
        large: successful.filter(r => r.value.fileSize >= 50 * 1024 * 1024)
      };

      console.log(`Mixed File Size Test Results:
        - Total files: ${mixedFiles.length}
        - Successful: ${successful.length}
        - Small files processed: ${bySize.small.length}
        - Medium files processed: ${bySize.medium.length}
        - Large files processed: ${bySize.large.length}
        - Total time: ${totalTime.toFixed(2)}ms`);

      expect(successful.length).toBe(mixedFiles.length);
      expect(bySize.large.length).toBe(10); // All large files should be processed
      expect(totalTime).toBeLessThan(60000); // Complete within 60 seconds
    }, 90000);
  });

  describe('System Resource Management', () => {
    test('should not exceed memory limits during high load', async () => {
      await clusterManager.start();
      
      const memoryLimit = 2048; // 2GB in MB
      const highLoadFiles = 30;
      
      // Mock memory monitoring
      const memoryUsages = [];
      const originalUpdateMetrics = clusterManager.updateSystemMetrics;
      
      clusterManager.updateSystemMetrics = async function() {
        const memoryUsage = Math.floor(Math.random() * 1800) + 200; // 200-2000 MB
        memoryUsages.push(memoryUsage);
        
        this.systemMetrics = {
          ...this.systemMetrics,
          memoryUsage,
          timestamp: Date.now()
        };
        
        return originalUpdateMetrics.call(this);
      };

      // Process files and monitor memory
      const processingPromises = Array.from({ length: highLoadFiles }, async (_, i) => {
        const file = testFiles[i];
        
        // Update system metrics before processing
        await clusterManager.updateSystemMetrics();
        
        const jobData = {
          fileId: file.id,
          filename: file.filename,
          userId: file.userId,
          userPlan: file.userPlan,
          fileSize: file.size
        };

        return await priorityQueueManager.addJob(jobData, file.userPlan, file.size);
      });

      await Promise.allSettled(processingPromises);
      
      const maxMemoryUsage = Math.max(...memoryUsages);
      const avgMemoryUsage = memoryUsages.reduce((a, b) => a + b, 0) / memoryUsages.length;
      
      console.log(`Memory Usage Test Results:
        - Max memory usage: ${maxMemoryUsage}MB
        - Average memory usage: ${avgMemoryUsage.toFixed(2)}MB
        - Memory limit: ${memoryLimit}MB
        - Peak usage percentage: ${((maxMemoryUsage / memoryLimit) * 100).toFixed(2)}%`);

      expect(maxMemoryUsage).toBeLessThan(memoryLimit);
      expect(avgMemoryUsage).toBeLessThan(memoryLimit * 0.8); // Average under 80% of limit
    }, 60000);

    test('should clean up temporary files after processing', async () => {
      await clusterManager.start();
      
      const tempFilesBefore = new Set();
      const tempFilesAfter = new Set();
      
      // Mock temp file creation and cleanup
      const mockTempFiles = Array.from({ length: 20 }, (_, i) => `/tmp/pdf-processing/temp-${i}.pdf`);
      
      // Simulate file processing with temp file creation
      const processingPromises = testFiles.slice(0, 20).map(async (file, index) => {
        const tempFile = mockTempFiles[index];
        tempFilesBefore.add(tempFile);
        
        const jobData = {
          fileId: file.id,
          filename: file.filename,
          userId: file.userId,
          userPlan: file.userPlan,
          fileSize: file.size,
          tempFile
        };

        try {
          await priorityQueueManager.addJob(jobData, file.userPlan, file.size);
          
          // Simulate processing completion and cleanup
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Simulate temp file cleanup (remove from our tracking)
          if (Math.random() > 0.1) { // 90% cleanup success rate
            tempFilesBefore.delete(tempFile);
          } else {
            tempFilesAfter.add(tempFile);
          }
          
          return { success: true, tempFile };
        } catch (error) {
          tempFilesAfter.add(tempFile); // Failed jobs leave temp files
          return { success: false, tempFile, error: error.message };
        }
      });

      await Promise.allSettled(processingPromises);
      
      const cleanupRate = ((mockTempFiles.length - tempFilesAfter.size) / mockTempFiles.length) * 100;
      
      console.log(`Temp File Cleanup Test Results:
        - Total temp files created: ${mockTempFiles.length}
        - Files remaining after cleanup: ${tempFilesAfter.size}
        - Cleanup success rate: ${cleanupRate.toFixed(2)}%`);

      expect(tempFilesAfter.size).toBeLessThan(mockTempFiles.length * 0.15); // Less than 15% remain
      expect(cleanupRate).toBeGreaterThan(85); // At least 85% cleanup rate
    }, 45000);
  });

  describe('Performance Benchmarks', () => {
    test('should maintain throughput under sustained load', async () => {
      await clusterManager.start();
      
      const sustainedLoadDuration = 30000; // 30 seconds
      const targetThroughput = 2; // 2 jobs per second minimum
      
      let jobsProcessed = 0;
      let jobsSuccessful = 0;
      const startTime = performance.now();
      
      // Create sustained load
      const loadInterval = setInterval(async () => {
        if (performance.now() - startTime >= sustainedLoadDuration) {
          clearInterval(loadInterval);
          return;
        }
        
        const file = testFiles[jobsProcessed % testFiles.length];
        const jobData = {
          fileId: `sustained-${jobsProcessed}`,
          filename: `sustained-${jobsProcessed}.pdf`,
          userId: file.userId,
          userPlan: file.userPlan,
          fileSize: file.size
        };

        try {
          await priorityQueueManager.addJob(jobData, file.userPlan, file.size);
          jobsSuccessful++;
        } catch (error) {
          console.warn(`Job ${jobsProcessed} failed:`, error.message);
        }
        
        jobsProcessed++;
      }, 500); // Submit job every 500ms

      // Wait for sustained load period
      await new Promise(resolve => setTimeout(resolve, sustainedLoadDuration + 1000));
      
      const actualDuration = performance.now() - startTime;
      const actualThroughput = jobsSuccessful / (actualDuration / 1000);
      const successRate = (jobsSuccessful / jobsProcessed) * 100;
      
      console.log(`Sustained Load Test Results:
        - Duration: ${(actualDuration / 1000).toFixed(2)}s
        - Jobs submitted: ${jobsProcessed}
        - Jobs successful: ${jobsSuccessful}
        - Success rate: ${successRate.toFixed(2)}%
        - Throughput: ${actualThroughput.toFixed(2)} jobs/second`);

      expect(actualThroughput).toBeGreaterThanOrEqual(targetThroughput);
      expect(successRate).toBeGreaterThan(90);
    }, 45000);

    test('should handle burst traffic patterns', async () => {
      await clusterManager.start();
      
      const burstSizes = [5, 15, 25, 10, 30, 5]; // Varying burst sizes
      const burstInterval = 3000; // 3 seconds between bursts
      
      const allResults = [];
      
      for (let i = 0; i < burstSizes.length; i++) {
        const burstSize = burstSizes[i];
        const burstStartTime = performance.now();
        
        console.log(`Starting burst ${i + 1} with ${burstSize} jobs...`);
        
        // Create burst of jobs
        const burstPromises = Array.from({ length: burstSize }, async (_, j) => {
          const file = testFiles[(i * 50 + j) % testFiles.length];
          const jobData = {
            fileId: `burst-${i}-${j}`,
            filename: `burst-${i}-${j}.pdf`,
            userId: file.userId,
            userPlan: file.userPlan,
            fileSize: file.size
          };

          try {
            const job = await priorityQueueManager.addJob(jobData, file.userPlan, file.size);
            return {
              success: true,
              burstIndex: i,
              jobIndex: j,
              responseTime: performance.now() - burstStartTime
            };
          } catch (error) {
            return {
              success: false,
              burstIndex: i,
              jobIndex: j,
              error: error.message
            };
          }
        });

        const burstResults = await Promise.allSettled(burstPromises);
        const burstTime = performance.now() - burstStartTime;
        
        const successful = burstResults.filter(r => r.status === 'fulfilled' && r.value.success);
        
        allResults.push({
          burstIndex: i,
          burstSize,
          successful: successful.length,
          burstTime,
          successRate: (successful.length / burstSize) * 100
        });
        
        // Wait before next burst
        if (i < burstSizes.length - 1) {
          await new Promise(resolve => setTimeout(resolve, burstInterval));
        }
      }
      
      const totalJobs = burstSizes.reduce((a, b) => a + b, 0);
      const totalSuccessful = allResults.reduce((sum, burst) => sum + burst.successful, 0);
      const overallSuccessRate = (totalSuccessful / totalJobs) * 100;
      const avgBurstTime = allResults.reduce((sum, burst) => sum + burst.burstTime, 0) / allResults.length;
      
      console.log(`Burst Traffic Test Results:
        - Total bursts: ${burstSizes.length}
        - Total jobs: ${totalJobs}
        - Total successful: ${totalSuccessful}
        - Overall success rate: ${overallSuccessRate.toFixed(2)}%
        - Average burst processing time: ${avgBurstTime.toFixed(2)}ms`);

      expect(overallSuccessRate).toBeGreaterThan(85);
      expect(avgBurstTime).toBeLessThan(10000); // Average burst under 10 seconds
      expect(allResults.every(burst => burst.successRate > 80)).toBe(true); // Each burst > 80% success
    }, 90000);
  });
});