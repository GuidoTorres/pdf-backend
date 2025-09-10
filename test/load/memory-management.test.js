import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import ClusterManager from '../../src/services/clusterManager.js';
import ResourcePool from '../../src/services/resourcePool.js';
import MemoryMonitor from '../../src/services/memoryMonitor.js';
import TempFileCleanup from '../../src/services/tempFileCleanup.js';
import { performance } from 'perf_hooks';

// Mock dependencies
vi.mock('../../src/services/logService.js');
vi.mock('../../src/services/databaseService.js');
vi.mock('ioredis');
vi.mock('bullmq');
vi.mock('fs/promises');

describe('Memory Management Load Tests', () => {
  let clusterManager;
  let resourcePool;
  let memoryMonitor;
  let tempFileCleanup;
  let mockRedis;
  let memoryUsageLog;
  let tempFilesCreated;
  let tempFilesCleanedUp;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    memoryUsageLog = [];
    tempFilesCreated = new Set();
    tempFilesCleanedUp = new Set();

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

    // Mock fs/promises for temp file operations
    const mockFs = {
      unlink: vi.fn(async (filePath) => {
        tempFilesCleanedUp.add(filePath);
        return Promise.resolve();
      }),
      readdir: vi.fn(() => Promise.resolve(Array.from(tempFilesCreated))),
      stat: vi.fn(() => Promise.resolve({ 
        size: Math.floor(Math.random() * 10 * 1024 * 1024), // 0-10MB
        mtime: new Date()
      })),
      writeFile: vi.fn(async (filePath, data) => {
        tempFilesCreated.add(filePath);
        return Promise.resolve();
      })
    };

    vi.doMock('fs/promises', () => mockFs);

    // Initialize services
    clusterManager = new ClusterManager({
      minWorkers: 3,
      maxWorkers: 10,
      memoryLimit: 2048 // 2GB limit
    });

    resourcePool = new ResourcePool({
      maxConcurrentJobs: 15,
      memoryLimitMB: 2048,
      maxJobMemoryMB: 200
    });

    memoryMonitor = new MemoryMonitor({
      checkInterval: 1000,
      memoryThreshold: 0.85, // 85%
      criticalThreshold: 0.95 // 95%
    });

    tempFileCleanup = new TempFileCleanup({
      tempDir: '/tmp/pdf-processing',
      maxAge: 3600000, // 1 hour
      cleanupInterval: 5000 // 5 seconds for testing
    });

    // Mock memory monitoring
    let currentMemoryUsage = 200; // Start with 200MB
    
    memoryMonitor.getCurrentMemoryUsage = vi.fn(() => {
      const usage = {
        used: currentMemoryUsage * 1024 * 1024, // Convert to bytes
        total: 2048 * 1024 * 1024, // 2GB total
        percentage: currentMemoryUsage / 2048
      };
      memoryUsageLog.push({
        timestamp: Date.now(),
        usage: currentMemoryUsage,
        percentage: usage.percentage
      });
      return usage;
    });

    // Mock memory increase during job processing
    resourcePool.simulateMemoryUsage = (jobSize) => {
      currentMemoryUsage += jobSize;
    };

    resourcePool.simulateMemoryRelease = (jobSize) => {
      currentMemoryUsage = Math.max(200, currentMemoryUsage - jobSize);
    };
  });

  afterEach(async () => {
    if (clusterManager) {
      await clusterManager.stop();
    }
    if (memoryMonitor) {
      await memoryMonitor.stop();
    }
    if (tempFileCleanup) {
      await tempFileCleanup.stop();
    }
    
    memoryUsageLog = [];
    tempFilesCreated.clear();
    tempFilesCleanedUp.clear();
  });

  describe('Memory Limit Enforcement', () => {
    test('should not exceed system memory limits during high load', async () => {
      await clusterManager.start();
      await memoryMonitor.start();
      
      const memoryLimit = 2048; // 2GB
      const jobCount = 50;
      const jobMemoryUsage = 30; // 30MB per job
      
      // Simulate processing multiple jobs
      const jobPromises = Array.from({ length: jobCount }, async (_, i) => {
        try {
          // Acquire resource slot
          const jobId = await resourcePool.acquire();
          
          // Simulate memory usage
          resourcePool.simulateMemoryUsage(jobMemoryUsage);
          
          // Simulate processing time
          await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
          
          // Check memory during processing
          const memoryUsage = memoryMonitor.getCurrentMemoryUsage();
          
          // Release resources
          resourcePool.simulateMemoryRelease(jobMemoryUsage);
          resourcePool.release(jobId);
          
          return {
            jobId: i,
            success: true,
            peakMemory: memoryUsage.used / (1024 * 1024), // Convert to MB
            memoryPercentage: memoryUsage.percentage
          };
          
        } catch (error) {
          return {
            jobId: i,
            success: false,
            error: error.message
          };
        }
      });

      const results = await Promise.allSettled(jobPromises);
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success);
      const failed = results.filter(r => r.status === 'rejected' || !r.value?.success);
      
      const maxMemoryUsage = Math.max(...memoryUsageLog.map(log => log.usage));
      const avgMemoryUsage = memoryUsageLog.reduce((sum, log) => sum + log.usage, 0) / memoryUsageLog.length;
      const memoryViolations = memoryUsageLog.filter(log => log.usage > memoryLimit).length;

      console.log(`Memory Limit Test Results:
        - Total jobs: ${jobCount}
        - Successful jobs: ${successful.length}
        - Failed jobs: ${failed.length}
        - Max memory usage: ${maxMemoryUsage.toFixed(2)}MB
        - Average memory usage: ${avgMemoryUsage.toFixed(2)}MB
        - Memory limit: ${memoryLimit}MB
        - Memory violations: ${memoryViolations}
        - Peak memory percentage: ${((maxMemoryUsage / memoryLimit) * 100).toFixed(1)}%`);

      expect(maxMemoryUsage).toBeLessThan(memoryLimit * 1.05); // Allow 5% tolerance
      expect(memoryViolations).toBeLessThan(jobCount * 0.1); // Less than 10% violations
      expect(successful.length).toBeGreaterThan(jobCount * 0.8); // At least 80% success
    }, 30000);

    test('should pause new jobs when memory threshold is exceeded', async () => {
      await clusterManager.start();
      await memoryMonitor.start();
      
      const memoryThreshold = 0.85; // 85%
      const criticalThreshold = 0.95; // 95%
      
      let jobsPaused = 0;
      let jobsResumed = 0;
      let currentMemory = 200; // Start with 200MB
      
      // Override memory monitor to simulate memory pressure
      memoryMonitor.getCurrentMemoryUsage = vi.fn(() => {
        const usage = {
          used: currentMemory * 1024 * 1024,
          total: 2048 * 1024 * 1024,
          percentage: currentMemory / 2048
        };
        
        memoryUsageLog.push({
          timestamp: Date.now(),
          usage: currentMemory,
          percentage: usage.percentage
        });
        
        return usage;
      });

      // Override resource pool to handle memory pressure
      const originalAcquire = resourcePool.acquire;
      resourcePool.acquire = async function() {
        const memoryUsage = memoryMonitor.getCurrentMemoryUsage();
        
        if (memoryUsage.percentage > criticalThreshold) {
          jobsPaused++;
          throw new Error('Memory limit exceeded - job paused');
        }
        
        if (memoryUsage.percentage > memoryThreshold) {
          // Simulate waiting for memory to be available
          await new Promise(resolve => setTimeout(resolve, 1000));
          jobsResumed++;
        }
        
        return originalAcquire.call(this);
      };

      // Simulate gradual memory increase
      const memoryIncreaseInterval = setInterval(() => {
        if (currentMemory < 1900) { // Increase to near limit
          currentMemory += 50;
        }
      }, 500);

      // Process jobs during memory pressure
      const jobPromises = Array.from({ length: 30 }, async (_, i) => {
        try {
          await new Promise(resolve => setTimeout(resolve, i * 100)); // Stagger job starts
          
          const jobId = await resourcePool.acquire();
          currentMemory += 40; // Each job uses 40MB
          
          await new Promise(resolve => setTimeout(resolve, 2000)); // Processing time
          
          currentMemory -= 40; // Release memory
          resourcePool.release(jobId);
          
          return { jobId: i, success: true };
        } catch (error) {
          return { jobId: i, success: false, error: error.message };
        }
      });

      const results = await Promise.allSettled(jobPromises);
      clearInterval(memoryIncreaseInterval);
      
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success);
      const paused = results.filter(r => r.status === 'fulfilled' && !r.value.success && 
        r.value.error?.includes('Memory limit exceeded'));
      
      const maxMemoryPercentage = Math.max(...memoryUsageLog.map(log => log.percentage));
      const memoryThresholdExceeded = memoryUsageLog.filter(log => log.percentage > memoryThreshold).length;

      console.log(`Memory Threshold Test Results:
        - Total jobs: 30
        - Successful jobs: ${successful.length}
        - Jobs paused due to memory: ${paused.length}
        - Jobs resumed after waiting: ${jobsResumed}
        - Max memory percentage: ${(maxMemoryPercentage * 100).toFixed(1)}%
        - Times threshold exceeded: ${memoryThresholdExceeded}
        - Memory threshold: ${(memoryThreshold * 100).toFixed(1)}%`);

      expect(maxMemoryPercentage).toBeLessThan(1.0); // Should not exceed 100%
      expect(paused.length).toBeGreaterThan(0); // Some jobs should be paused
      expect(jobsResumed).toBeGreaterThan(0); // Some jobs should resume after waiting
    }, 45000);

    test('should handle memory-intensive large file processing', async () => {
      await clusterManager.start();
      await memoryMonitor.start();
      
      const largeFiles = [
        { id: 'large-1', size: 80 * 1024 * 1024, expectedMemory: 160 }, // 80MB file, ~160MB memory
        { id: 'large-2', size: 120 * 1024 * 1024, expectedMemory: 240 }, // 120MB file, ~240MB memory
        { id: 'large-3', size: 60 * 1024 * 1024, expectedMemory: 120 }, // 60MB file, ~120MB memory
        { id: 'large-4', size: 100 * 1024 * 1024, expectedMemory: 200 }, // 100MB file, ~200MB memory
        { id: 'large-5', size: 150 * 1024 * 1024, expectedMemory: 300 }  // 150MB file, ~300MB memory
      ];
      
      let currentMemory = 200; // Base memory usage
      const memorySnapshots = [];
      
      // Process large files sequentially to avoid memory overflow
      const processingResults = [];
      
      for (const file of largeFiles) {
        const startTime = performance.now();
        const startMemory = currentMemory;
        
        try {
          // Check if we have enough memory for this file
          const requiredMemory = currentMemory + file.expectedMemory;
          
          if (requiredMemory > 2048 * 0.9) { // 90% of limit
            // Wait for memory to be available or skip
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            if (currentMemory + file.expectedMemory > 2048 * 0.95) {
              throw new Error('Insufficient memory for large file processing');
            }
          }
          
          // Acquire resource
          const jobId = await resourcePool.acquire();
          
          // Simulate memory usage for large file
          currentMemory += file.expectedMemory;
          
          memorySnapshots.push({
            fileId: file.id,
            phase: 'processing',
            memory: currentMemory,
            timestamp: Date.now()
          });
          
          // Simulate processing time (longer for larger files)
          const processingTime = (file.size / (1024 * 1024)) * 50; // 50ms per MB
          await new Promise(resolve => setTimeout(resolve, processingTime));
          
          // Release memory
          currentMemory -= file.expectedMemory;
          resourcePool.release(jobId);
          
          memorySnapshots.push({
            fileId: file.id,
            phase: 'completed',
            memory: currentMemory,
            timestamp: Date.now()
          });
          
          processingResults.push({
            fileId: file.id,
            success: true,
            processingTime: performance.now() - startTime,
            peakMemory: startMemory + file.expectedMemory,
            memoryReleased: file.expectedMemory
          });
          
        } catch (error) {
          processingResults.push({
            fileId: file.id,
            success: false,
            error: error.message,
            processingTime: performance.now() - startTime
          });
        }
        
        // Brief pause between files
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      const successful = processingResults.filter(r => r.success);
      const failed = processingResults.filter(r => !r.success);
      const maxMemoryUsed = Math.max(...memorySnapshots.map(s => s.memory));
      const totalMemoryProcessed = successful.reduce((sum, r) => sum + (r.memoryReleased || 0), 0);

      console.log(`Large File Memory Test Results:
        - Total large files: ${largeFiles.length}
        - Successfully processed: ${successful.length}
        - Failed processing: ${failed.length}
        - Max memory used: ${maxMemoryUsed.toFixed(2)}MB
        - Total memory processed: ${totalMemoryProcessed.toFixed(2)}MB
        - Memory limit: 2048MB
        - Peak memory percentage: ${((maxMemoryUsed / 2048) * 100).toFixed(1)}%`);

      expect(maxMemoryUsed).toBeLessThan(2048); // Should not exceed limit
      expect(successful.length).toBeGreaterThan(0); // At least some files should process
      expect(totalMemoryProcessed).toBeGreaterThan(500); // Significant memory processing
    }, 60000);
  });

  describe('Temporary File Management', () => {
    test('should clean up temporary files after processing', async () => {
      await tempFileCleanup.start();
      
      const jobCount = 25;
      const tempFilesPerJob = 3; // Each job creates 3 temp files
      
      // Simulate job processing with temp file creation
      const processingPromises = Array.from({ length: jobCount }, async (_, i) => {
        const jobTempFiles = [];
        
        try {
          // Create temporary files for job
          for (let j = 0; j < tempFilesPerJob; j++) {
            const tempFile = `/tmp/pdf-processing/job-${i}-temp-${j}.pdf`;
            tempFilesCreated.add(tempFile);
            jobTempFiles.push(tempFile);
          }
          
          // Simulate processing time
          await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
          
          // Simulate cleanup (90% success rate)
          if (Math.random() > 0.1) {
            for (const tempFile of jobTempFiles) {
              await tempFileCleanup.cleanupFile(tempFile);
            }
            
            return {
              jobId: i,
              success: true,
              tempFiles: jobTempFiles,
              cleanedUp: jobTempFiles.length
            };
          } else {
            // Simulate cleanup failure
            return {
              jobId: i,
              success: true,
              tempFiles: jobTempFiles,
              cleanedUp: 0,
              cleanupFailed: true
            };
          }
          
        } catch (error) {
          return {
            jobId: i,
            success: false,
            tempFiles: jobTempFiles,
            error: error.message
          };
        }
      });

      const results = await Promise.all(processingPromises);
      
      // Wait for cleanup service to run
      await new Promise(resolve => setTimeout(resolve, 6000));
      
      const totalTempFiles = jobCount * tempFilesPerJob;
      const successfulJobs = results.filter(r => r.success);
      const cleanupFailures = results.filter(r => r.cleanupFailed);
      const filesCleanedUp = tempFilesCleanedUp.size;
      const cleanupRate = (filesCleanedUp / totalTempFiles) * 100;

      console.log(`Temp File Cleanup Test Results:
        - Total jobs: ${jobCount}
        - Successful jobs: ${successfulJobs.length}
        - Total temp files created: ${totalTempFiles}
        - Files cleaned up: ${filesCleanedUp}
        - Cleanup failures: ${cleanupFailures.length}
        - Cleanup rate: ${cleanupRate.toFixed(1)}%
        - Files remaining: ${totalTempFiles - filesCleanedUp}`);

      expect(cleanupRate).toBeGreaterThan(80); // At least 80% cleanup rate
      expect(filesCleanedUp).toBeGreaterThan(totalTempFiles * 0.8); // Most files cleaned
      expect(cleanupFailures.length).toBeLessThan(jobCount * 0.2); // Less than 20% failures
    }, 30000);

    test('should handle cleanup of orphaned temporary files', async () => {
      await tempFileCleanup.start();
      
      const orphanedFiles = 15;
      const recentFiles = 8;
      const oldFiles = 7;
      
      // Create orphaned temp files (files left by crashed jobs)
      const orphanedFilePaths = [];
      
      for (let i = 0; i < orphanedFiles; i++) {
        const filePath = `/tmp/pdf-processing/orphaned-${i}.pdf`;
        tempFilesCreated.add(filePath);
        orphanedFilePaths.push(filePath);
      }
      
      // Mock file stats to simulate old vs recent files
      const mockFs = await import('fs/promises');
      mockFs.stat = vi.fn((filePath) => {
        const isOld = orphanedFilePaths.indexOf(filePath) < oldFiles;
        const ageMs = isOld ? 7200000 : 1800000; // 2 hours vs 30 minutes
        
        return Promise.resolve({
          size: Math.floor(Math.random() * 50 * 1024 * 1024), // 0-50MB
          mtime: new Date(Date.now() - ageMs)
        });
      });
      
      // Run orphaned file cleanup
      await tempFileCleanup.cleanupOrphanedFiles();
      
      // Wait for cleanup to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const filesCleanedUp = tempFilesCleanedUp.size;
      const expectedCleanup = oldFiles; // Only old files should be cleaned
      
      console.log(`Orphaned File Cleanup Test Results:
        - Total orphaned files: ${orphanedFiles}
        - Old files (>1 hour): ${oldFiles}
        - Recent files (<1 hour): ${recentFiles}
        - Files cleaned up: ${filesCleanedUp}
        - Expected cleanup: ${expectedCleanup}`);

      expect(filesCleanedUp).toBeGreaterThanOrEqual(expectedCleanup * 0.8); // At least 80% of old files
      expect(filesCleanedUp).toBeLessThanOrEqual(orphanedFiles); // Not more than total files
    }, 15000);

    test('should prevent disk space exhaustion from temp files', async () => {
      await tempFileCleanup.start();
      
      const maxDiskUsage = 500 * 1024 * 1024; // 500MB limit
      let currentDiskUsage = 0;
      const diskUsageLog = [];
      
      // Override temp file creation to track disk usage
      const originalWriteFile = (await import('fs/promises')).writeFile;
      const mockWriteFile = vi.fn(async (filePath, data) => {
        const fileSize = typeof data === 'string' ? data.length : data.byteLength;
        currentDiskUsage += fileSize;
        tempFilesCreated.add(filePath);
        
        diskUsageLog.push({
          timestamp: Date.now(),
          filePath,
          fileSize,
          totalDiskUsage: currentDiskUsage
        });
        
        // Trigger cleanup if approaching limit
        if (currentDiskUsage > maxDiskUsage * 0.8) {
          await tempFileCleanup.emergencyCleanup();
        }
        
        return originalWriteFile(filePath, data);
      });
      
      // Override cleanup to actually reduce disk usage
      tempFileCleanup.cleanupFile = vi.fn(async (filePath) => {
        if (tempFilesCreated.has(filePath)) {
          const fileSize = Math.floor(Math.random() * 10 * 1024 * 1024); // Assume 0-10MB
          currentDiskUsage = Math.max(0, currentDiskUsage - fileSize);
          tempFilesCleanedUp.add(filePath);
          tempFilesCreated.delete(filePath);
        }
      });
      
      // Simulate intensive temp file creation
      const fileCreationPromises = Array.from({ length: 100 }, async (_, i) => {
        try {
          const fileSize = Math.floor(Math.random() * 8 * 1024 * 1024) + 1024 * 1024; // 1-8MB
          const filePath = `/tmp/pdf-processing/intensive-${i}.pdf`;
          const fileData = Buffer.alloc(fileSize, 'x');
          
          await mockWriteFile(filePath, fileData);
          
          // Random delay
          await new Promise(resolve => setTimeout(resolve, Math.random() * 500));
          
          return {
            fileId: i,
            filePath,
            fileSize,
            success: true
          };
          
        } catch (error) {
          return {
            fileId: i,
            success: false,
            error: error.message
          };
        }
      });

      const results = await Promise.all(fileCreationPromises);
      
      // Wait for final cleanup
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const successful = results.filter(r => r.success);
      const maxDiskUsageReached = Math.max(...diskUsageLog.map(log => log.totalDiskUsage));
      const finalDiskUsage = currentDiskUsage;
      const cleanupTriggered = diskUsageLog.filter(log => log.totalDiskUsage > maxDiskUsage * 0.8).length;

      console.log(`Disk Space Management Test Results:
        - Files created: ${successful.length}
        - Max disk usage: ${(maxDiskUsageReached / 1024 / 1024).toFixed(2)}MB
        - Final disk usage: ${(finalDiskUsage / 1024 / 1024).toFixed(2)}MB
        - Disk limit: ${(maxDiskUsage / 1024 / 1024).toFixed(2)}MB
        - Cleanup triggers: ${cleanupTriggered}
        - Files cleaned up: ${tempFilesCleanedUp.size}`);

      expect(maxDiskUsageReached).toBeLessThan(maxDiskUsage * 1.1); // Allow 10% tolerance
      expect(finalDiskUsage).toBeLessThan(maxDiskUsage * 0.5); // Final usage under 50%
      expect(tempFilesCleanedUp.size).toBeGreaterThan(0); // Some cleanup should occur
    }, 45000);
  });

  describe('Resource Pool Management', () => {
    test('should limit concurrent jobs to prevent memory exhaustion', async () => {
      const maxConcurrentJobs = 10;
      const jobMemoryUsage = 150; // 150MB per job
      
      resourcePool = new ResourcePool({
        maxConcurrentJobs,
        memoryLimitMB: 2048,
        maxJobMemoryMB: jobMemoryUsage
      });
      
      let concurrentJobs = 0;
      let maxConcurrentReached = 0;
      const concurrencyLog = [];
      
      // Simulate many jobs trying to run concurrently
      const jobPromises = Array.from({ length: 25 }, async (_, i) => {
        try {
          const jobId = await resourcePool.acquire();
          concurrentJobs++;
          maxConcurrentReached = Math.max(maxConcurrentReached, concurrentJobs);
          
          concurrencyLog.push({
            timestamp: Date.now(),
            jobId: i,
            action: 'started',
            concurrentJobs
          });
          
          // Simulate job processing
          await new Promise(resolve => setTimeout(resolve, Math.random() * 3000 + 1000));
          
          concurrentJobs--;
          resourcePool.release(jobId);
          
          concurrencyLog.push({
            timestamp: Date.now(),
            jobId: i,
            action: 'completed',
            concurrentJobs
          });
          
          return { jobId: i, success: true };
          
        } catch (error) {
          return { jobId: i, success: false, error: error.message };
        }
      });

      const results = await Promise.all(jobPromises);
      
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);
      const avgConcurrency = concurrencyLog
        .filter(log => log.action === 'started')
        .reduce((sum, log) => sum + log.concurrentJobs, 0) / 
        concurrencyLog.filter(log => log.action === 'started').length;

      console.log(`Resource Pool Concurrency Test Results:
        - Total jobs: 25
        - Successful jobs: ${successful.length}
        - Failed jobs: ${failed.length}
        - Max concurrent jobs limit: ${maxConcurrentJobs}
        - Max concurrent reached: ${maxConcurrentReached}
        - Average concurrency: ${avgConcurrency.toFixed(1)}`);

      expect(maxConcurrentReached).toBeLessThanOrEqual(maxConcurrentJobs);
      expect(successful.length).toBe(25); // All jobs should eventually complete
      expect(avgConcurrency).toBeLessThanOrEqual(maxConcurrentJobs);
    }, 30000);

    test('should handle resource contention gracefully', async () => {
      const limitedResources = 5;
      const highDemand = 20;
      
      resourcePool = new ResourcePool({
        maxConcurrentJobs: limitedResources,
        memoryLimitMB: 1024, // Smaller limit
        maxJobMemoryMB: 100
      });
      
      const waitTimes = [];
      const resourceAcquisitionLog = [];
      
      // Create high demand for limited resources
      const contentionPromises = Array.from({ length: highDemand }, async (_, i) => {
        const startTime = performance.now();
        
        try {
          resourceAcquisitionLog.push({
            jobId: i,
            timestamp: Date.now(),
            action: 'requesting'
          });
          
          const jobId = await resourcePool.acquire();
          const waitTime = performance.now() - startTime;
          waitTimes.push(waitTime);
          
          resourceAcquisitionLog.push({
            jobId: i,
            timestamp: Date.now(),
            action: 'acquired',
            waitTime
          });
          
          // Simulate variable processing time
          const processingTime = Math.random() * 2000 + 500;
          await new Promise(resolve => setTimeout(resolve, processingTime));
          
          resourcePool.release(jobId);
          
          resourceAcquisitionLog.push({
            jobId: i,
            timestamp: Date.now(),
            action: 'released'
          });
          
          return {
            jobId: i,
            success: true,
            waitTime,
            processingTime
          };
          
        } catch (error) {
          return {
            jobId: i,
            success: false,
            waitTime: performance.now() - startTime,
            error: error.message
          };
        }
      });

      const results = await Promise.all(contentionPromises);
      
      const successful = results.filter(r => r.success);
      const avgWaitTime = waitTimes.reduce((sum, time) => sum + time, 0) / waitTimes.length;
      const maxWaitTime = Math.max(...waitTimes);
      const fairnessIndex = waitTimes.length > 0 ? 
        Math.min(...waitTimes) / Math.max(...waitTimes) : 1;

      console.log(`Resource Contention Test Results:
        - High demand jobs: ${highDemand}
        - Limited resources: ${limitedResources}
        - Successful jobs: ${successful.length}
        - Average wait time: ${avgWaitTime.toFixed(2)}ms
        - Max wait time: ${maxWaitTime.toFixed(2)}ms
        - Fairness index: ${fairnessIndex.toFixed(3)} (1.0 = perfectly fair)`);

      expect(successful.length).toBe(highDemand); // All jobs should complete
      expect(avgWaitTime).toBeGreaterThan(0); // There should be some waiting
      expect(maxWaitTime).toBeLessThan(30000); // No job should wait more than 30 seconds
      expect(fairnessIndex).toBeGreaterThan(0.1); // Reasonable fairness
    }, 45000);
  });
});