import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import ScalableWorker from '../src/workers/scalableWorker.js';
import ClusterManager from '../src/services/clusterManager.js';
import priorityQueueManager from '../src/services/priorityQueueManager.js';
import webSocketManager from '../src/services/websocketManager.js';
import Redis from 'ioredis';

describe('ScalableWorker Integration Tests', () => {
  let worker;
  let clusterManager;
  let redis;
  
  beforeAll(async () => {
    // Initialize Redis connection for testing
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    
    // Initialize cluster manager
    clusterManager = new ClusterManager({
      minWorkers: 1,
      maxWorkers: 3,
      scaleUpThreshold: 5,
      scaleDownThreshold: 1
    });
  });

  afterAll(async () => {
    if (redis) {
      await redis.quit();
    }
  });

  beforeEach(async () => {
    // Clean up any existing test data
    await redis.flushdb();
  });

  afterEach(async () => {
    if (worker) {
      await worker.gracefulShutdown();
      worker = null;
    }
  }, 15000); // Increase timeout for graceful shutdown

  test('should create and start scalable worker successfully', async () => {
    worker = new ScalableWorker({
      workerId: 'test-worker-1',
      queueName: 'pdf-processing-normal',
      clusterManager,
      metricsReportingInterval: 1000 // 1 second for testing
    });

    await worker.start();

    expect(worker.getStatus().status).toBe('active');
    expect(worker.getStatus().workerId).toBe('test-worker-1');
    expect(worker.getStatus().queueName).toBe('pdf-processing-normal');
  });

  test('should report metrics to Redis and WebSocket manager', async () => {
    worker = new ScalableWorker({
      workerId: 'test-worker-metrics',
      queueName: 'pdf-processing-premium',
      clusterManager,
      metricsReportingInterval: 500 // 0.5 seconds for testing
    });

    await worker.start();

    // Wait for metrics to be reported
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check if metrics are stored in Redis
    const metricsKey = `worker:metrics:test-worker-metrics`;
    const storedMetrics = await redis.get(metricsKey);
    
    expect(storedMetrics).toBeTruthy();
    
    const metrics = JSON.parse(storedMetrics);
    expect(metrics.workerId).toBe('test-worker-metrics');
    expect(metrics.queueName).toBe('pdf-processing-premium');
    expect(metrics.status).toBe('idle'); // Worker starts in idle state
  });

  test('should handle graceful shutdown correctly', async () => {
    worker = new ScalableWorker({
      workerId: 'test-worker-shutdown',
      queueName: 'pdf-processing-normal',
      clusterManager,
      metricsReportingInterval: 1000
    });

    await worker.start();
    
    // Verify worker is active
    expect(worker.getStatus().status).toBe('active');
    
    // Initiate graceful shutdown
    await worker.gracefulShutdown();
    
    // Verify worker is shutdown
    expect(worker.getStatus().status).toBe('shutdown');
    expect(worker.getStatus().isShuttingDown).toBe(true);
    
    // Verify metrics are cleaned up from Redis
    const metricsKey = `worker:metrics:test-worker-shutdown`;
    const storedMetrics = await redis.get(metricsKey);
    expect(storedMetrics).toBeNull();
  });

  test('should integrate with cluster manager correctly', async () => {
    const mockClusterManager = {
      registerWorker: vi.fn(),
      handleWorkerEvent: vi.fn()
    };

    worker = new ScalableWorker({
      workerId: 'test-worker-cluster',
      queueName: 'pdf-processing-premium',
      clusterManager: mockClusterManager,
      metricsReportingInterval: 500
    });

    await worker.start();

    // Wait for metrics reporting
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify cluster manager integration
    expect(mockClusterManager.handleWorkerEvent).toHaveBeenCalledWith(
      'metrics-update',
      expect.objectContaining({
        workerId: 'test-worker-cluster',
        metrics: expect.any(Object)
      })
    );
  });

  test('should update metrics correctly during processing', async () => {
    worker = new ScalableWorker({
      workerId: 'test-worker-processing',
      queueName: 'pdf-processing-normal',
      clusterManager,
      metricsReportingInterval: 1000
    });

    await worker.start();

    const initialMetrics = worker.getMetrics();
    expect(initialMetrics.jobsProcessed).toBe(0);
    expect(initialMetrics.status).toBe('active');

    // Simulate processing by updating metrics
    worker.updateMetrics({
      status: 'processing',
      currentJob: 'test-job-123',
      jobsProcessed: 1
    });

    const updatedMetrics = worker.getMetrics();
    expect(updatedMetrics.status).toBe('processing');
    expect(updatedMetrics.currentJob).toBe('test-job-123');
    expect(updatedMetrics.jobsProcessed).toBe(1);
  });

  test('should handle health checks correctly', async () => {
    worker = new ScalableWorker({
      workerId: 'test-worker-health',
      queueName: 'pdf-processing-normal',
      clusterManager,
      metricsReportingInterval: 1000
    });

    await worker.start();

    // Worker should be healthy initially
    expect(worker.isHealthy()).toBe(true);

    // Simulate error state
    worker.updateMetrics({
      status: 'error',
      lastError: 'Test error',
      lastErrorAt: Date.now()
    });

    // Worker should be unhealthy in error state
    expect(worker.isHealthy()).toBe(false);

    // Simulate recovery
    worker.updateMetrics({
      status: 'idle',
      lastError: null,
      lastErrorAt: null,
      lastHeartbeat: Date.now()
    });

    // Worker should be healthy again
    expect(worker.isHealthy()).toBe(true);
  });

  test('should estimate remaining time correctly', async () => {
    worker = new ScalableWorker({
      workerId: 'test-worker-estimation',
      queueName: 'pdf-processing-normal',
      clusterManager,
      metricsReportingInterval: 1000
    });

    await worker.start();

    // Set average processing time
    worker.updateMetrics({
      avgProcessingTime: 30000 // 30 seconds
    });

    const startTime = Date.now() - 5000; // 5 seconds ago
    const remainingTime = worker.estimateRemainingTime(startTime, 25); // 25% complete

    // Should estimate remaining time based on progress
    expect(remainingTime).toBeGreaterThan(0);
    expect(remainingTime).toBeLessThan(30); // Should be less than total avg time
  });
});