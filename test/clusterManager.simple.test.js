import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// Simple test to verify ClusterManager core functionality
describe('ClusterManager Core Functionality', () => {
  let ClusterManager;

  beforeEach(async () => {
    // Mock all external dependencies
    vi.doMock('ioredis', () => {
      return vi.fn(() => ({
        setex: vi.fn(),
        quit: vi.fn()
      }));
    });

    vi.doMock('bullmq', () => ({
      Worker: vi.fn(() => ({
        on: vi.fn(),
        close: vi.fn()
      }))
    }));

    vi.doMock('../src/services/priorityQueueManager.js', () => ({
      default: {
        getQueueStats: vi.fn(() => Promise.resolve({})),
        getQueues: vi.fn(() => ({})),
        getQueueConfiguration: vi.fn(() => Promise.resolve({
          isHighLoad: false,
          recommendedWorkers: { premium: 1, normal: 1, large: 1 }
        }))
      }
    }));

    vi.doMock('../src/services/logService.js', () => ({
      default: {
        log: vi.fn(),
        error: vi.fn(),
        warn: vi.fn()
      }
    }));

    vi.doMock('../src/services/jobProcessor.js', () => ({
      processJob: vi.fn(() => Promise.resolve({ success: true }))
    }));

    // Import after mocking
    const module = await import('../src/services/clusterManager.js');
    ClusterManager = module.default;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  test('should initialize with correct configuration', () => {
    const clusterManager = new ClusterManager({
      minWorkers: 3,
      maxWorkers: 10,
      scaleUpThreshold: 5
    });

    expect(clusterManager.minWorkers).toBe(3);
    expect(clusterManager.maxWorkers).toBe(10);
    expect(clusterManager.scaleUpThreshold).toBe(5);
  });

  test('should use default configuration when no options provided', () => {
    const clusterManager = new ClusterManager();
    
    expect(clusterManager.minWorkers).toBe(5);
    expect(clusterManager.maxWorkers).toBe(15);
    expect(clusterManager.scaleUpThreshold).toBe(10);
    expect(clusterManager.scaleDownThreshold).toBe(3);
  });

  test('should initialize worker tracking structures', () => {
    const clusterManager = new ClusterManager();
    
    expect(clusterManager.workers).toBeInstanceOf(Map);
    expect(clusterManager.workerMetrics).toBeInstanceOf(Map);
    expect(clusterManager.workerProcesses).toBeInstanceOf(Map);
    expect(clusterManager.workers.size).toBe(0);
  });

  test('should have correct system metrics structure', () => {
    const clusterManager = new ClusterManager();
    
    expect(clusterManager.systemMetrics).toHaveProperty('cpuUsage');
    expect(clusterManager.systemMetrics).toHaveProperty('memoryUsage');
    expect(clusterManager.systemMetrics).toHaveProperty('activeJobs');
    expect(clusterManager.systemMetrics).toHaveProperty('totalWorkers');
  });

  test('should update worker metrics correctly', () => {
    const clusterManager = new ClusterManager();
    const workerId = 'test-worker-1';
    
    // Initialize worker metrics
    clusterManager.workerMetrics.set(workerId, {
      workerId,
      status: 'idle',
      jobsCompleted: 0
    });
    
    // Update metrics
    clusterManager.updateWorkerMetrics(workerId, {
      status: 'processing',
      jobsCompleted: 1
    });
    
    const metrics = clusterManager.workerMetrics.get(workerId);
    expect(metrics.status).toBe('processing');
    expect(metrics.jobsCompleted).toBe(1);
    expect(metrics).toHaveProperty('lastUpdated');
  });

  test('should return cluster health information', () => {
    const clusterManager = new ClusterManager();
    
    // Add some mock worker metrics
    clusterManager.workerMetrics.set('worker-1', { status: 'idle' });
    clusterManager.workerMetrics.set('worker-2', { status: 'processing' });
    clusterManager.workerMetrics.set('worker-3', { status: 'error' });
    
    const health = clusterManager.getClusterHealth();
    
    expect(health).toHaveProperty('totalWorkers');
    expect(health).toHaveProperty('activeWorkers');
    expect(health).toHaveProperty('errorWorkers');
    expect(health).toHaveProperty('isHealthy');
    expect(health).toHaveProperty('lastHealthCheck');
    
    expect(health.totalWorkers).toBe(0); // No actual workers, just metrics
    expect(health.errorWorkers).toBe(1);
    expect(health.isHealthy).toBe(false); // Has error workers
  });

  test('should get worker metrics array', () => {
    const clusterManager = new ClusterManager();
    
    clusterManager.workerMetrics.set('worker-1', { workerId: 'worker-1', status: 'idle' });
    clusterManager.workerMetrics.set('worker-2', { workerId: 'worker-2', status: 'processing' });
    
    const metrics = clusterManager.getWorkerMetrics();
    
    expect(Array.isArray(metrics)).toBe(true);
    expect(metrics.length).toBe(2);
    expect(metrics[0]).toHaveProperty('workerId');
    expect(metrics[0]).toHaveProperty('status');
  });

  test('should handle scaling state correctly', () => {
    const clusterManager = new ClusterManager();
    
    expect(clusterManager.isScaling).toBe(false);
    expect(clusterManager.lastScaleAction).toBe(0);
    
    clusterManager.isScaling = true;
    clusterManager.lastScaleAction = Date.now();
    
    expect(clusterManager.isScaling).toBe(true);
    expect(clusterManager.lastScaleAction).toBeGreaterThan(0);
  });

  test('should validate configuration bounds', () => {
    const clusterManager = new ClusterManager({
      minWorkers: 2,
      maxWorkers: 20,
      scaleUpThreshold: 8,
      scaleDownThreshold: 2
    });
    
    expect(clusterManager.minWorkers).toBeLessThan(clusterManager.maxWorkers);
    expect(clusterManager.scaleDownThreshold).toBeLessThan(clusterManager.scaleUpThreshold);
  });

  test('should have proper interval properties', () => {
    const clusterManager = new ClusterManager();
    
    expect(clusterManager.healthCheckTimer).toBeNull();
    expect(clusterManager.scaleCheckTimer).toBeNull();
    expect(clusterManager.healthCheckInterval).toBeGreaterThan(0);
    expect(clusterManager.scaleCheckInterval).toBeGreaterThan(0);
  });
});