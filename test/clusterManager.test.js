import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import ClusterManager from '../src/services/clusterManager.js';
import priorityQueueManager from '../src/services/priorityQueueManager.js';

// Mock dependencies
vi.mock('../src/services/priorityQueueManager.js');
vi.mock('../src/services/logService.js');
vi.mock('../src/services/jobProcessor.js');
vi.mock('ioredis');
vi.mock('bullmq');

describe('ClusterManager', () => {
  let clusterManager;
  let mockRedis;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Mock Redis
    mockRedis = {
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

    // Initialize cluster manager
    clusterManager = new ClusterManager({
      minWorkers: 2,
      maxWorkers: 5,
      scaleUpThreshold: 3,
      scaleDownThreshold: 1
    });
  });

  afterEach(async () => {
    if (clusterManager) {
      await clusterManager.stop();
    }
  });

  describe('Initialization', () => {
    test('should initialize with correct configuration', () => {
      expect(clusterManager.minWorkers).toBe(2);
      expect(clusterManager.maxWorkers).toBe(5);
      expect(clusterManager.scaleUpThreshold).toBe(3);
      expect(clusterManager.scaleDownThreshold).toBe(1);
    });

    test('should use default configuration when no options provided', () => {
      const defaultManager = new ClusterManager();
      expect(defaultManager.minWorkers).toBe(5);
      expect(defaultManager.maxWorkers).toBe(15);
    });
  });

  describe('Worker Management', () => {
    test('should create worker successfully', async () => {
      const result = await clusterManager.createWorker('pdf-processing-normal');
      
      expect(result).toHaveProperty('workerId');
      expect(result).toHaveProperty('worker');
      expect(clusterManager.workers.size).toBe(1);
      expect(clusterManager.workerMetrics.size).toBe(1);
    });

    test('should remove worker successfully', async () => {
      const { workerId } = await clusterManager.createWorker('pdf-processing-normal');
      
      await clusterManager.removeWorker(workerId);
      
      expect(clusterManager.workers.size).toBe(0);
      expect(clusterManager.workerMetrics.size).toBe(0);
    });

    test('should update worker metrics correctly', async () => {
      const { workerId } = await clusterManager.createWorker('pdf-processing-normal');
      
      clusterManager.updateWorkerMetrics(workerId, {
        status: 'processing',
        currentJob: 'job-123'
      });
      
      const metrics = clusterManager.workerMetrics.get(workerId);
      expect(metrics.status).toBe('processing');
      expect(metrics.currentJob).toBe('job-123');
    });
  });

  describe('Scaling Operations', () => {
    test('should scale up workers correctly', async () => {
      await clusterManager.scaleUp(3);
      
      expect(clusterManager.workers.size).toBe(3);
    });

    test('should scale down workers correctly', async () => {
      // First create some workers
      await clusterManager.scaleUp(4);
      
      // Mark some as idle
      const workerIds = Array.from(clusterManager.workers.keys());
      workerIds.forEach(id => {
        clusterManager.updateWorkerMetrics(id, { status: 'idle', currentJob: null });
      });
      
      await clusterManager.scaleDown(2);
      
      expect(clusterManager.workers.size).toBe(2);
    });

    test('should scale to target number of workers', async () => {
      await clusterManager.scaleToTarget(3);
      expect(clusterManager.workers.size).toBe(3);
      
      await clusterManager.scaleToTarget(1);
      expect(clusterManager.workers.size).toBe(1);
    });

    test('should not scale if already scaling', async () => {
      clusterManager.isScaling = true;
      
      await clusterManager.scaleToTarget(3);
      
      expect(clusterManager.workers.size).toBe(0);
    });
  });

  describe('Health Checks', () => {
    test('should detect stale workers', async () => {
      const { workerId } = await clusterManager.createWorker('pdf-processing-normal');
      
      // Make worker stale
      clusterManager.updateWorkerMetrics(workerId, {
        lastHeartbeat: Date.now() - 120000 // 2 minutes ago
      });
      
      const replaceSpy = vi.spyOn(clusterManager, 'replaceFailedWorker');
      
      await clusterManager.performHealthChecks();
      
      expect(replaceSpy).toHaveBeenCalledWith(workerId);
    });

    test('should detect workers in error state', async () => {
      const { workerId } = await clusterManager.createWorker('pdf-processing-normal');
      
      // Put worker in error state
      clusterManager.updateWorkerMetrics(workerId, {
        status: 'error',
        lastError: 'Test error',
        lastErrorAt: Date.now()
      });
      
      const replaceSpy = vi.spyOn(clusterManager, 'replaceFailedWorker');
      
      await clusterManager.performHealthChecks();
      
      expect(replaceSpy).toHaveBeenCalledWith(workerId);
    });

    test('should replace failed worker', async () => {
      const { workerId } = await clusterManager.createWorker('pdf-processing-normal');
      const initialSize = clusterManager.workers.size;
      
      await clusterManager.replaceFailedWorker(workerId);
      
      expect(clusterManager.workers.size).toBe(initialSize); // Same size, but different worker
      expect(clusterManager.workers.has(workerId)).toBe(false); // Original worker removed
    });
  });

  describe('Auto Scaling', () => {
    beforeEach(() => {
      // Mock priority queue manager
      priorityQueueManager.getQueueStats.mockResolvedValue({
        'pdf-processing-premium': { waiting: 0, active: 0 },
        'pdf-processing-normal': { waiting: 0, active: 0 },
        'pdf-processing-large': { waiting: 0, active: 0 }
      });
    });

    test('should scale up when queue load is high', async () => {
      // Mock high queue load
      priorityQueueManager.getQueueStats.mockResolvedValue({
        'pdf-processing-premium': { waiting: 5, active: 2 },
        'pdf-processing-normal': { waiting: 8, active: 1 },
        'pdf-processing-large': { waiting: 2, active: 0 }
      });
      
      const initialWorkers = clusterManager.workers.size;
      
      await clusterManager.checkAndScale();
      
      expect(clusterManager.workers.size).toBeGreaterThan(initialWorkers);
    });

    test('should scale down when queue load is low', async () => {
      // First create some workers
      await clusterManager.scaleUp(4);
      
      // Mark workers as idle
      const workerIds = Array.from(clusterManager.workers.keys());
      workerIds.forEach(id => {
        clusterManager.updateWorkerMetrics(id, { status: 'idle', currentJob: null });
      });
      
      // Mock low queue load
      priorityQueueManager.getQueueStats.mockResolvedValue({
        'pdf-processing-premium': { waiting: 0, active: 0 },
        'pdf-processing-normal': { waiting: 0, active: 0 },
        'pdf-processing-large': { waiting: 0, active: 0 }
      });
      
      const initialWorkers = clusterManager.workers.size;
      
      await clusterManager.checkAndScale();
      
      expect(clusterManager.workers.size).toBeLessThan(initialWorkers);
    });

    test('should respect min and max worker limits', async () => {
      // Test max limit
      priorityQueueManager.getQueueStats.mockResolvedValue({
        'pdf-processing-premium': { waiting: 50, active: 10 },
        'pdf-processing-normal': { waiting: 50, active: 10 },
        'pdf-processing-large': { waiting: 50, active: 10 }
      });
      
      await clusterManager.checkAndScale();
      
      expect(clusterManager.workers.size).toBeLessThanOrEqual(clusterManager.maxWorkers);
      
      // Test min limit
      await clusterManager.scaleToTarget(clusterManager.minWorkers);
      
      priorityQueueManager.getQueueStats.mockResolvedValue({
        'pdf-processing-premium': { waiting: 0, active: 0 },
        'pdf-processing-normal': { waiting: 0, active: 0 },
        'pdf-processing-large': { waiting: 0, active: 0 }
      });
      
      await clusterManager.checkAndScale();
      
      expect(clusterManager.workers.size).toBeGreaterThanOrEqual(clusterManager.minWorkers);
    });
  });

  describe('Cluster Health', () => {
    test('should return correct health status', async () => {
      await clusterManager.createWorker('pdf-processing-normal');
      await clusterManager.createWorker('pdf-processing-premium');
      
      const health = clusterManager.getClusterHealth();
      
      expect(health).toHaveProperty('totalWorkers', 2);
      expect(health).toHaveProperty('activeWorkers');
      expect(health).toHaveProperty('errorWorkers');
      expect(health).toHaveProperty('isHealthy');
      expect(health).toHaveProperty('lastHealthCheck');
    });

    test('should report unhealthy when workers have errors', async () => {
      const { workerId } = await clusterManager.createWorker('pdf-processing-normal');
      
      clusterManager.updateWorkerMetrics(workerId, { status: 'error' });
      
      const health = clusterManager.getClusterHealth();
      
      expect(health.isHealthy).toBe(false);
      expect(health.errorWorkers).toBe(1);
    });
  });

  describe('System Metrics', () => {
    test('should update system metrics', async () => {
      await clusterManager.updateSystemMetrics();
      
      expect(clusterManager.systemMetrics).toHaveProperty('cpuUsage');
      expect(clusterManager.systemMetrics).toHaveProperty('memoryUsage');
      expect(clusterManager.systemMetrics).toHaveProperty('activeJobs');
      expect(clusterManager.systemMetrics).toHaveProperty('totalWorkers');
      expect(clusterManager.systemMetrics).toHaveProperty('timestamp');
    });

    test('should store metrics in Redis', async () => {
      await clusterManager.updateSystemMetrics();
      
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'cluster:metrics',
        300,
        expect.any(String)
      );
    });
  });

  describe('Cluster Statistics', () => {
    test('should return comprehensive cluster stats', async () => {
      await clusterManager.createWorker('pdf-processing-normal');
      
      priorityQueueManager.getQueueStats.mockResolvedValue({
        'pdf-processing-normal': { waiting: 2, active: 1 }
      });
      
      const stats = await clusterManager.getClusterStats();
      
      expect(stats).toHaveProperty('queues');
      expect(stats).toHaveProperty('workers');
      expect(stats).toHaveProperty('health');
      expect(stats).toHaveProperty('system');
      expect(stats).toHaveProperty('scaling');
    });
  });

  describe('Graceful Shutdown', () => {
    test('should shutdown all workers gracefully', async () => {
      await clusterManager.createWorker('pdf-processing-normal');
      await clusterManager.createWorker('pdf-processing-premium');
      
      expect(clusterManager.workers.size).toBe(2);
      
      await clusterManager.shutdownAllWorkers();
      
      expect(clusterManager.workers.size).toBe(0);
      expect(clusterManager.workerMetrics.size).toBe(0);
    });

    test('should stop all intervals and close Redis connection', async () => {
      await clusterManager.start();
      
      expect(clusterManager.healthCheckTimer).toBeTruthy();
      expect(clusterManager.scaleCheckTimer).toBeTruthy();
      
      await clusterManager.stop();
      
      expect(clusterManager.healthCheckTimer).toBeNull();
      expect(clusterManager.scaleCheckTimer).toBeNull();
      expect(mockRedis.quit).toHaveBeenCalled();
    });
  });
});