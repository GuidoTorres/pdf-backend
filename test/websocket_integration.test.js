import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import { io } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import webSocketManager from '../src/services/websocketManager.js';
import dashboardService from '../src/services/dashboardService.js';
import timeEstimationService from '../src/services/timeEstimationService.js';

describe('WebSocket Real-time Monitoring System', () => {
  let server;
  let userSocket;
  let adminSocket;
  let testToken;
  let adminToken;

  beforeAll(async () => {
    // Create simple HTTP server for testing
    server = createServer();
    server.listen(0); // Use random port for testing
    const port = server.address().port;
    
    // Create test tokens (using a simple secret for testing)
    const testSecret = 'test-secret-key';
    testToken = jwt.sign(
      { userId: 'test-user-123', email: 'test@example.com' },
      testSecret,
      { expiresIn: '1h' }
    );
    
    adminToken = jwt.sign(
      { userId: 'admin-user-456', email: 'admin@example.com' },
      testSecret,
      { expiresIn: '1h' }
    );

    // Initialize WebSocket server
    webSocketManager.initialize(server);
    dashboardService.startMetricsCollection();
  });

  afterAll(async () => {
    if (userSocket) userSocket.disconnect();
    if (adminSocket) adminSocket.disconnect();
    dashboardService.stopMetricsCollection();
    server.close();
  });

  describe('WebSocket Manager', () => {
    it('should initialize WebSocket server correctly', () => {
      expect(webSocketManager.getIO()).toBeDefined();
      expect(webSocketManager.getConnectedUsersCount()).toBe(0);
      expect(webSocketManager.getConnectedAdminsCount()).toBe(0);
    });

    it('should handle user authentication', (done) => {
      const port = server.address().port;
      userSocket = io(`http://localhost:${port}`);

      userSocket.on('connect', () => {
        userSocket.emit('authenticate', { token: testToken, isAdmin: false });
      });

      userSocket.on('authenticated', (data) => {
        expect(data.userId).toBe('test-user-123');
        expect(data.isAdmin).toBe(false);
        expect(webSocketManager.getConnectedUsersCount()).toBe(1);
        done();
      });

      userSocket.on('auth-error', (error) => {
        done(new Error(`Authentication failed: ${error.message}`));
      });
    });

    it('should handle admin authentication', (done) => {
      const port = server.address().port;
      adminSocket = io(`http://localhost:${port}`);

      adminSocket.on('connect', () => {
        adminSocket.emit('authenticate', { token: adminToken, isAdmin: true });
      });

      adminSocket.on('authenticated', (data) => {
        expect(data.userId).toBe('admin-user-456');
        expect(data.isAdmin).toBe(true);
        expect(webSocketManager.getConnectedAdminsCount()).toBe(1);
        done();
      });
    });

    it('should reject invalid authentication', (done) => {
      const port = server.address().port;
      const invalidSocket = io(`http://localhost:${port}`);

      invalidSocket.on('connect', () => {
        invalidSocket.emit('authenticate', { token: 'invalid-token' });
      });

      invalidSocket.on('auth-error', (error) => {
        expect(error.message).toBe('Invalid token');
        invalidSocket.disconnect();
        done();
      });
    });

    it('should broadcast queue status updates', (done) => {
      let updateCount = 0;
      
      userSocket.on('queue-status', (data) => {
        updateCount++;
        expect(data).toHaveProperty('queues');
        expect(data).toHaveProperty('totalWaiting');
        expect(data).toHaveProperty('totalActive');
        expect(data).toHaveProperty('activeWorkers');
        expect(data).toHaveProperty('timestamp');
        
        if (updateCount >= 1) {
          done();
        }
      });

      // Trigger queue status broadcast
      webSocketManager.broadcastQueueStatus();
    });

    it('should send admin metrics to admin users', (done) => {
      adminSocket.emit('request-admin-metrics');
      
      adminSocket.on('admin-metrics', (data) => {
        expect(data).toHaveProperty('queues');
        expect(data).toHaveProperty('workers');
        expect(data).toHaveProperty('performance');
        expect(data).toHaveProperty('system');
        expect(data).toHaveProperty('timestamp');
        done();
      });
    });
  });

  describe('Time Estimation Service', () => {
    it('should calculate processing time estimates', () => {
      const estimation = timeEstimationService.estimateProcessingTime({
        fileSize: 5 * 1024 * 1024, // 5MB
        priority: 'normal',
        currentQueueLength: 3
      });

      expect(estimation).toHaveProperty('estimatedTime');
      expect(estimation).toHaveProperty('queueWaitTime');
      expect(estimation).toHaveProperty('processingTime');
      expect(estimation).toHaveProperty('confidence');
      expect(estimation).toHaveProperty('factors');
      
      expect(estimation.estimatedTime).toBeGreaterThan(0);
      expect(estimation.confidence).toBeGreaterThanOrEqual(0);
      expect(estimation.confidence).toBeLessThanOrEqual(100);
    });

    it('should record processing metrics', () => {
      const jobData = {
        fileSize: 2 * 1024 * 1024, // 2MB
        processingTime: 15000, // 15 seconds
        queue: 'normal',
        workerId: 'worker-1',
        success: true
      };

      timeEstimationService.recordProcessingTime(jobData);
      
      const stats = timeEstimationService.getEstimationStatistics();
      expect(stats.totalHistoricalRecords).toBeGreaterThan(0);
    });

    it('should handle different file size categories', () => {
      const smallFile = timeEstimationService.estimateProcessingTime({
        fileSize: 500 * 1024, // 500KB
        priority: 'normal'
      });

      const largeFile = timeEstimationService.estimateProcessingTime({
        fileSize: 100 * 1024 * 1024, // 100MB
        priority: 'large'
      });

      expect(largeFile.estimatedTime).toBeGreaterThan(smallFile.estimatedTime);
    });

    it('should apply priority multipliers correctly', () => {
      const normalEstimate = timeEstimationService.estimateProcessingTime({
        fileSize: 5 * 1024 * 1024,
        priority: 'normal'
      });

      const premiumEstimate = timeEstimationService.estimateProcessingTime({
        fileSize: 5 * 1024 * 1024,
        priority: 'premium'
      });

      expect(premiumEstimate.processingTime).toBeLessThan(normalEstimate.processingTime);
    });
  });

  describe('Dashboard Service', () => {
    it('should collect current metrics', async () => {
      const metrics = await dashboardService.collectCurrentMetrics();
      
      expect(metrics).toHaveProperty('timestamp');
      expect(metrics).toHaveProperty('queues');
      expect(metrics).toHaveProperty('workers');
      expect(metrics).toHaveProperty('performance');
      expect(metrics).toHaveProperty('system');
      expect(metrics).toHaveProperty('estimation');
    });

    it('should track historical metrics', async () => {
      // Collect some metrics
      await dashboardService.collectAndStoreMetrics();
      await new Promise(resolve => setTimeout(resolve, 100));
      await dashboardService.collectAndStoreMetrics();
      
      const historical = dashboardService.getHistoricalMetrics('1h');
      expect(historical.length).toBeGreaterThanOrEqual(1);
    });

    it('should generate performance summaries', async () => {
      const summary = dashboardService.getPerformanceSummary('1h');
      
      expect(summary).toHaveProperty('totalJobs');
      expect(summary).toHaveProperty('averageProcessingTime');
      expect(summary).toHaveProperty('successRate');
      expect(summary).toHaveProperty('peakQueueLength');
      expect(summary).toHaveProperty('averageWorkers');
    });

    it('should provide queue analytics', () => {
      const analytics = dashboardService.getQueueAnalytics();
      
      expect(analytics).toHaveProperty('queueTrends');
      expect(analytics).toHaveProperty('processingTrends');
      expect(analytics).toHaveProperty('workerUtilization');
    });

    it('should update alert thresholds', () => {
      const newThresholds = {
        queueLength: 25,
        processingTime: 90
      };
      
      dashboardService.updateThresholds(newThresholds);
      const status = dashboardService.getStatus();
      
      expect(status.thresholds.queueLength).toBe(25);
      expect(status.thresholds.processingTime).toBe(90);
    });
  });

  describe('Dashboard API Routes', () => {
    it('should get current metrics via API', async () => {
      const response = await request(app)
        .get('/api/dashboard/metrics')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('timestamp');
      expect(response.body.data).toHaveProperty('queues');
    });

    it('should get historical metrics via API', async () => {
      const response = await request(app)
        .get('/api/dashboard/metrics/history?timeRange=1h')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('metrics');
      expect(response.body.data).toHaveProperty('timeRange');
      expect(response.body.data.timeRange).toBe('1h');
    });

    it('should get performance summary via API', async () => {
      const response = await request(app)
        .get('/api/dashboard/performance')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('totalJobs');
      expect(response.body.data).toHaveProperty('averageProcessingTime');
    });

    it('should test time estimation via API', async () => {
      const response = await request(app)
        .post('/api/dashboard/estimation/test')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          fileSize: 5000000,
          priority: 'normal',
          currentQueueLength: 2
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('estimatedTime');
      expect(response.body.data).toHaveProperty('confidence');
    });

    it('should require admin authentication for dashboard routes', async () => {
      await request(app)
        .get('/api/dashboard/metrics')
        .set('Authorization', `Bearer ${testToken}`)
        .expect(403);
    });

    it('should get WebSocket status via API', async () => {
      const response = await request(app)
        .get('/api/dashboard/websocket/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('connectedUsers');
      expect(response.body.data).toHaveProperty('connectedAdmins');
      expect(response.body.data).toHaveProperty('isActive');
    });
  });

  describe('Job Progress Notifications', () => {
    it('should notify job queued events', (done) => {
      const jobData = {
        jobId: 'test-job-123',
        fileName: 'test.pdf',
        queuePosition: 1,
        priority: 'normal',
        queue: 'normal',
        fileSize: 1024 * 1024
      };

      userSocket.on('job-queued', (data) => {
        expect(data.jobId).toBe('test-job-123');
        expect(data.fileName).toBe('test.pdf');
        expect(data).toHaveProperty('estimatedTime');
        expect(data).toHaveProperty('queuePosition');
        done();
      });

      webSocketManager.notifyJobQueued('test-user-123', jobData);
    });

    it('should notify job started events', (done) => {
      const jobData = {
        jobId: 'test-job-123',
        workerId: 'worker-1',
        queue: 'normal'
      };

      userSocket.on('job-started', (data) => {
        expect(data.jobId).toBe('test-job-123');
        expect(data.workerId).toBe('worker-1');
        expect(data).toHaveProperty('startedAt');
        done();
      });

      webSocketManager.notifyJobStarted('test-user-123', jobData);
    });

    it('should notify job progress events', (done) => {
      const progressData = {
        jobId: 'test-job-123',
        progress: 50,
        stage: 'processing',
        estimatedTimeRemaining: 30
      };

      userSocket.on('job-progress', (data) => {
        expect(data.jobId).toBe('test-job-123');
        expect(data.progress).toBe(50);
        expect(data.stage).toBe('processing');
        expect(data.estimatedTimeRemaining).toBe(30);
        done();
      });

      webSocketManager.notifyJobProgress('test-user-123', progressData);
    });

    it('should notify job completed events', (done) => {
      const resultData = {
        jobId: 'test-job-123',
        success: true,
        result: { transactions: 5 },
        processingTime: 45000,
        queue: 'normal',
        fileSize: 1024 * 1024,
        workerId: 'worker-1'
      };

      userSocket.on('job-completed', (data) => {
        expect(data.jobId).toBe('test-job-123');
        expect(data.success).toBe(true);
        expect(data.processingTime).toBe(45000);
        expect(data).toHaveProperty('completedAt');
        done();
      });

      webSocketManager.notifyJobCompleted('test-user-123', resultData);
    });

    it('should notify job failed events', (done) => {
      const errorData = {
        jobId: 'test-job-123',
        error: 'Processing failed',
        retryCount: 1,
        canRetry: true,
        queue: 'normal'
      };

      userSocket.on('job-failed', (data) => {
        expect(data.jobId).toBe('test-job-123');
        expect(data.error).toBe('Processing failed');
        expect(data.retryCount).toBe(1);
        expect(data.canRetry).toBe(true);
        done();
      });

      webSocketManager.notifyJobFailed('test-user-123', errorData);
    });
  });

  describe('Worker Metrics Updates', () => {
    it('should update worker metrics', () => {
      const metrics = {
        jobsInProgress: 2,
        jobsCompletedHour: 15,
        avgProcessingTime: 25,
        memoryUsageMb: 512,
        cpuUsagePercent: 45,
        status: 'active'
      };

      webSocketManager.updateWorkerMetrics('worker-1', metrics);
      
      const adminMetrics = webSocketManager.getAdminMetrics();
      const worker = adminMetrics.workers.find(w => w.workerId === 'worker-1');
      
      expect(worker).toBeDefined();
      expect(worker.jobsInProgress).toBe(2);
      expect(worker.status).toBe('active');
    });

    it('should remove worker metrics', () => {
      webSocketManager.removeWorkerMetrics('worker-1');
      
      const adminMetrics = webSocketManager.getAdminMetrics();
      const worker = adminMetrics.workers.find(w => w.workerId === 'worker-1');
      
      expect(worker).toBeUndefined();
    });
  });
});