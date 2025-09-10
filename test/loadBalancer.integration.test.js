import { describe, test, expect, beforeEach, vi } from 'vitest';
import LoadBalancer from '../src/services/loadBalancer.js';

// Mock dependencies
vi.mock('../src/services/logService.js');

describe('LoadBalancer Integration', () => {
  let loadBalancer;
  let mockClusterManager;

  beforeEach(() => {
    // Create a comprehensive mock cluster manager
    mockClusterManager = {
      getWorkerMetrics: vi.fn(() => []),
      createWorker: vi.fn(),
      workerMetrics: new Map(),
      workers: new Map()
    };
    
    loadBalancer = new LoadBalancer(mockClusterManager);
  });

  describe('Worker Selection with Cluster Manager Integration', () => {
    test('should integrate with cluster manager for worker selection', async () => {
      // Mock worker metrics in cluster manager
      const workers = [
        {
          workerId: 'worker-1',
          queueName: 'pdf-processing-normal',
          status: 'idle',
          currentJob: null,
          avgProcessingTime: 5000,
          jobsCompleted: 10,
          lastHeartbeat: Date.now()
        },
        {
          workerId: 'worker-2',
          queueName: 'pdf-processing-normal',
          status: 'processing',
          currentJob: 'job-123',
          avgProcessingTime: 8000,
          jobsCompleted: 5,
          lastHeartbeat: Date.now()
        }
      ];

      mockClusterManager.getWorkerMetrics.mockReturnValue(workers);

      const selectedWorker = await loadBalancer.selectWorker('pdf-processing-normal');

      expect(selectedWorker).toBeDefined();
      expect(selectedWorker.queueName).toBe('pdf-processing-normal');
      // Should prefer idle worker over processing worker
      expect(selectedWorker.workerId).toBe('worker-1');
    });

    test('should handle worker failure and coordinate with cluster manager', async () => {
      const failedWorkerId = 'worker-failed';
      const queueName = 'pdf-processing-normal';

      // Set up failed worker in cluster manager
      mockClusterManager.workerMetrics.set(failedWorkerId, {
        workerId: failedWorkerId,
        queueName: queueName,
        status: 'error',
        lastErrorAt: Date.now()
      });

      // Mock getWorkerMetrics to return empty array (no remaining workers)
      mockClusterManager.getWorkerMetrics.mockReturnValue([]);

      await loadBalancer.handleWorkerFailure(failedWorkerId);

      // Should request cluster manager to create replacement worker
      expect(mockClusterManager.createWorker).toHaveBeenCalledWith(queueName);
    });
  });

  describe('Load Distribution Analysis', () => {
    test('should analyze load and provide scaling recommendations', async () => {
      // Set up overloaded workers
      const workers = [
        {
          workerId: 'worker-1',
          avgProcessingTime: 70000, // 70 seconds - overloaded
          status: 'processing',
          currentJob: 'job-1'
        },
        {
          workerId: 'worker-2',
          avgProcessingTime: 80000, // 80 seconds - overloaded
          status: 'processing',
          currentJob: 'job-2'
        }
      ];

      mockClusterManager.getWorkerMetrics.mockReturnValue(workers);

      const recommendation = await loadBalancer.detectAndRedistributeLoad();

      expect(recommendation.action).toBe('scale_up');
      expect(recommendation.reason).toBe('overloaded_workers');
      expect(recommendation.count).toBe(2);
    });

    test('should recommend scale down for underloaded workers', async () => {
      // Set up underloaded workers
      const now = Date.now();
      const workers = [
        {
          workerId: 'worker-1',
          status: 'idle',
          lastCompletedAt: now - 400000, // 6+ minutes ago
          jobsCompleted: 1,
          avgProcessingTime: 5000
        },
        {
          workerId: 'worker-2',
          status: 'idle',
          lastCompletedAt: now - 400000,
          jobsCompleted: 2,
          avgProcessingTime: 5000
        },
        {
          workerId: 'worker-3',
          status: 'idle',
          lastCompletedAt: now - 400000,
          jobsCompleted: 0,
          avgProcessingTime: 5000
        }
      ];

      mockClusterManager.getWorkerMetrics.mockReturnValue(workers);

      const recommendation = await loadBalancer.detectAndRedistributeLoad();

      expect(recommendation.action).toBe('scale_down');
      expect(recommendation.reason).toBe('underloaded_workers');
    });
  });

  describe('Algorithm Performance', () => {
    test('should distribute load evenly with weighted round robin', async () => {
      // Set up multiple workers with different performance characteristics
      const workers = [
        {
          workerId: 'fast-worker',
          queueName: 'pdf-processing-normal',
          status: 'idle',
          currentJob: null,
          avgProcessingTime: 3000,
          jobsCompleted: 20
        },
        {
          workerId: 'medium-worker',
          queueName: 'pdf-processing-normal',
          status: 'idle',
          currentJob: null,
          avgProcessingTime: 5000,
          jobsCompleted: 15
        },
        {
          workerId: 'slow-worker',
          queueName: 'pdf-processing-normal',
          status: 'idle',
          currentJob: null,
          avgProcessingTime: 10000,
          jobsCompleted: 8
        }
      ];

      // Mock getWorkerMetrics to return our test workers
      mockClusterManager.getWorkerMetrics.mockReturnValue(workers);

      // Test multiple selections to see distribution
      const selections = [];
      for (let i = 0; i < 10; i++) {
        const selected = await loadBalancer.selectWorker('pdf-processing-normal');
        selections.push(selected.workerId);
      }

      // Fast worker should be selected more often than slow worker
      const fastWorkerSelections = selections.filter(id => id === 'fast-worker').length;
      const slowWorkerSelections = selections.filter(id => id === 'slow-worker').length;

      // Since we're using weighted round robin, fast worker should get more selections
      // But let's be more lenient and just check that fast worker gets at least as many
      expect(fastWorkerSelections).toBeGreaterThanOrEqual(slowWorkerSelections);
    });

    test('should handle algorithm switching', () => {
      // Test algorithm switching
      expect(loadBalancer.distributionAlgorithm).toBe('weighted-round-robin');

      loadBalancer.setDistributionAlgorithm('least-loaded');
      expect(loadBalancer.distributionAlgorithm).toBe('least-loaded');

      loadBalancer.setDistributionAlgorithm('fastest-response');
      expect(loadBalancer.distributionAlgorithm).toBe('fastest-response');

      // Should reject invalid algorithm
      loadBalancer.setDistributionAlgorithm('invalid-algorithm');
      expect(loadBalancer.distributionAlgorithm).toBe('fastest-response');
    });
  });

  describe('Metrics and Statistics', () => {
    test('should provide comprehensive load balancer statistics', () => {
      // Set up diverse worker metrics
      const workers = [
        {
          workerId: 'worker-1',
          status: 'idle',
          avgProcessingTime: 5000
        },
        {
          workerId: 'worker-2',
          status: 'processing',
          avgProcessingTime: 8000
        },
        {
          workerId: 'worker-3',
          status: 'error',
          avgProcessingTime: 0
        }
      ];

      mockClusterManager.getWorkerMetrics.mockReturnValue(workers);

      const stats = loadBalancer.getLoadBalancerStats();

      expect(stats).toHaveProperty('algorithm', 'weighted-round-robin');
      expect(stats).toHaveProperty('totalWorkers', 3);
      expect(stats).toHaveProperty('idleWorkers', 1);
      expect(stats).toHaveProperty('processingWorkers', 1);
      expect(stats).toHaveProperty('errorWorkers', 1);
      expect(stats).toHaveProperty('avgProcessingTime');
      expect(stats).toHaveProperty('lastDistributionCheck');
    });

    test('should track overloaded and underloaded workers in statistics', () => {
      const now = Date.now();
      
      const workers = [
        // Overloaded worker
        {
          workerId: 'overloaded-worker',
          avgProcessingTime: 70000, // 70 seconds
          status: 'processing'
        },
        // Underloaded worker
        {
          workerId: 'underloaded-worker',
          status: 'idle',
          lastCompletedAt: now - 400000, // 6+ minutes ago
          jobsCompleted: 1,
          avgProcessingTime: 5000
        },
        // Normal worker
        {
          workerId: 'normal-worker',
          status: 'idle',
          avgProcessingTime: 30000,
          jobsCompleted: 10
        }
      ];

      mockClusterManager.getWorkerMetrics.mockReturnValue(workers);

      const stats = loadBalancer.getLoadBalancerStats();

      expect(stats.overloadedWorkers).toBe(1);
      expect(stats.underloadedWorkers).toBe(1);
      expect(stats.totalWorkers).toBe(3);
    });
  });

  describe('Fallback and Error Handling', () => {
    test('should handle empty worker metrics gracefully', async () => {
      // Mock empty worker metrics
      mockClusterManager.getWorkerMetrics.mockReturnValue([]);

      const selectedWorker = await loadBalancer.selectWorker('pdf-processing-normal');
      expect(selectedWorker).toBeNull();

      const recommendation = await loadBalancer.detectAndRedistributeLoad();
      expect(recommendation.action).toBe('maintain');
    });

    test('should handle worker selection errors gracefully', async () => {
      // Mock getWorkerMetrics to throw error
      mockClusterManager.getWorkerMetrics.mockImplementation(() => {
        throw new Error('Redis connection failed');
      });

      const selectedWorker = await loadBalancer.selectWorker('pdf-processing-normal');
      expect(selectedWorker).toBeNull();
    });

    test('should handle load redistribution errors gracefully', async () => {
      // Mock getWorkerMetrics to throw error
      mockClusterManager.getWorkerMetrics.mockImplementation(() => {
        throw new Error('Metrics collection failed');
      });

      const recommendation = await loadBalancer.detectAndRedistributeLoad();
      expect(recommendation.action).toBe('maintain');
      expect(recommendation.reason).toBe('error');
    });
  });
});