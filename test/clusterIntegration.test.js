import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import clusterService from '../src/services/clusterService.js';
import priorityQueueManager from '../src/services/priorityQueueManager.js';

// Mock dependencies
vi.mock('../src/services/priorityQueueManager.js');
vi.mock('../src/services/logService.js');
vi.mock('../src/services/jobProcessor.js');
vi.mock('ioredis');
vi.mock('bullmq');

describe('Cluster Integration Tests', () => {
  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Mock Redis
    const mockRedis = {
      setex: vi.fn(),
      quit: vi.fn()
    };

    // Mock BullMQ Worker
    const mockWorker = {
      on: vi.fn(),
      close: vi.fn()
    };

    vi.doMock('bullmq', () => ({
      Worker: vi.fn(() => mockWorker)
    }));

    vi.doMock('ioredis', () => {
      return vi.fn(() => mockRedis);
    });

    // Mock priority queue manager
    priorityQueueManager.getQueueStats.mockResolvedValue({
      'pdf-processing-premium': { waiting: 0, active: 0, completed: 0, failed: 0 },
      'pdf-processing-normal': { waiting: 0, active: 0, completed: 0, failed: 0 },
      'pdf-processing-large': { waiting: 0, active: 0, completed: 0, failed: 0 }
    });

    priorityQueueManager.addJobByUserId.mockResolvedValue({
      id: 'job-123',
      data: { queueName: 'pdf-processing-normal' }
    });

    priorityQueueManager.cleanup.mockResolvedValue();
  });

  afterEach(async () => {
    await clusterService.shutdown();
  });

  describe('Cluster Service Initialization', () => {
    test('should initialize cluster service successfully', async () => {
      await clusterService.initialize({
        minWorkers: 2,
        maxWorkers: 5
      });

      expect(clusterService.isInitialized).toBe(true);
      
      const health = clusterService.getClusterHealth();
      expect(health.totalWorkers).toBeGreaterThanOrEqual(2);
    });

    test('should not initialize twice', async () => {
      await clusterService.initialize();
      
      // Second initialization should not throw
      await clusterService.initialize();
      
      expect(clusterService.isInitialized).toBe(true);
    });
  });

  describe('Job Processing Integration', () => {
    beforeEach(async () => {
      await clusterService.initialize({
        minWorkers: 2,
        maxWorkers: 5
      });
    });

    test('should add job to cluster successfully', async () => {
      const jobData = {
        tempFilePath: '/tmp/test.pdf',
        originalName: 'test.pdf',
        userId: 'user-123'
      };

      const job = await clusterService.addJob(jobData, 'user-123', 1024);

      expect(job).toHaveProperty('id');
      expect(priorityQueueManager.addJobByUserId).toHaveBeenCalledWith(
        jobData,
        'user-123',
        1024
      );
    });

    test('should fail to add job when not initialized', async () => {
      await clusterService.shutdown();

      await expect(
        clusterService.addJob({}, 'user-123', 1024)
      ).rejects.toThrow('Cluster service not initialized');
    });
  });

  describe('Auto Scaling Integration', () => {
    beforeEach(async () => {
      await clusterService.initialize({
        minWorkers: 2,
        maxWorkers: 8,
        scaleUpThreshold: 5,
        scaleDownThreshold: 2
      });
    });

    test('should auto-scale up under high load', async () => {
      // Mock high load
      priorityQueueManager.getQueueStats.mockResolvedValue({
        'pdf-processing-premium': { waiting: 10, active: 5 },
        'pdf-processing-normal': { waiting: 15, active: 3 },
        'pdf-processing-large': { waiting: 5, active: 1 }
      });

      const initialWorkers = clusterService.getClusterHealth().totalWorkers;

      // Trigger monitoring cycle
      await clusterService.performMonitoringCycle();

      const finalWorkers = clusterService.getClusterHealth().totalWorkers;
      expect(finalWorkers).toBeGreaterThan(initialWorkers);
    });

    test('should auto-scale down under low load', async () => {
      // First scale up
      await clusterService.scaleCluster(6);
      
      // Mock low load
      priorityQueueManager.getQueueStats.mockResolvedValue({
        'pdf-processing-premium': { waiting: 0, active: 0 },
        'pdf-processing-normal': { waiting: 1, active: 0 },
        'pdf-processing-large': { waiting: 0, active: 0 }
      });

      const initialWorkers = clusterService.getClusterHealth().totalWorkers;

      // Trigger monitoring cycle
      await clusterService.performMonitoringCycle();

      const finalWorkers = clusterService.getClusterHealth().totalWorkers;
      expect(finalWorkers).toBeLessThanOrEqual(initialWorkers);
    });

    test('should respect min and max worker limits during auto-scaling', async () => {
      const config = clusterService.config;

      // Test max limit
      priorityQueueManager.getQueueStats.mockResolvedValue({
        'pdf-processing-premium': { waiting: 100, active: 50 },
        'pdf-processing-normal': { waiting: 100, active: 50 },
        'pdf-processing-large': { waiting: 100, active: 50 }
      });

      await clusterService.performMonitoringCycle();

      let workers = clusterService.getClusterHealth().totalWorkers;
      expect(workers).toBeLessThanOrEqual(config.maxWorkers);

      // Test min limit
      priorityQueueManager.getQueueStats.mockResolvedValue({
        'pdf-processing-premium': { waiting: 0, active: 0 },
        'pdf-processing-normal': { waiting: 0, active: 0 },
        'pdf-processing-large': { waiting: 0, active: 0 }
      });

      await clusterService.performMonitoringCycle();

      workers = clusterService.getClusterHealth().totalWorkers;
      expect(workers).toBeGreaterThanOrEqual(config.minWorkers);
    });
  });

  describe('Health Monitoring Integration', () => {
    beforeEach(async () => {
      await clusterService.initialize({
        minWorkers: 3,
        maxWorkers: 6
      });
    });

    test('should maintain healthy cluster state', () => {
      const health = clusterService.getClusterHealth();

      expect(health).toHaveProperty('totalWorkers');
      expect(health).toHaveProperty('activeWorkers');
      expect(health).toHaveProperty('errorWorkers');
      expect(health).toHaveProperty('isHealthy');
      expect(health.totalWorkers).toBeGreaterThan(0);
    });

    test('should provide comprehensive cluster status', async () => {
      const status = await clusterService.getClusterStatus();

      expect(status.status).toBe('running');
      expect(status).toHaveProperty('cluster');
      expect(status).toHaveProperty('loadBalancer');
      expect(status).toHaveProperty('queues');
      expect(status).toHaveProperty('config');
      expect(status).toHaveProperty('timestamp');
    });

    test('should return error status when not initialized', async () => {
      await clusterService.shutdown();

      const status = await clusterService.getClusterStatus();
      expect(status.status).toBe('not_initialized');
    });
  });

  describe('Manual Scaling Integration', () => {
    beforeEach(async () => {
      await clusterService.initialize({
        minWorkers: 2,
        maxWorkers: 10
      });
    });

    test('should scale to target number manually', async () => {
      await clusterService.scaleCluster(5);

      const health = clusterService.getClusterHealth();
      expect(health.totalWorkers).toBe(5);
    });

    test('should reject scaling outside limits', async () => {
      await expect(
        clusterService.scaleCluster(15) // Above max
      ).rejects.toThrow('Target workers must be between');

      await expect(
        clusterService.scaleCluster(1) // Below min
      ).rejects.toThrow('Target workers must be between');
    });

    test('should reject scaling when not initialized', async () => {
      await clusterService.shutdown();

      await expect(
        clusterService.scaleCluster(5)
      ).rejects.toThrow('Cluster service not initialized');
    });
  });

  describe('Configuration Management', () => {
    beforeEach(async () => {
      await clusterService.initialize();
    });

    test('should update configuration successfully', async () => {
      const newConfig = {
        minWorkers: 3,
        maxWorkers: 12,
        scaleUpThreshold: 8
      };

      await clusterService.updateConfiguration(newConfig);

      expect(clusterService.config.minWorkers).toBe(3);
      expect(clusterService.config.maxWorkers).toBe(12);
      expect(clusterService.config.scaleUpThreshold).toBe(8);
    });

    test('should reject invalid configuration', async () => {
      await expect(
        clusterService.updateConfiguration({
          minWorkers: 10,
          maxWorkers: 5 // Invalid: min > max
        })
      ).rejects.toThrow('minWorkers cannot be greater than maxWorkers');
    });
  });

  describe('Failure Recovery Integration', () => {
    beforeEach(async () => {
      await clusterService.initialize({
        minWorkers: 3,
        maxWorkers: 6
      });
    });

    test('should handle worker failure gracefully', async () => {
      const initialHealth = clusterService.getClusterHealth();
      const workerId = 'test-worker-1';

      await clusterService.handleWorkerFailure(workerId);

      // Should not crash and maintain cluster health
      const finalHealth = clusterService.getClusterHealth();
      expect(finalHealth.totalWorkers).toBeGreaterThan(0);
    });

    test('should perform force cleanup', async () => {
      await clusterService.forceCleanup();

      // Should complete without errors
      expect(priorityQueueManager.cleanup).toHaveBeenCalled();
    });
  });

  describe('Metrics Collection Integration', () => {
    beforeEach(async () => {
      await clusterService.initialize();
    });

    test('should collect worker metrics', () => {
      const metrics = clusterService.getWorkerMetrics();

      expect(Array.isArray(metrics)).toBe(true);
      // Should have at least minimum workers
      expect(metrics.length).toBeGreaterThanOrEqual(clusterService.config.minWorkers);
    });

    test('should provide metrics for each worker', () => {
      const metrics = clusterService.getWorkerMetrics();

      if (metrics.length > 0) {
        const worker = metrics[0];
        expect(worker).toHaveProperty('workerId');
        expect(worker).toHaveProperty('queueName');
        expect(worker).toHaveProperty('status');
        expect(worker).toHaveProperty('createdAt');
        expect(worker).toHaveProperty('jobsCompleted');
        expect(worker).toHaveProperty('jobsFailed');
      }
    });
  });

  describe('Graceful Shutdown Integration', () => {
    test('should shutdown gracefully', async () => {
      await clusterService.initialize();
      
      expect(clusterService.isInitialized).toBe(true);

      await clusterService.shutdown();

      expect(clusterService.isInitialized).toBe(false);
    });

    test('should handle multiple shutdown calls', async () => {
      await clusterService.initialize();
      
      await clusterService.shutdown();
      await clusterService.shutdown(); // Should not throw

      expect(clusterService.isInitialized).toBe(false);
    });
  });

  describe('Load Balancer Integration', () => {
    beforeEach(async () => {
      await clusterService.initialize({
        minWorkers: 4,
        maxWorkers: 8
      });
    });

    test('should integrate load balancer recommendations', async () => {
      // Create scenario with mixed worker loads
      const workers = clusterService.getWorkerMetrics();
      
      // Simulate some workers being overloaded
      if (workers.length >= 2) {
        const clusterManager = clusterService.clusterManager;
        
        // Make first worker appear overloaded
        clusterManager.updateWorkerMetrics(workers[0].workerId, {
          avgProcessingTime: 70000, // 70 seconds - overloaded
          status: 'processing'
        });

        // Make second worker appear normal
        clusterManager.updateWorkerMetrics(workers[1].workerId, {
          avgProcessingTime: 30000, // 30 seconds - normal
          status: 'idle'
        });
      }

      const initialWorkers = clusterService.getClusterHealth().totalWorkers;

      // Trigger monitoring which should use load balancer recommendations
      await clusterService.performMonitoringCycle();

      // Should maintain or increase workers due to overloaded worker
      const finalWorkers = clusterService.getClusterHealth().totalWorkers;
      expect(finalWorkers).toBeGreaterThanOrEqual(initialWorkers);
    });
  });
});