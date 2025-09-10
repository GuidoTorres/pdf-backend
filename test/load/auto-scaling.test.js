import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import ClusterManager from '../../src/services/clusterManager.js';
import PriorityQueueManager from '../../src/services/priorityQueueManager.js';
import LoadBalancer from '../../src/services/loadBalancer.js';
import { performance } from 'perf_hooks';

// Mock dependencies
vi.mock('../../src/services/logService.js');
vi.mock('../../src/services/databaseService.js');
vi.mock('ioredis');
vi.mock('bullmq');

describe('Auto-Scaling Load Tests', () => {
  let clusterManager;
  let priorityQueueManager;
  let loadBalancer;
  let mockRedis;
  let mockQueues;
  let workerCreationLog;
  let workerDestructionLog;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    workerCreationLog = [];
    workerDestructionLog = [];

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

    // Mock BullMQ with dynamic queue stats
    mockQueues = {
      'pdf-processing-premium': {
        waiting: 0,
        active: 0,
        getWaiting: vi.fn(() => Promise.resolve([])),
        getActive: vi.fn(() => Promise.resolve([])),
        add: vi.fn(() => Promise.resolve({ id: Math.random().toString() })),
        clean: vi.fn(() => Promise.resolve())
      },
      'pdf-processing-normal': {
        waiting: 0,
        active: 0,
        getWaiting: vi.fn(() => Promise.resolve([])),
        getActive: vi.fn(() => Promise.resolve([])),
        add: vi.fn(() => Promise.resolve({ id: Math.random().toString() })),
        clean: vi.fn(() => Promise.resolve())
      },
      'pdf-processing-large': {
        waiting: 0,
        active: 0,
        getWaiting: vi.fn(() => Promise.resolve([])),
        getActive: vi.fn(() => Promise.resolve([])),
        add: vi.fn(() => Promise.resolve({ id: Math.random().toString() })),
        clean: vi.fn(() => Promise.resolve())
      }
    };

    const mockWorker = {
      on: vi.fn(),
      close: vi.fn(() => Promise.resolve()),
      process: vi.fn()
    };

    vi.doMock('bullmq', () => ({
      Queue: vi.fn((queueName) => mockQueues[queueName]),
      Worker: vi.fn(() => mockWorker)
    }));

    // Initialize services
    clusterManager = new ClusterManager({
      minWorkers: 3,
      maxWorkers: 12,
      scaleUpThreshold: 8,
      scaleDownThreshold: 2,
      scaleCheckInterval: 1000 // 1 second for testing
    });

    priorityQueueManager = new PriorityQueueManager();
    loadBalancer = new LoadBalancer(clusterManager);

    // Override worker creation/destruction to track scaling
    const originalCreateWorker = clusterManager.createWorker;
    const originalRemoveWorker = clusterManager.removeWorker;

    clusterManager.createWorker = async function(queueName) {
      const result = await originalCreateWorker.call(this, queueName);
      workerCreationLog.push({
        workerId: result.workerId,
        queueName,
        timestamp: Date.now(),
        totalWorkers: this.workers.size
      });
      return result;
    };

    clusterManager.removeWorker = async function(workerId) {
      const result = await originalRemoveWorker.call(this, workerId);
      workerDestructionLog.push({
        workerId,
        timestamp: Date.now(),
        totalWorkers: this.workers.size
      });
      return result;
    };

    // Mock queue stats method
    priorityQueueManager.getQueueStats = vi.fn(() => Promise.resolve({
      'pdf-processing-premium': { waiting: mockQueues['pdf-processing-premium'].waiting, active: mockQueues['pdf-processing-premium'].active },
      'pdf-processing-normal': { waiting: mockQueues['pdf-processing-normal'].waiting, active: mockQueues['pdf-processing-normal'].active },
      'pdf-processing-large': { waiting: mockQueues['pdf-processing-large'].waiting, active: mockQueues['pdf-processing-large'].active }
    }));
  });

  afterEach(async () => {
    if (clusterManager) {
      await clusterManager.stop();
    }
    if (priorityQueueManager) {
      await priorityQueueManager.close();
    }
    workerCreationLog = [];
    workerDestructionLog = [];
  });

  describe('Scale Up Operations', () => {
    test('should scale up workers when queue load exceeds threshold', async () => {
      await clusterManager.start();
      const initialWorkers = clusterManager.workers.size;
      
      // Simulate high queue load
      mockQueues['pdf-processing-premium'].waiting = 15;
      mockQueues['pdf-processing-normal'].waiting = 20;
      mockQueues['pdf-processing-large'].waiting = 5;
      
      // Update mock functions to return high load
      mockQueues['pdf-processing-premium'].getWaiting = vi.fn(() => 
        Promise.resolve(Array(15).fill().map((_, i) => ({ id: `premium-${i}` })))
      );
      mockQueues['pdf-processing-normal'].getWaiting = vi.fn(() => 
        Promise.resolve(Array(20).fill().map((_, i) => ({ id: `normal-${i}` })))
      );
      mockQueues['pdf-processing-large'].getWaiting = vi.fn(() => 
        Promise.resolve(Array(5).fill().map((_, i) => ({ id: `large-${i}` })))
      );

      // Trigger scaling check
      await clusterManager.checkAndScale();
      
      // Wait for scaling to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const finalWorkers = clusterManager.workers.size;
      const workersCreated = workerCreationLog.length;
      const totalQueueLoad = 15 + 20 + 5; // 40 jobs waiting

      console.log(`Scale Up Test Results:
        - Initial workers: ${initialWorkers}
        - Final workers: ${finalWorkers}
        - Workers created: ${workersCreated}
        - Total queue load: ${totalQueueLoad}
        - Scale up threshold: ${clusterManager.scaleUpThreshold}`);

      expect(finalWorkers).toBeGreaterThan(initialWorkers);
      expect(workersCreated).toBeGreaterThan(0);
      expect(finalWorkers).toBeLessThanOrEqual(clusterManager.maxWorkers);
    }, 15000);

    test('should respect maximum worker limit during aggressive scaling', async () => {
      await clusterManager.start();
      
      // Simulate extreme load that would normally trigger massive scaling
      mockQueues['pdf-processing-premium'].waiting = 50;
      mockQueues['pdf-processing-normal'].waiting = 100;
      mockQueues['pdf-processing-large'].waiting = 25;
      
      mockQueues['pdf-processing-premium'].getWaiting = vi.fn(() => 
        Promise.resolve(Array(50).fill().map((_, i) => ({ id: `premium-${i}` })))
      );
      mockQueues['pdf-processing-normal'].getWaiting = vi.fn(() => 
        Promise.resolve(Array(100).fill().map((_, i) => ({ id: `normal-${i}` })))
      );
      mockQueues['pdf-processing-large'].getWaiting = vi.fn(() => 
        Promise.resolve(Array(25).fill().map((_, i) => ({ id: `large-${i}` })))
      );

      // Trigger multiple scaling checks rapidly
      const scalingPromises = Array.from({ length: 5 }, () => clusterManager.checkAndScale());
      await Promise.all(scalingPromises);
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const finalWorkers = clusterManager.workers.size;
      const totalQueueLoad = 50 + 100 + 25; // 175 jobs waiting

      console.log(`Aggressive Scaling Test Results:
        - Final workers: ${finalWorkers}
        - Max workers limit: ${clusterManager.maxWorkers}
        - Total queue load: ${totalQueueLoad}
        - Workers created: ${workerCreationLog.length}`);

      expect(finalWorkers).toBeLessThanOrEqual(clusterManager.maxWorkers);
      expect(finalWorkers).toBe(clusterManager.maxWorkers); // Should hit the limit
    }, 20000);

    test('should scale up different queue types proportionally', async () => {
      await clusterManager.start();
      
      // Create uneven load across queues
      mockQueues['pdf-processing-premium'].waiting = 30; // High premium load
      mockQueues['pdf-processing-normal'].waiting = 10;  // Medium normal load
      mockQueues['pdf-processing-large'].waiting = 2;    // Low large load
      
      mockQueues['pdf-processing-premium'].getWaiting = vi.fn(() => 
        Promise.resolve(Array(30).fill().map((_, i) => ({ id: `premium-${i}` })))
      );
      mockQueues['pdf-processing-normal'].getWaiting = vi.fn(() => 
        Promise.resolve(Array(10).fill().map((_, i) => ({ id: `normal-${i}` })))
      );
      mockQueues['pdf-processing-large'].getWaiting = vi.fn(() => 
        Promise.resolve(Array(2).fill().map((_, i) => ({ id: `large-${i}` })))
      );

      await clusterManager.checkAndScale();
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Analyze worker distribution by queue type
      const workersByQueue = {};
      workerCreationLog.forEach(log => {
        workersByQueue[log.queueName] = (workersByQueue[log.queueName] || 0) + 1;
      });

      const premiumWorkers = workersByQueue['pdf-processing-premium'] || 0;
      const normalWorkers = workersByQueue['pdf-processing-normal'] || 0;
      const largeWorkers = workersByQueue['pdf-processing-large'] || 0;

      console.log(`Proportional Scaling Test Results:
        - Premium queue load: 30, workers created: ${premiumWorkers}
        - Normal queue load: 10, workers created: ${normalWorkers}
        - Large queue load: 2, workers created: ${largeWorkers}
        - Total workers created: ${workerCreationLog.length}`);

      expect(premiumWorkers).toBeGreaterThanOrEqual(normalWorkers); // More premium workers for higher load
      expect(normalWorkers).toBeGreaterThanOrEqual(largeWorkers);   // More normal workers than large
      expect(workerCreationLog.length).toBeGreaterThan(0);
    }, 15000);
  });

  describe('Scale Down Operations', () => {
    test('should scale down workers when load decreases', async () => {
      await clusterManager.start();
      
      // First scale up by creating high load
      mockQueues['pdf-processing-premium'].waiting = 25;
      mockQueues['pdf-processing-normal'].waiting = 30;
      
      mockQueues['pdf-processing-premium'].getWaiting = vi.fn(() => 
        Promise.resolve(Array(25).fill().map((_, i) => ({ id: `premium-${i}` })))
      );
      mockQueues['pdf-processing-normal'].getWaiting = vi.fn(() => 
        Promise.resolve(Array(30).fill().map((_, i) => ({ id: `normal-${i}` })))
      );

      await clusterManager.checkAndScale();
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const peakWorkers = clusterManager.workers.size;
      
      // Clear creation log to track only scale down
      workerCreationLog.length = 0;
      
      // Now simulate low load
      mockQueues['pdf-processing-premium'].waiting = 0;
      mockQueues['pdf-processing-normal'].waiting = 1;
      mockQueues['pdf-processing-large'].waiting = 0;
      
      mockQueues['pdf-processing-premium'].getWaiting = vi.fn(() => Promise.resolve([]));
      mockQueues['pdf-processing-normal'].getWaiting = vi.fn(() => 
        Promise.resolve([{ id: 'normal-1' }])
      );
      mockQueues['pdf-processing-large'].getWaiting = vi.fn(() => Promise.resolve([]));

      // Mark workers as idle for scale down
      Array.from(clusterManager.workers.keys()).forEach(workerId => {
        clusterManager.updateWorkerMetrics(workerId, {
          status: 'idle',
          currentJob: null,
          lastCompletedAt: Date.now()
        });
      });

      await clusterManager.checkAndScale();
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const finalWorkers = clusterManager.workers.size;
      const workersDestroyed = workerDestructionLog.length;

      console.log(`Scale Down Test Results:
        - Peak workers: ${peakWorkers}
        - Final workers: ${finalWorkers}
        - Workers destroyed: ${workersDestroyed}
        - Min workers limit: ${clusterManager.minWorkers}`);

      expect(finalWorkers).toBeLessThan(peakWorkers);
      expect(workersDestroyed).toBeGreaterThan(0);
      expect(finalWorkers).toBeGreaterThanOrEqual(clusterManager.minWorkers);
    }, 25000);

    test('should respect minimum worker limit during scale down', async () => {
      await clusterManager.start();
      
      // Start with some workers
      await clusterManager.scaleToTarget(8);
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const initialWorkers = clusterManager.workers.size;
      
      // Simulate zero load
      mockQueues['pdf-processing-premium'].waiting = 0;
      mockQueues['pdf-processing-normal'].waiting = 0;
      mockQueues['pdf-processing-large'].waiting = 0;
      
      Object.values(mockQueues).forEach(queue => {
        queue.getWaiting = vi.fn(() => Promise.resolve([]));
        queue.getActive = vi.fn(() => Promise.resolve([]));
      });

      // Mark all workers as idle
      Array.from(clusterManager.workers.keys()).forEach(workerId => {
        clusterManager.updateWorkerMetrics(workerId, {
          status: 'idle',
          currentJob: null,
          lastCompletedAt: Date.now() - 600000 // 10 minutes ago
        });
      });

      // Trigger aggressive scale down
      await clusterManager.checkAndScale();
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const finalWorkers = clusterManager.workers.size;

      console.log(`Minimum Worker Limit Test Results:
        - Initial workers: ${initialWorkers}
        - Final workers: ${finalWorkers}
        - Min workers limit: ${clusterManager.minWorkers}
        - Workers destroyed: ${workerDestructionLog.length}`);

      expect(finalWorkers).toBeGreaterThanOrEqual(clusterManager.minWorkers);
      expect(finalWorkers).toBe(clusterManager.minWorkers); // Should hit minimum
    }, 15000);

    test('should not scale down workers that are actively processing', async () => {
      await clusterManager.start();
      
      // Scale up first
      await clusterManager.scaleToTarget(8);
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Mark some workers as active, others as idle
      const workerIds = Array.from(clusterManager.workers.keys());
      const activeWorkers = workerIds.slice(0, 3);
      const idleWorkers = workerIds.slice(3);
      
      activeWorkers.forEach(workerId => {
        clusterManager.updateWorkerMetrics(workerId, {
          status: 'processing',
          currentJob: `job-${workerId}`,
          lastHeartbeat: Date.now()
        });
      });
      
      idleWorkers.forEach(workerId => {
        clusterManager.updateWorkerMetrics(workerId, {
          status: 'idle',
          currentJob: null,
          lastCompletedAt: Date.now() - 300000 // 5 minutes ago
        });
      });

      // Simulate low load to trigger scale down
      Object.values(mockQueues).forEach(queue => {
        queue.waiting = 0;
        queue.getWaiting = vi.fn(() => Promise.resolve([]));
        queue.getActive = vi.fn(() => Promise.resolve([]));
      });

      const initialWorkers = clusterManager.workers.size;
      
      await clusterManager.checkAndScale();
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const finalWorkers = clusterManager.workers.size;
      const remainingWorkerIds = Array.from(clusterManager.workers.keys());
      
      // Check that active workers are still present
      const activeWorkersRemaining = activeWorkers.filter(id => remainingWorkerIds.includes(id));

      console.log(`Active Worker Protection Test Results:
        - Initial workers: ${initialWorkers}
        - Final workers: ${finalWorkers}
        - Active workers initially: ${activeWorkers.length}
        - Active workers remaining: ${activeWorkersRemaining.length}
        - Workers destroyed: ${workerDestructionLog.length}`);

      expect(activeWorkersRemaining.length).toBe(activeWorkers.length); // All active workers should remain
      expect(finalWorkers).toBeGreaterThan(clusterManager.minWorkers); // Should be above minimum due to active workers
    }, 15000);
  });

  describe('Dynamic Scaling Behavior', () => {
    test('should handle rapid load fluctuations without thrashing', async () => {
      await clusterManager.start();
      
      const fluctuationCycles = 5;
      const scalingEvents = [];
      
      for (let cycle = 0; cycle < fluctuationCycles; cycle++) {
        const cycleStart = Date.now();
        
        // High load phase
        mockQueues['pdf-processing-premium'].waiting = 20;
        mockQueues['pdf-processing-normal'].waiting = 25;
        
        Object.values(mockQueues).forEach(queue => {
          queue.getWaiting = vi.fn(() => 
            Promise.resolve(Array(queue.waiting).fill().map((_, i) => ({ id: `job-${i}` })))
          );
        });

        await clusterManager.checkAndScale();
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const highLoadWorkers = clusterManager.workers.size;
        
        // Low load phase
        mockQueues['pdf-processing-premium'].waiting = 1;
        mockQueues['pdf-processing-normal'].waiting = 2;
        
        // Mark workers as idle
        Array.from(clusterManager.workers.keys()).forEach(workerId => {
          clusterManager.updateWorkerMetrics(workerId, {
            status: 'idle',
            currentJob: null,
            lastCompletedAt: Date.now()
          });
        });

        Object.values(mockQueues).forEach(queue => {
          queue.getWaiting = vi.fn(() => 
            Promise.resolve(Array(queue.waiting).fill().map((_, i) => ({ id: `job-${i}` })))
          );
        });

        await clusterManager.checkAndScale();
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const lowLoadWorkers = clusterManager.workers.size;
        
        scalingEvents.push({
          cycle,
          highLoadWorkers,
          lowLoadWorkers,
          duration: Date.now() - cycleStart
        });
      }
      
      // Analyze scaling stability
      const workerVariations = scalingEvents.map(event => 
        Math.abs(event.highLoadWorkers - event.lowLoadWorkers)
      );
      const avgVariation = workerVariations.reduce((a, b) => a + b, 0) / workerVariations.length;
      const maxVariation = Math.max(...workerVariations);
      
      const totalCreations = workerCreationLog.length;
      const totalDestructions = workerDestructionLog.length;
      const thrashingRatio = Math.abs(totalCreations - totalDestructions) / Math.max(totalCreations, totalDestructions, 1);

      console.log(`Load Fluctuation Test Results:
        - Fluctuation cycles: ${fluctuationCycles}
        - Average worker variation: ${avgVariation.toFixed(1)}
        - Max worker variation: ${maxVariation}
        - Total worker creations: ${totalCreations}
        - Total worker destructions: ${totalDestructions}
        - Thrashing ratio: ${thrashingRatio.toFixed(2)}`);

      expect(avgVariation).toBeLessThan(8); // Reasonable variation
      expect(maxVariation).toBeLessThan(12); // Not too extreme
      expect(thrashingRatio).toBeLessThan(0.5); // Limited thrashing
    }, 45000);

    test('should scale efficiently under sustained variable load', async () => {
      await clusterManager.start();
      
      const testDuration = 20000; // 20 seconds
      const loadPattern = [
        { duration: 3000, premium: 5, normal: 8, large: 1 },   // Low load
        { duration: 4000, premium: 15, normal: 20, large: 3 }, // Medium load
        { duration: 5000, premium: 25, normal: 35, large: 8 }, // High load
        { duration: 4000, premium: 10, normal: 15, large: 2 }, // Medium load
        { duration: 4000, premium: 2, normal: 5, large: 0 }   // Low load
      ];
      
      const startTime = Date.now();
      const scalingSnapshots = [];
      
      let patternIndex = 0;
      let phaseStartTime = startTime;
      
      const loadSimulation = setInterval(async () => {
        const elapsed = Date.now() - startTime;
        
        if (elapsed >= testDuration) {
          clearInterval(loadSimulation);
          return;
        }
        
        // Check if we need to move to next phase
        const currentPhase = loadPattern[patternIndex];
        if (Date.now() - phaseStartTime >= currentPhase.duration) {
          patternIndex = (patternIndex + 1) % loadPattern.length;
          phaseStartTime = Date.now();
        }
        
        const phase = loadPattern[patternIndex];
        
        // Update queue loads
        mockQueues['pdf-processing-premium'].waiting = phase.premium;
        mockQueues['pdf-processing-normal'].waiting = phase.normal;
        mockQueues['pdf-processing-large'].waiting = phase.large;
        
        Object.entries(mockQueues).forEach(([queueName, queue]) => {
          queue.getWaiting = vi.fn(() => 
            Promise.resolve(Array(queue.waiting).fill().map((_, i) => ({ id: `${queueName}-${i}` })))
          );
        });
        
        // Trigger scaling check
        await clusterManager.checkAndScale();
        
        // Take snapshot
        scalingSnapshots.push({
          timestamp: Date.now() - startTime,
          phase: patternIndex,
          workers: clusterManager.workers.size,
          load: phase.premium + phase.normal + phase.large
        });
        
      }, 2000); // Check every 2 seconds
      
      // Wait for test completion
      await new Promise(resolve => setTimeout(resolve, testDuration + 2000));
      
      // Analyze scaling efficiency
      const loadChanges = scalingSnapshots.length > 1 ? 
        scalingSnapshots.slice(1).map((snapshot, i) => ({
          loadChange: snapshot.load - scalingSnapshots[i].load,
          workerChange: snapshot.workers - scalingSnapshots[i].workers,
          responseTime: 2000 // 2 second intervals
        })) : [];
      
      const appropriateResponses = loadChanges.filter(change => {
        if (change.loadChange > 5 && change.workerChange > 0) return true; // Scale up on load increase
        if (change.loadChange < -5 && change.workerChange < 0) return true; // Scale down on load decrease
        if (Math.abs(change.loadChange) <= 5) return true; // No change on stable load
        return false;
      });
      
      const responseAccuracy = appropriateResponses.length / Math.max(loadChanges.length, 1);

      console.log(`Sustained Variable Load Test Results:
        - Test duration: ${testDuration}ms
        - Scaling snapshots: ${scalingSnapshots.length}
        - Load changes detected: ${loadChanges.length}
        - Appropriate responses: ${appropriateResponses.length}
        - Response accuracy: ${(responseAccuracy * 100).toFixed(1)}%
        - Final workers: ${clusterManager.workers.size}
        - Total worker creations: ${workerCreationLog.length}
        - Total worker destructions: ${workerDestructionLog.length}`);

      expect(responseAccuracy).toBeGreaterThan(0.7); // At least 70% appropriate responses
      expect(scalingSnapshots.length).toBeGreaterThan(5); // Multiple snapshots taken
      expect(clusterManager.workers.size).toBeGreaterThanOrEqual(clusterManager.minWorkers);
      expect(clusterManager.workers.size).toBeLessThanOrEqual(clusterManager.maxWorkers);
    }, 30000);
  });

  describe('Scaling Performance Metrics', () => {
    test('should scale workers within acceptable time limits', async () => {
      await clusterManager.start();
      
      const scaleUpTests = [
        { from: 3, to: 8, expectedTime: 5000 },
        { from: 8, to: 12, expectedTime: 3000 },
        { from: 5, to: 10, expectedTime: 4000 }
      ];
      
      const scaleUpResults = [];
      
      for (const test of scaleUpTests) {
        // Set initial worker count
        await clusterManager.scaleToTarget(test.from);
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const startTime = performance.now();
        const initialWorkers = clusterManager.workers.size;
        
        // Trigger scale up
        await clusterManager.scaleToTarget(test.to);
        
        // Wait for scaling to complete
        let scalingComplete = false;
        const maxWaitTime = test.expectedTime + 2000;
        const checkInterval = 200;
        let waitTime = 0;
        
        while (!scalingComplete && waitTime < maxWaitTime) {
          await new Promise(resolve => setTimeout(resolve, checkInterval));
          waitTime += checkInterval;
          
          if (clusterManager.workers.size >= test.to) {
            scalingComplete = true;
          }
        }
        
        const actualTime = performance.now() - startTime;
        const finalWorkers = clusterManager.workers.size;
        
        scaleUpResults.push({
          from: test.from,
          to: test.to,
          expectedTime: test.expectedTime,
          actualTime,
          initialWorkers,
          finalWorkers,
          success: scalingComplete
        });
      }
      
      const avgScaleUpTime = scaleUpResults.reduce((sum, r) => sum + r.actualTime, 0) / scaleUpResults.length;
      const successfulScaleUps = scaleUpResults.filter(r => r.success).length;
      
      console.log(`Scale Up Performance Test Results:
        - Tests performed: ${scaleUpTests.length}
        - Successful scale ups: ${successfulScaleUps}
        - Average scale up time: ${avgScaleUpTime.toFixed(2)}ms
        - Scale up details:`);
      
      scaleUpResults.forEach((result, i) => {
        console.log(`  Test ${i + 1}: ${result.from}→${result.to} workers in ${result.actualTime.toFixed(2)}ms (expected: ${result.expectedTime}ms)`);
      });

      expect(successfulScaleUps).toBe(scaleUpTests.length);
      expect(avgScaleUpTime).toBeLessThan(6000); // Average under 6 seconds
      expect(scaleUpResults.every(r => r.actualTime < r.expectedTime + 2000)).toBe(true); // Within expected time + buffer
    }, 45000);

    test('should maintain system stability during rapid scaling events', async () => {
      await clusterManager.start();
      
      const rapidScalingEvents = [
        { action: 'scaleUp', target: 8 },
        { action: 'scaleDown', target: 4 },
        { action: 'scaleUp', target: 10 },
        { action: 'scaleUp', target: 12 },
        { action: 'scaleDown', target: 6 },
        { action: 'scaleDown', target: 3 }
      ];
      
      const eventResults = [];
      let systemErrors = 0;
      
      for (let i = 0; i < rapidScalingEvents.length; i++) {
        const event = rapidScalingEvents[i];
        const startTime = performance.now();
        const initialWorkers = clusterManager.workers.size;
        
        try {
          if (event.action === 'scaleUp') {
            await clusterManager.scaleToTarget(event.target);
          } else {
            // For scale down, mark workers as idle first
            Array.from(clusterManager.workers.keys()).forEach(workerId => {
              clusterManager.updateWorkerMetrics(workerId, {
                status: 'idle',
                currentJob: null,
                lastCompletedAt: Date.now()
              });
            });
            await clusterManager.scaleToTarget(event.target);
          }
          
          // Wait for scaling to stabilize
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          const finalWorkers = clusterManager.workers.size;
          const actualTime = performance.now() - startTime;
          
          eventResults.push({
            event: i + 1,
            action: event.action,
            target: event.target,
            initialWorkers,
            finalWorkers,
            actualTime,
            success: true
          });
          
        } catch (error) {
          systemErrors++;
          eventResults.push({
            event: i + 1,
            action: event.action,
            target: event.target,
            initialWorkers,
            finalWorkers: clusterManager.workers.size,
            actualTime: performance.now() - startTime,
            success: false,
            error: error.message
          });
        }
        
        // Brief pause between events
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      const successfulEvents = eventResults.filter(r => r.success).length;
      const avgEventTime = eventResults.reduce((sum, r) => sum + r.actualTime, 0) / eventResults.length;
      const finalSystemState = clusterManager.getClusterHealth();
      
      console.log(`Rapid Scaling Stability Test Results:
        - Total events: ${rapidScalingEvents.length}
        - Successful events: ${successfulEvents}
        - System errors: ${systemErrors}
        - Average event time: ${avgEventTime.toFixed(2)}ms
        - Final system health: ${finalSystemState.isHealthy ? 'HEALTHY' : 'UNHEALTHY'}
        - Final worker count: ${clusterManager.workers.size}`);
      
      eventResults.forEach(result => {
        console.log(`  Event ${result.event}: ${result.action} to ${result.target} - ${result.success ? 'SUCCESS' : 'FAILED'} (${result.actualTime.toFixed(2)}ms)`);
      });

      expect(successfulEvents).toBeGreaterThanOrEqual(rapidScalingEvents.length * 0.8); // At least 80% success
      expect(systemErrors).toBeLessThan(3); // Limited system errors
      expect(finalSystemState.isHealthy).toBe(true); // System should remain healthy
      expect(avgEventTime).toBeLessThan(8000); // Average event time under 8 seconds
    }, 60000);
  });
});