import { describe, test, expect, beforeEach, vi } from 'vitest';
import LoadBalancer from '../src/services/loadBalancer.js';

// Mock dependencies
vi.mock('../src/services/logService.js');

describe('LoadBalancer', () => {
  let loadBalancer;
  let mockClusterManager;

  beforeEach(() => {
    // Mock cluster manager
    mockClusterManager = {
      getWorkerMetrics: vi.fn(() => []),
      createWorker: vi.fn(),
      workerMetrics: new Map()
    };

    loadBalancer = new LoadBalancer(mockClusterManager);
  });

  describe('Worker Selection', () => {
    test('should return null when no workers available', async () => {
      mockClusterManager.getWorkerMetrics.mockReturnValue([]);
      
      const worker = await loadBalancer.selectWorker('pdf-processing-normal');
      
      expect(worker).toBeNull();
    });

    test('should select available worker', async () => {
      const mockWorkers = [
        {
          workerId: 'worker-1',
          queueName: 'pdf-processing-normal',
          status: 'idle',
          currentJob: null,
          avgProcessingTime: 5000
        }
      ];
      
      mockClusterManager.getWorkerMetrics.mockReturnValue(mockWorkers);
      
      const worker = await loadBalancer.selectWorker('pdf-processing-normal');
      
      expect(worker).toEqual(mockWorkers[0]);
    });

    test('should filter workers by queue name', async () => {
      const mockWorkers = [
        {
          workerId: 'worker-1',
          queueName: 'pdf-processing-normal',
          status: 'idle',
          currentJob: null
        },
        {
          workerId: 'worker-2',
          queueName: 'pdf-processing-premium',
          status: 'idle',
          currentJob: null
        }
      ];
      
      mockClusterManager.getWorkerMetrics.mockReturnValue(mockWorkers);
      
      const worker = await loadBalancer.selectWorker('pdf-processing-premium');
      
      expect(worker.workerId).toBe('worker-2');
    });
  });

  describe('Weighted Round Robin Selection', () => {
    test('should prefer idle workers over processing workers', () => {
      const workers = [
        {
          workerId: 'worker-1',
          status: 'processing',
          currentJob: 'job-1',
          avgProcessingTime: 5000
        },
        {
          workerId: 'worker-2',
          status: 'idle',
          currentJob: null,
          avgProcessingTime: 5000
        }
      ];
      
      const selected = loadBalancer.selectByWeightedRoundRobin(workers, 'test-queue');
      
      expect(selected.workerId).toBe('worker-2');
    });

    test('should penalize workers with slow processing times', () => {
      const workers = [
        {
          workerId: 'worker-1',
          status: 'idle',
          currentJob: null,
          avgProcessingTime: 30000 // 30 seconds
        },
        {
          workerId: 'worker-2',
          status: 'idle',
          currentJob: null,
          avgProcessingTime: 5000 // 5 seconds
        }
      ];
      
      const selected = loadBalancer.selectByWeightedRoundRobin(workers, 'test-queue');
      
      expect(selected.workerId).toBe('worker-2');
    });

    test('should penalize workers with recent errors', () => {
      const now = Date.now();
      const workers = [
        {
          workerId: 'worker-1',
          status: 'idle',
          currentJob: null,
          lastErrorAt: now - 60000, // 1 minute ago
          avgProcessingTime: 5000
        },
        {
          workerId: 'worker-2',
          status: 'idle',
          currentJob: null,
          lastErrorAt: null,
          avgProcessingTime: 5000
        }
      ];
      
      const selected = loadBalancer.selectByWeightedRoundRobin(workers, 'test-queue');
      
      expect(selected.workerId).toBe('worker-2');
    });
  });

  describe('Least Loaded Selection', () => {
    test('should select worker with no current job', () => {
      const workers = [
        {
          workerId: 'worker-1',
          currentJob: 'job-1',
          avgProcessingTime: 5000
        },
        {
          workerId: 'worker-2',
          currentJob: null,
          avgProcessingTime: 5000
        }
      ];
      
      const selected = loadBalancer.selectByLeastLoaded(workers);
      
      expect(selected.workerId).toBe('worker-2');
    });

    test('should prefer faster worker when load is equal', () => {
      const workers = [
        {
          workerId: 'worker-1',
          currentJob: null,
          avgProcessingTime: 10000
        },
        {
          workerId: 'worker-2',
          currentJob: null,
          avgProcessingTime: 5000
        }
      ];
      
      const selected = loadBalancer.selectByLeastLoaded(workers);
      
      expect(selected.workerId).toBe('worker-2');
    });
  });

  describe('Fastest Response Selection', () => {
    test('should select idle worker with fastest average time', () => {
      const workers = [
        {
          workerId: 'worker-1',
          status: 'idle',
          avgProcessingTime: 10000
        },
        {
          workerId: 'worker-2',
          status: 'idle',
          avgProcessingTime: 5000
        },
        {
          workerId: 'worker-3',
          status: 'processing',
          avgProcessingTime: 3000
        }
      ];
      
      const selected = loadBalancer.selectByFastestResponse(workers);
      
      expect(selected.workerId).toBe('worker-2');
    });

    test('should fallback to least loaded when no idle workers', () => {
      const workers = [
        {
          workerId: 'worker-1',
          status: 'processing',
          currentJob: 'job-1',
          avgProcessingTime: 10000
        },
        {
          workerId: 'worker-2',
          status: 'processing',
          currentJob: null, // This shouldn't happen but test fallback
          avgProcessingTime: 5000
        }
      ];
      
      const selected = loadBalancer.selectByFastestResponse(workers);
      
      expect(selected.workerId).toBe('worker-2');
    });
  });

  describe('Load Detection', () => {
    test('should detect overloaded worker with long-running job', () => {
      const worker = {
        workerId: 'worker-1',
        currentJob: 'job-1',
        lastHeartbeat: Date.now() - 150000, // 2.5 minutes ago
        avgProcessingTime: 30000
      };
      
      const isOverloaded = loadBalancer.isWorkerOverloaded(worker);
      
      expect(isOverloaded).toBe(true);
    });

    test('should detect overloaded worker with slow processing', () => {
      const worker = {
        workerId: 'worker-1',
        currentJob: null,
        lastHeartbeat: Date.now(),
        avgProcessingTime: 70000 // 70 seconds
      };
      
      const isOverloaded = loadBalancer.isWorkerOverloaded(worker);
      
      expect(isOverloaded).toBe(true);
    });

    test('should detect overloaded worker with recent errors', () => {
      const worker = {
        workerId: 'worker-1',
        currentJob: null,
        lastHeartbeat: Date.now(),
        avgProcessingTime: 30000,
        lastErrorAt: Date.now() - 60000 // 1 minute ago
      };
      
      const isOverloaded = loadBalancer.isWorkerOverloaded(worker);
      
      expect(isOverloaded).toBe(true);
    });

    test('should detect underloaded worker', () => {
      const worker = {
        workerId: 'worker-1',
        status: 'idle',
        lastCompletedAt: Date.now() - 400000, // 6+ minutes ago
        jobsCompleted: 1,
        avgProcessingTime: 5000
      };
      
      const isUnderloaded = loadBalancer.isWorkerUnderloaded(worker);
      
      expect(isUnderloaded).toBe(true);
    });
  });

  describe('Load Redistribution', () => {
    test('should recommend scale up when workers are overloaded', async () => {
      const workers = [
        {
          workerId: 'worker-1',
          avgProcessingTime: 70000 // Overloaded
        },
        {
          workerId: 'worker-2',
          avgProcessingTime: 80000 // Overloaded
        },
        {
          workerId: 'worker-3',
          avgProcessingTime: 30000 // Normal
        }
      ];
      
      mockClusterManager.getWorkerMetrics.mockReturnValue(workers);
      
      const recommendation = await loadBalancer.detectAndRedistributeLoad();
      
      expect(recommendation.action).toBe('scale_up');
      expect(recommendation.reason).toBe('overloaded_workers');
    });

    test('should recommend scale down when workers are underloaded', async () => {
      const workers = [
        {
          workerId: 'worker-1',
          status: 'idle',
          lastCompletedAt: Date.now() - 400000,
          jobsCompleted: 1
        },
        {
          workerId: 'worker-2',
          status: 'idle',
          lastCompletedAt: Date.now() - 400000,
          jobsCompleted: 2
        },
        {
          workerId: 'worker-3',
          status: 'idle',
          lastCompletedAt: Date.now() - 400000,
          jobsCompleted: 0
        }
      ];
      
      mockClusterManager.getWorkerMetrics.mockReturnValue(workers);
      
      const recommendation = await loadBalancer.detectAndRedistributeLoad();
      
      expect(recommendation.action).toBe('scale_down');
      expect(recommendation.reason).toBe('underloaded_workers');
    });

    test('should recommend maintain when load is balanced', async () => {
      const workers = [
        {
          workerId: 'worker-1',
          status: 'idle',
          avgProcessingTime: 30000,
          jobsCompleted: 10
        },
        {
          workerId: 'worker-2',
          status: 'processing',
          avgProcessingTime: 25000,
          jobsCompleted: 8
        }
      ];
      
      mockClusterManager.getWorkerMetrics.mockReturnValue(workers);
      
      const recommendation = await loadBalancer.detectAndRedistributeLoad();
      
      expect(recommendation.action).toBe('maintain');
    });
  });

  describe('Algorithm Configuration', () => {
    test('should set valid distribution algorithm', () => {
      loadBalancer.setDistributionAlgorithm('least-loaded');
      
      expect(loadBalancer.distributionAlgorithm).toBe('least-loaded');
    });

    test('should reject invalid distribution algorithm', () => {
      const originalAlgorithm = loadBalancer.distributionAlgorithm;
      
      loadBalancer.setDistributionAlgorithm('invalid-algorithm');
      
      expect(loadBalancer.distributionAlgorithm).toBe(originalAlgorithm);
    });
  });

  describe('Worker Failure Handling', () => {
    test('should handle worker failure and reset round-robin', async () => {
      const failedWorkerId = 'worker-1';
      const queueName = 'pdf-processing-normal';
      
      mockClusterManager.workerMetrics.set(failedWorkerId, {
        workerId: failedWorkerId,
        queueName: queueName
      });
      
      mockClusterManager.getWorkerMetrics.mockReturnValue([
        { workerId: 'worker-2', queueName: queueName }
      ]);
      
      // Set round-robin index
      loadBalancer.lastWorkerIndex.set(queueName, 1);
      
      await loadBalancer.handleWorkerFailure(failedWorkerId);
      
      expect(loadBalancer.lastWorkerIndex.has(queueName)).toBe(false);
    });

    test('should create replacement worker when no workers remain', async () => {
      const failedWorkerId = 'worker-1';
      const queueName = 'pdf-processing-normal';
      
      mockClusterManager.workerMetrics.set(failedWorkerId, {
        workerId: failedWorkerId,
        queueName: queueName
      });
      
      mockClusterManager.getWorkerMetrics.mockReturnValue([]);
      
      await loadBalancer.handleWorkerFailure(failedWorkerId);
      
      expect(mockClusterManager.createWorker).toHaveBeenCalledWith(queueName);
    });
  });

  describe('Statistics', () => {
    test('should return comprehensive load balancer stats', () => {
      const workers = [
        { status: 'idle', avgProcessingTime: 5000 },
        { status: 'processing', avgProcessingTime: 8000 },
        { status: 'error', avgProcessingTime: 0 }
      ];
      
      mockClusterManager.getWorkerMetrics.mockReturnValue(workers);
      
      const stats = loadBalancer.getLoadBalancerStats();
      
      expect(stats).toHaveProperty('algorithm');
      expect(stats).toHaveProperty('totalWorkers', 3);
      expect(stats).toHaveProperty('idleWorkers', 1);
      expect(stats).toHaveProperty('processingWorkers', 1);
      expect(stats).toHaveProperty('errorWorkers', 1);
      expect(stats).toHaveProperty('avgProcessingTime');
    });

    test('should calculate average processing time correctly', () => {
      const workers = [
        { avgProcessingTime: 5000 },
        { avgProcessingTime: 10000 },
        { avgProcessingTime: 0 } // Should be excluded
      ];
      
      const avgTime = loadBalancer.calculateAverageProcessingTime(workers);
      
      expect(avgTime).toBe(7500); // (5000 + 10000) / 2
    });

    test('should return 0 for average when no workers have processing times', () => {
      const workers = [
        { avgProcessingTime: 0 },
        { avgProcessingTime: 0 }
      ];
      
      const avgTime = loadBalancer.calculateAverageProcessingTime(workers);
      
      expect(avgTime).toBe(0);
    });
  });
});