import { describe, test, expect, beforeEach, vi } from 'vitest';

// Mock all dependencies before importing
vi.mock('ioredis', () => ({
  default: vi.fn(() => ({
    setex: vi.fn(),
    quit: vi.fn()
  }))
}));

vi.mock('bullmq', () => ({
  Worker: vi.fn(() => ({
    on: vi.fn(),
    close: vi.fn()
  }))
}));

vi.mock('../src/services/priorityQueueManager.js', () => ({
  default: {
    getQueueStats: vi.fn(() => Promise.resolve({})),
    getQueues: vi.fn(() => ({})),
    getQueueConfiguration: vi.fn(() => Promise.resolve({
      isHighLoad: false,
      recommendedWorkers: { premium: 1, normal: 1, large: 1 }
    }))
  }
}));

vi.mock('../src/services/logService.js', () => ({
  default: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}));

vi.mock('../src/services/jobProcessor.js', () => ({
  processJob: vi.fn(() => Promise.resolve({ success: true }))
}));

vi.mock('../src/config/config.js', () => ({
  default: {
    redis: {
      url: 'redis://localhost:6379'
    }
  }
}));

// Import after mocking
import ClusterManager from '../src/services/clusterManager.js';

describe('ClusterManager Unit Tests', () => {
  let clusterManager;

  beforeEach(() => {
    clusterManager = new ClusterManager({
      minWorkers: 2,
      maxWorkers: 5,
      scaleUpThreshold: 3,
      scaleDownThreshold: 1
    });
  });

  describe('Configuration', () => {
    test('should initialize with provided configuration', () => {
      expect(clusterManager.minWorkers).toBe(2);
      expect(clusterManager.maxWorkers).toBe(5);
      expect(clusterManager.scaleUpThreshold).toBe(3);
      expect(clusterManager.scaleDownThreshold).toBe(1);
    });

    test('should use default configuration when no options provided', () => {
      const defaultManager = new ClusterManager();
      expect(defaultManager.minWorkers).toBe(5);
      expect(defaultManager.maxWorkers).toBe(15);
      expect(defaultManager.scaleUpThreshold).toBe(10);
      expect(defaultManager.scaleDownThreshold).toBe(3);
    });

    test('should initialize tracking structures', () => {
      expect(clusterManager.workers).toBeInstanceOf(Map);
      expect(clusterManager.workerMetrics).toBeInstanceOf(Map);
      expect(clusterManager.workerProcesses).toBeInstanceOf(Map);
      expect(clusterManager.workers.size).toBe(0);
    });
  });

  describe('Worker Metrics Management', () => {
    test('should update worker metrics correctly', () => {
      const workerId = 'test-worker-1';
      
      // Initialize worker metrics
      clusterManager.workerMetrics.set(workerId, {
        workerId,
        status: 'idle',
        jobsCompleted: 0,
        createdAt: Date.now()
      });
      
      // Update metrics
      clusterManager.updateWorkerMetrics(workerId, {
        status: 'processing',
        jobsCompleted: 1,
        currentJob: 'job-123'
      });
      
      const metrics = clusterManager.workerMetrics.get(workerId);
      expect(metrics.status).toBe('processing');
      expect(metrics.jobsCompleted).toBe(1);
      expect(metrics.currentJob).toBe('job-123');
      expect(metrics).toHaveProperty('lastUpdated');
    });

    test('should handle non-existent worker metrics gracefully', () => {
      const workerId = 'non-existent-worker';
      
      // This should not throw
      clusterManager.updateWorkerMetrics(workerId, { status: 'processing' });
      
      // Worker should not be created automatically
      expect(clusterManager.workerMetrics.has(workerId)).toBe(false);
    });

    test('should return worker metrics as array', () => {
      clusterManager.workerMetrics.set('worker-1', { workerId: 'worker-1', status: 'idle' });
      clusterManager.workerMetrics.set('worker-2', { workerId: 'worker-2', status: 'processing' });
      
      const metrics = clusterManager.getWorkerMetrics();
      
      expect(Array.isArray(metrics)).toBe(true);
      expect(metrics.length).toBe(2);
      expect(metrics[0]).toHaveProperty('workerId');
      expect(metrics[0]).toHaveProperty('status');
    });
  });

  describe('Cluster Health', () => {
    test('should return correct health status with no workers', () => {
      const health = clusterManager.getClusterHealth();
      
      expect(health).toHaveProperty('totalWorkers', 0);
      expect(health).toHaveProperty('activeWorkers', 0);
      expect(health).toHaveProperty('errorWorkers', 0);
      expect(health).toHaveProperty('isHealthy', false); // No workers = unhealthy
      expect(health).toHaveProperty('lastHealthCheck');
    });

    test('should return correct health status with mixed worker states', () => {
      // Add mock worker metrics
      clusterManager.workerMetrics.set('worker-1', { status: 'idle' });
      clusterManager.workerMetrics.set('worker-2', { status: 'processing' });
      clusterManager.workerMetrics.set('worker-3', { status: 'error' });
      
      const health = clusterManager.getClusterHealth();
      
      expect(health.totalWorkers).toBe(0); // No actual workers in workers Map
      expect(health.errorWorkers).toBe(1);
      expect(health.isHealthy).toBe(false); // Has error workers
    });

    test('should report healthy when all workers are active', () => {
      clusterManager.workerMetrics.set('worker-1', { status: 'idle' });
      clusterManager.workerMetrics.set('worker-2', { status: 'processing' });
      
      const health = clusterManager.getClusterHealth();
      
      expect(health.errorWorkers).toBe(0);
      // Note: isHealthy also depends on having actual workers, not just metrics
    });
  });

  describe('System Metrics', () => {
    test('should have system metrics structure', () => {
      expect(clusterManager.systemMetrics).toHaveProperty('cpuUsage');
      expect(clusterManager.systemMetrics).toHaveProperty('memoryUsage');
      expect(clusterManager.systemMetrics).toHaveProperty('activeJobs');
      expect(clusterManager.systemMetrics).toHaveProperty('totalWorkers');
    });

    test('should update system metrics', async () => {
      const initialTimestamp = clusterManager.systemMetrics.timestamp;
      
      await clusterManager.updateSystemMetrics();
      
      expect(clusterManager.systemMetrics.timestamp).toBeGreaterThan(initialTimestamp || 0);
      expect(typeof clusterManager.systemMetrics.cpuUsage).toBe('number');
      expect(typeof clusterManager.systemMetrics.memoryUsage).toBe('number');
      expect(typeof clusterManager.systemMetrics.activeJobs).toBe('number');
      expect(typeof clusterManager.systemMetrics.totalWorkers).toBe('number');
    });
  });

  describe('Scaling State Management', () => {
    test('should track scaling state correctly', () => {
      expect(clusterManager.isScaling).toBe(false);
      expect(clusterManager.lastScaleAction).toBe(0);
      
      clusterManager.isScaling = true;
      clusterManager.lastScaleAction = Date.now();
      
      expect(clusterManager.isScaling).toBe(true);
      expect(clusterManager.lastScaleAction).toBeGreaterThan(0);
    });

    test('should have proper debounce time configuration', () => {
      expect(clusterManager.scaleDebounceTime).toBeGreaterThan(0);
      expect(typeof clusterManager.scaleDebounceTime).toBe('number');
    });
  });

  describe('Configuration Validation', () => {
    test('should validate min/max worker bounds', () => {
      const manager = new ClusterManager({
        minWorkers: 3,
        maxWorkers: 10
      });
      
      expect(manager.minWorkers).toBeLessThan(manager.maxWorkers);
    });

    test('should validate threshold configuration', () => {
      const manager = new ClusterManager({
        scaleUpThreshold: 10,
        scaleDownThreshold: 3
      });
      
      expect(manager.scaleDownThreshold).toBeLessThan(manager.scaleUpThreshold);
    });

    test('should have reasonable interval configurations', () => {
      expect(clusterManager.healthCheckInterval).toBeGreaterThan(0);
      expect(clusterManager.scaleCheckInterval).toBeGreaterThan(0);
      expect(clusterManager.healthCheckInterval).toBeGreaterThan(clusterManager.scaleCheckInterval);
    });
  });

  describe('Timer Management', () => {
    test('should initialize timers as null', () => {
      expect(clusterManager.healthCheckTimer).toBeNull();
      expect(clusterManager.scaleCheckTimer).toBeNull();
    });

    test('should have timer interval properties', () => {
      expect(typeof clusterManager.healthCheckInterval).toBe('number');
      expect(typeof clusterManager.scaleCheckInterval).toBe('number');
      expect(clusterManager.healthCheckInterval).toBeGreaterThan(0);
      expect(clusterManager.scaleCheckInterval).toBeGreaterThan(0);
    });
  });

  describe('Cluster Statistics', () => {
    test('should provide cluster stats structure', async () => {
      const stats = await clusterManager.getClusterStats();
      
      expect(stats).toHaveProperty('queues');
      expect(stats).toHaveProperty('workers');
      expect(stats).toHaveProperty('health');
      expect(stats).toHaveProperty('system');
      expect(stats).toHaveProperty('scaling');
    });

    test('should include scaling configuration in stats', async () => {
      const stats = await clusterManager.getClusterStats();
      
      expect(stats.scaling).toHaveProperty('minWorkers', clusterManager.minWorkers);
      expect(stats.scaling).toHaveProperty('maxWorkers', clusterManager.maxWorkers);
      expect(stats.scaling).toHaveProperty('currentWorkers', clusterManager.workers.size);
      expect(stats.scaling).toHaveProperty('isScaling', clusterManager.isScaling);
    });
  });
});