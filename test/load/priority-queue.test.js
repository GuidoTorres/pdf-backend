import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import PriorityQueueManager from '../../src/services/priorityQueueManager.js';
import ClusterManager from '../../src/services/clusterManager.js';
import LoadBalancer from '../../src/services/loadBalancer.js';
import { performance } from 'perf_hooks';

// Mock dependencies
vi.mock('../../src/services/logService.js');
vi.mock('../../src/services/databaseService.js');
vi.mock('ioredis');
vi.mock('bullmq');

describe('Priority Queue System Load Tests', () => {
  let priorityQueueManager;
  let clusterManager;
  let loadBalancer;
  let mockQueues;
  let processedJobs;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    processedJobs = [];
    
    // Mock BullMQ queues with priority handling
    mockQueues = {
      'pdf-processing-premium': {
        add: vi.fn(async (jobName, data, options) => {
          const job = {
            id: `premium-${Date.now()}-${Math.random()}`,
            data,
            opts: options,
            queue: 'pdf-processing-premium',
            priority: options?.priority || 1,
            timestamp: Date.now()
          };
          processedJobs.push(job);
          return job;
        }),
        getWaiting: vi.fn(() => Promise.resolve([])),
        getActive: vi.fn(() => Promise.resolve([])),
        getCompleted: vi.fn(() => Promise.resolve([])),
        clean: vi.fn(() => Promise.resolve())
      },
      'pdf-processing-normal': {
        add: vi.fn(async (jobName, data, options) => {
          const job = {
            id: `normal-${Date.now()}-${Math.random()}`,
            data,
            opts: options,
            queue: 'pdf-processing-normal',
            priority: options?.priority || 3,
            timestamp: Date.now()
          };
          processedJobs.push(job);
          return job;
        }),
        getWaiting: vi.fn(() => Promise.resolve([])),
        getActive: vi.fn(() => Promise.resolve([])),
        getCompleted: vi.fn(() => Promise.resolve([])),
        clean: vi.fn(() => Promise.resolve())
      },
      'pdf-processing-large': {
        add: vi.fn(async (jobName, data, options) => {
          const job = {
            id: `large-${Date.now()}-${Math.random()}`,
            data,
            opts: options,
            queue: 'pdf-processing-large',
            priority: options?.priority || 4,
            timestamp: Date.now()
          };
          processedJobs.push(job);
          return job;
        }),
        getWaiting: vi.fn(() => Promise.resolve([])),
        getActive: vi.fn(() => Promise.resolve([])),
        getCompleted: vi.fn(() => Promise.resolve([])),
        clean: vi.fn(() => Promise.resolve())
      }
    };

    vi.doMock('bullmq', () => ({
      Queue: vi.fn((queueName) => mockQueues[queueName])
    }));

    // Mock Redis
    const mockRedis = {
      setex: vi.fn(),
      get: vi.fn(),
      quit: vi.fn()
    };

    vi.doMock('ioredis', () => {
      return vi.fn(() => mockRedis);
    });

    // Initialize services
    priorityQueueManager = new PriorityQueueManager();
    clusterManager = new ClusterManager({
      minWorkers: 3,
      maxWorkers: 10
    });
    loadBalancer = new LoadBalancer(clusterManager);
  });

  afterEach(async () => {
    if (priorityQueueManager) {
      await priorityQueueManager.close();
    }
    if (clusterManager) {
      await clusterManager.stop();
    }
    processedJobs = [];
  });

  describe('Priority Processing Order', () => {
    test('premium users should process before normal users under load', async () => {
      const normalUsers = 20;
      const premiumUsers = 10;
      const unlimitedUsers = 5;
      
      // First, queue normal users
      const normalPromises = Array.from({ length: normalUsers }, async (_, i) => {
        const jobData = {
          fileId: `normal-file-${i}`,
          filename: `normal-${i}.pdf`,
          userId: `normal-user-${i}`,
          userPlan: 'normal',
          fileSize: 5 * 1024 * 1024, // 5MB
          queuedAt: Date.now()
        };

        return await priorityQueueManager.addJob(jobData, 'normal', jobData.fileSize);
      });

      // Wait a bit to ensure normal users are queued first
      await Promise.all(normalPromises);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Then queue premium users
      const premiumPromises = Array.from({ length: premiumUsers }, async (_, i) => {
        const jobData = {
          fileId: `premium-file-${i}`,
          filename: `premium-${i}.pdf`,
          userId: `premium-user-${i}`,
          userPlan: 'premium',
          fileSize: 8 * 1024 * 1024, // 8MB
          queuedAt: Date.now()
        };

        return await priorityQueueManager.addJob(jobData, 'premium', jobData.fileSize);
      });

      await Promise.all(premiumPromises);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Finally queue unlimited users
      const unlimitedPromises = Array.from({ length: unlimitedUsers }, async (_, i) => {
        const jobData = {
          fileId: `unlimited-file-${i}`,
          filename: `unlimited-${i}.pdf`,
          userId: `unlimited-user-${i}`,
          userPlan: 'unlimited',
          fileSize: 12 * 1024 * 1024, // 12MB
          queuedAt: Date.now()
        };

        return await priorityQueueManager.addJob(jobData, 'unlimited', jobData.fileSize);
      });

      await Promise.all(unlimitedPromises);

      // Analyze processing order
      const sortedJobs = processedJobs.sort((a, b) => a.timestamp - b.timestamp);
      
      // Find first jobs of each type
      const firstNormal = sortedJobs.find(job => job.data.userPlan === 'normal');
      const firstPremium = sortedJobs.find(job => job.data.userPlan === 'premium');
      const firstUnlimited = sortedJobs.find(job => job.data.userPlan === 'unlimited');

      // Count jobs by queue
      const queueCounts = {
        premium: sortedJobs.filter(job => job.queue === 'pdf-processing-premium').length,
        normal: sortedJobs.filter(job => job.queue === 'pdf-processing-normal').length,
        large: sortedJobs.filter(job => job.queue === 'pdf-processing-large').length
      };

      console.log(`Priority Queue Test Results:
        - Total jobs processed: ${sortedJobs.length}
        - Premium queue jobs: ${queueCounts.premium}
        - Normal queue jobs: ${queueCounts.normal}
        - Large queue jobs: ${queueCounts.large}
        - First normal job priority: ${firstNormal?.priority}
        - First premium job priority: ${firstPremium?.priority}
        - First unlimited job priority: ${firstUnlimited?.priority}`);

      // Assertions
      expect(sortedJobs.length).toBe(normalUsers + premiumUsers + unlimitedUsers);
      expect(queueCounts.premium).toBe(premiumUsers + unlimitedUsers); // Premium + unlimited go to premium queue
      expect(queueCounts.normal).toBe(normalUsers);
      expect(firstPremium?.priority).toBeLessThan(firstNormal?.priority); // Lower number = higher priority
      expect(firstUnlimited?.priority).toBeLessThan(firstPremium?.priority);
    }, 30000);

    test('large files should be routed to dedicated queue regardless of user plan', async () => {
      const testCases = [
        { userPlan: 'normal', fileSize: 60 * 1024 * 1024, expectedQueue: 'pdf-processing-large' },
        { userPlan: 'premium', fileSize: 75 * 1024 * 1024, expectedQueue: 'pdf-processing-large' },
        { userPlan: 'unlimited', fileSize: 100 * 1024 * 1024, expectedQueue: 'pdf-processing-large' },
        { userPlan: 'normal', fileSize: 30 * 1024 * 1024, expectedQueue: 'pdf-processing-normal' },
        { userPlan: 'premium', fileSize: 40 * 1024 * 1024, expectedQueue: 'pdf-processing-premium' }
      ];

      const jobPromises = testCases.map(async (testCase, i) => {
        const jobData = {
          fileId: `large-test-${i}`,
          filename: `large-test-${i}.pdf`,
          userId: `user-${i}`,
          userPlan: testCase.userPlan,
          fileSize: testCase.fileSize
        };

        const job = await priorityQueueManager.addJob(jobData, testCase.userPlan, testCase.fileSize);
        
        return {
          ...testCase,
          actualQueue: job.queue,
          jobId: job.id
        };
      });

      const results = await Promise.all(jobPromises);
      
      // Verify queue routing
      results.forEach((result, i) => {
        console.log(`Test case ${i + 1}: ${result.userPlan} user, ${(result.fileSize / 1024 / 1024).toFixed(1)}MB -> ${result.actualQueue}`);
        expect(result.actualQueue).toBe(result.expectedQueue);
      });

      // Verify large files are properly identified
      const largeFileJobs = results.filter(r => r.fileSize > 50 * 1024 * 1024);
      const allLargeInCorrectQueue = largeFileJobs.every(job => job.actualQueue === 'pdf-processing-large');
      
      expect(allLargeInCorrectQueue).toBe(true);
    }, 15000);

    test('should maintain priority order during high concurrent load', async () => {
      const concurrentLoad = 100;
      const userPlans = ['normal', 'premium', 'unlimited'];
      
      // Create mixed concurrent load
      const jobPromises = Array.from({ length: concurrentLoad }, async (_, i) => {
        const userPlan = userPlans[i % userPlans.length];
        const fileSize = Math.floor(Math.random() * 40 * 1024 * 1024) + 1024 * 1024; // 1-40MB
        
        const jobData = {
          fileId: `concurrent-${i}`,
          filename: `concurrent-${i}.pdf`,
          userId: `user-${i}`,
          userPlan,
          fileSize,
          submissionOrder: i
        };

        // Add random delay to simulate real-world timing
        await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
        
        return await priorityQueueManager.addJob(jobData, userPlan, fileSize);
      });

      const jobs = await Promise.all(jobPromises);
      
      // Analyze priority distribution
      const jobsByQueue = {
        premium: jobs.filter(job => job.queue === 'pdf-processing-premium'),
        normal: jobs.filter(job => job.queue === 'pdf-processing-normal'),
        large: jobs.filter(job => job.queue === 'pdf-processing-large')
      };

      const priorityDistribution = {
        priority1: jobs.filter(job => job.priority === 1).length, // unlimited
        priority2: jobs.filter(job => job.priority === 2).length, // premium
        priority3: jobs.filter(job => job.priority === 3).length, // normal
        priority4: jobs.filter(job => job.priority === 4).length  // large
      };

      console.log(`Concurrent Priority Test Results:
        - Total jobs: ${jobs.length}
        - Premium queue: ${jobsByQueue.premium.length}
        - Normal queue: ${jobsByQueue.normal.length}
        - Large queue: ${jobsByQueue.large.length}
        - Priority 1 (unlimited): ${priorityDistribution.priority1}
        - Priority 2 (premium): ${priorityDistribution.priority2}
        - Priority 3 (normal): ${priorityDistribution.priority3}
        - Priority 4 (large): ${priorityDistribution.priority4}`);

      expect(jobs.length).toBe(concurrentLoad);
      expect(jobsByQueue.premium.length + jobsByQueue.normal.length + jobsByQueue.large.length).toBe(concurrentLoad);
      
      // Verify priority assignment is correct
      jobsByQueue.premium.forEach(job => {
        expect([1, 2]).toContain(job.priority); // unlimited or premium
      });
      
      jobsByQueue.normal.forEach(job => {
        expect(job.priority).toBe(3); // normal priority
      });
      
      jobsByQueue.large.forEach(job => {
        expect(job.priority).toBe(4); // large file priority
      });
    }, 45000);
  });

  describe('Queue Performance Under Load', () => {
    test('should handle rapid priority changes efficiently', async () => {
      const rapidChanges = 50;
      const startTime = performance.now();
      
      // Simulate rapid priority changes by alternating user types
      const rapidJobPromises = Array.from({ length: rapidChanges }, async (_, i) => {
        const userPlans = ['normal', 'premium', 'unlimited', 'normal', 'premium'];
        const userPlan = userPlans[i % userPlans.length];
        const fileSize = 5 * 1024 * 1024; // 5MB
        
        const jobData = {
          fileId: `rapid-${i}`,
          filename: `rapid-${i}.pdf`,
          userId: `rapid-user-${i}`,
          userPlan,
          fileSize,
          sequence: i
        };

        const jobStartTime = performance.now();
        const job = await priorityQueueManager.addJob(jobData, userPlan, fileSize);
        const jobEndTime = performance.now();
        
        return {
          job,
          processingTime: jobEndTime - jobStartTime,
          sequence: i,
          userPlan
        };
      });

      const results = await Promise.all(rapidJobPromises);
      const totalTime = performance.now() - startTime;
      
      const avgProcessingTime = results.reduce((sum, r) => sum + r.processingTime, 0) / results.length;
      const maxProcessingTime = Math.max(...results.map(r => r.processingTime));
      
      // Verify priority assignment consistency
      const priorityConsistency = results.every(result => {
        const expectedPriority = priorityQueueManager.calculatePriority(result.userPlan);
        return result.job.priority === expectedPriority;
      });

      console.log(`Rapid Priority Changes Test Results:
        - Total jobs: ${rapidChanges}
        - Total time: ${totalTime.toFixed(2)}ms
        - Average job processing time: ${avgProcessingTime.toFixed(2)}ms
        - Max job processing time: ${maxProcessingTime.toFixed(2)}ms
        - Priority consistency: ${priorityConsistency ? 'PASS' : 'FAIL'}
        - Throughput: ${(rapidChanges / (totalTime / 1000)).toFixed(2)} jobs/second`);

      expect(priorityConsistency).toBe(true);
      expect(avgProcessingTime).toBeLessThan(100); // Average under 100ms per job
      expect(maxProcessingTime).toBeLessThan(500); // Max under 500ms per job
      expect(totalTime).toBeLessThan(10000); // Total under 10 seconds
    }, 30000);

    test('should maintain queue statistics accuracy under load', async () => {
      const loadSize = 75;
      const userPlanDistribution = {
        normal: Math.floor(loadSize * 0.6), // 60%
        premium: Math.floor(loadSize * 0.3), // 30%
        unlimited: Math.floor(loadSize * 0.1) // 10%
      };

      // Add jobs with known distribution
      const allJobPromises = [];
      
      Object.entries(userPlanDistribution).forEach(([userPlan, count]) => {
        for (let i = 0; i < count; i++) {
          const jobPromise = (async () => {
            const fileSize = Math.random() > 0.9 ? 60 * 1024 * 1024 : 10 * 1024 * 1024; // 10% large files
            
            const jobData = {
              fileId: `stats-${userPlan}-${i}`,
              filename: `stats-${userPlan}-${i}.pdf`,
              userId: `stats-user-${userPlan}-${i}`,
              userPlan,
              fileSize
            };

            return await priorityQueueManager.addJob(jobData, userPlan, fileSize);
          })();
          
          allJobPromises.push(jobPromise);
        }
      });

      const jobs = await Promise.all(allJobPromises);
      
      // Get queue statistics
      const queueStats = await priorityQueueManager.getQueueStats();
      
      // Analyze actual distribution
      const actualDistribution = {
        premium: jobs.filter(job => job.queue === 'pdf-processing-premium').length,
        normal: jobs.filter(job => job.queue === 'pdf-processing-normal').length,
        large: jobs.filter(job => job.queue === 'pdf-processing-large').length
      };

      const totalJobs = Object.values(actualDistribution).reduce((a, b) => a + b, 0);
      
      console.log(`Queue Statistics Test Results:
        - Expected total jobs: ${loadSize}
        - Actual total jobs: ${totalJobs}
        - Premium queue: ${actualDistribution.premium}
        - Normal queue: ${actualDistribution.normal}
        - Large queue: ${actualDistribution.large}
        - Queue stats available: ${Object.keys(queueStats).length > 0 ? 'YES' : 'NO'}`);

      expect(totalJobs).toBe(loadSize);
      expect(actualDistribution.premium).toBeGreaterThan(0); // Should have premium jobs
      expect(actualDistribution.normal).toBeGreaterThan(0); // Should have normal jobs
      expect(Object.keys(queueStats).length).toBeGreaterThan(0); // Stats should be available
    }, 30000);
  });

  describe('Priority Queue Fairness', () => {
    test('should prevent starvation of normal users', async () => {
      const normalUsers = 30;
      const premiumUsers = 20;
      const processingWindow = 10000; // 10 seconds
      
      // Queue normal users first
      const normalPromises = Array.from({ length: normalUsers }, async (_, i) => {
        const jobData = {
          fileId: `fairness-normal-${i}`,
          filename: `fairness-normal-${i}.pdf`,
          userId: `fairness-normal-user-${i}`,
          userPlan: 'normal',
          fileSize: 5 * 1024 * 1024,
          queuedAt: Date.now()
        };

        return await priorityQueueManager.addJob(jobData, 'normal', jobData.fileSize);
      });

      await Promise.all(normalPromises);
      
      // Continuously add premium users during processing window
      const premiumInterval = setInterval(async () => {
        const i = Math.floor(Math.random() * 1000);
        const jobData = {
          fileId: `fairness-premium-${i}`,
          filename: `fairness-premium-${i}.pdf`,
          userId: `fairness-premium-user-${i}`,
          userPlan: 'premium',
          fileSize: 8 * 1024 * 1024,
          queuedAt: Date.now()
        };

        try {
          await priorityQueueManager.addJob(jobData, 'premium', jobData.fileSize);
        } catch (error) {
          console.warn('Premium job failed:', error.message);
        }
      }, 200); // Add premium job every 200ms

      // Stop adding premium jobs after processing window
      setTimeout(() => {
        clearInterval(premiumInterval);
      }, processingWindow);

      await new Promise(resolve => setTimeout(resolve, processingWindow + 1000));

      // Analyze fairness
      const normalJobs = processedJobs.filter(job => job.data.userPlan === 'normal');
      const premiumJobs = processedJobs.filter(job => job.data.userPlan === 'premium');
      
      const normalJobsRatio = normalJobs.length / processedJobs.length;
      const premiumJobsRatio = premiumJobs.length / processedJobs.length;

      console.log(`Fairness Test Results:
        - Total jobs processed: ${processedJobs.length}
        - Normal jobs: ${normalJobs.length} (${(normalJobsRatio * 100).toFixed(1)}%)
        - Premium jobs: ${premiumJobs.length} (${(premiumJobsRatio * 100).toFixed(1)}%)
        - Normal jobs queued initially: ${normalUsers}`);

      // Ensure normal users aren't completely starved
      expect(normalJobs.length).toBeGreaterThan(0);
      expect(normalJobsRatio).toBeGreaterThan(0.2); // At least 20% should be normal users
      expect(normalJobs.length).toBe(normalUsers); // All normal jobs should be processed
    }, 45000);

    test('should handle mixed priority workloads efficiently', async () => {
      const workloadMix = {
        unlimited: 5,
        premium: 15,
        normal: 25,
        large: 10 // Large files from various user types
      };

      const startTime = performance.now();
      const allPromises = [];

      // Add unlimited users
      for (let i = 0; i < workloadMix.unlimited; i++) {
        allPromises.push((async () => {
          const jobData = {
            fileId: `mixed-unlimited-${i}`,
            filename: `mixed-unlimited-${i}.pdf`,
            userId: `mixed-unlimited-user-${i}`,
            userPlan: 'unlimited',
            fileSize: 15 * 1024 * 1024
          };
          return await priorityQueueManager.addJob(jobData, 'unlimited', jobData.fileSize);
        })());
      }

      // Add premium users
      for (let i = 0; i < workloadMix.premium; i++) {
        allPromises.push((async () => {
          const jobData = {
            fileId: `mixed-premium-${i}`,
            filename: `mixed-premium-${i}.pdf`,
            userId: `mixed-premium-user-${i}`,
            userPlan: 'premium',
            fileSize: 12 * 1024 * 1024
          };
          return await priorityQueueManager.addJob(jobData, 'premium', jobData.fileSize);
        })());
      }

      // Add normal users
      for (let i = 0; i < workloadMix.normal; i++) {
        allPromises.push((async () => {
          const jobData = {
            fileId: `mixed-normal-${i}`,
            filename: `mixed-normal-${i}.pdf`,
            userId: `mixed-normal-user-${i}`,
            userPlan: 'normal',
            fileSize: 8 * 1024 * 1024
          };
          return await priorityQueueManager.addJob(jobData, 'normal', jobData.fileSize);
        })());
      }

      // Add large files from various user types
      for (let i = 0; i < workloadMix.large; i++) {
        const userPlans = ['normal', 'premium', 'unlimited'];
        const userPlan = userPlans[i % userPlans.length];
        
        allPromises.push((async () => {
          const jobData = {
            fileId: `mixed-large-${i}`,
            filename: `mixed-large-${i}.pdf`,
            userId: `mixed-large-user-${i}`,
            userPlan,
            fileSize: 80 * 1024 * 1024 // 80MB - definitely large
          };
          return await priorityQueueManager.addJob(jobData, userPlan, jobData.fileSize);
        })());
      }

      const jobs = await Promise.all(allPromises);
      const totalTime = performance.now() - startTime;

      // Analyze workload distribution
      const queueDistribution = {
        premium: jobs.filter(job => job.queue === 'pdf-processing-premium').length,
        normal: jobs.filter(job => job.queue === 'pdf-processing-normal').length,
        large: jobs.filter(job => job.queue === 'pdf-processing-large').length
      };

      const priorityDistribution = {
        1: jobs.filter(job => job.priority === 1).length, // unlimited
        2: jobs.filter(job => job.priority === 2).length, // premium
        3: jobs.filter(job => job.priority === 3).length, // normal
        4: jobs.filter(job => job.priority === 4).length  // large
      };

      const totalExpected = Object.values(workloadMix).reduce((a, b) => a + b, 0);

      console.log(`Mixed Workload Test Results:
        - Expected total: ${totalExpected}
        - Actual total: ${jobs.length}
        - Processing time: ${totalTime.toFixed(2)}ms
        - Queue distribution:
          * Premium: ${queueDistribution.premium}
          * Normal: ${queueDistribution.normal}
          * Large: ${queueDistribution.large}
        - Priority distribution:
          * Priority 1: ${priorityDistribution[1]}
          * Priority 2: ${priorityDistribution[2]}
          * Priority 3: ${priorityDistribution[3]}
          * Priority 4: ${priorityDistribution[4]}`);

      expect(jobs.length).toBe(totalExpected);
      expect(queueDistribution.large).toBe(workloadMix.large); // All large files in large queue
      expect(priorityDistribution[1]).toBe(workloadMix.unlimited); // All unlimited users priority 1
      expect(totalTime).toBeLessThan(15000); // Complete within 15 seconds
    }, 30000);
  });
});