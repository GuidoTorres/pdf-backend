import { io } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import config from './src/config/config.js';

// Test WebSocket system functionality
async function testWebSocketSystem() {
  console.log('🧪 Testing WebSocket System...\n');

  // Create test JWT token
  const testToken = jwt.sign(
    { userId: 'test-user-123', email: 'test@example.com' },
    config.jwtSecret,
    { expiresIn: '1h' }
  );

  const adminToken = jwt.sign(
    { userId: 'admin-user-456', email: 'admin@example.com' },
    config.jwtSecret,
    { expiresIn: '1h' }
  );

  // Test 1: Regular user connection
  console.log('📡 Test 1: Regular user WebSocket connection');
  const userSocket = io('http://localhost:3000', {
    transports: ['websocket']
  });

  userSocket.on('connect', () => {
    console.log('✅ User socket connected');
    
    // Authenticate user
    userSocket.emit('authenticate', { token: testToken, isAdmin: false });
  });

  userSocket.on('authenticated', (data) => {
    console.log('✅ User authenticated:', data);
    
    // Request job status
    userSocket.emit('request-job-status', 'test-job-123');
  });

  userSocket.on('job-status-response', (data) => {
    console.log('✅ Received job status response:', data);
  });

  userSocket.on('queue-status', (data) => {
    console.log('✅ Received queue status update:', {
      totalWaiting: data.totalWaiting,
      totalActive: data.totalActive,
      activeWorkers: data.activeWorkers
    });
  });

  // Test 2: Admin connection
  console.log('\n📡 Test 2: Admin WebSocket connection');
  const adminSocket = io('http://localhost:3000', {
    transports: ['websocket']
  });

  adminSocket.on('connect', () => {
    console.log('✅ Admin socket connected');
    
    // Authenticate admin
    adminSocket.emit('authenticate', { token: adminToken, isAdmin: true });
  });

  adminSocket.on('authenticated', (data) => {
    console.log('✅ Admin authenticated:', data);
    
    // Request admin metrics
    adminSocket.emit('request-admin-metrics');
  });

  adminSocket.on('admin-metrics', (data) => {
    console.log('✅ Received admin metrics:', {
      connectedUsers: data.system.connectedUsers,
      activeWorkers: data.system.activeWorkers,
      totalWaitingJobs: data.performance.totalWaitingJobs
    });
  });

  adminSocket.on('dashboard-alert', (alert) => {
    console.log('🚨 Received dashboard alert:', alert);
  });

  // Test 3: Job progress simulation
  console.log('\n📡 Test 3: Job progress simulation');
  
  setTimeout(() => {
    console.log('📤 Simulating job queued event...');
    // This would normally be called by the queue system
    // webSocketManager.notifyJobQueued('test-user-123', {
    //   jobId: 'test-job-123',
    //   fileName: 'test.pdf',
    //   queuePosition: 1,
    //   priority: 'normal',
    //   queue: 'normal'
    // });
  }, 2000);

  setTimeout(() => {
    console.log('📤 Simulating job started event...');
    // webSocketManager.notifyJobStarted('test-user-123', {
    //   jobId: 'test-job-123',
    //   workerId: 'worker-1',
    //   queue: 'normal'
    // });
  }, 4000);

  setTimeout(() => {
    console.log('📤 Simulating job progress event...');
    // webSocketManager.notifyJobProgress('test-user-123', {
    //   jobId: 'test-job-123',
    //   progress: 50,
    //   stage: 'processing',
    //   estimatedTimeRemaining: 30
    // });
  }, 6000);

  setTimeout(() => {
    console.log('📤 Simulating job completed event...');
    // webSocketManager.notifyJobCompleted('test-user-123', {
    //   jobId: 'test-job-123',
    //   success: true,
    //   result: { transactions: 5 },
    //   processingTime: 45000,
    //   queue: 'normal'
    // });
  }, 8000);

  // Test 4: Error handling
  console.log('\n📡 Test 4: Error handling');
  
  const invalidSocket = io('http://localhost:3000', {
    transports: ['websocket']
  });

  invalidSocket.on('connect', () => {
    console.log('✅ Invalid socket connected');
    
    // Try to authenticate with invalid token
    invalidSocket.emit('authenticate', { token: 'invalid-token' });
  });

  invalidSocket.on('auth-error', (error) => {
    console.log('✅ Received expected auth error:', error.message);
    invalidSocket.disconnect();
  });

  // Cleanup after tests
  setTimeout(() => {
    console.log('\n🧹 Cleaning up test connections...');
    userSocket.disconnect();
    adminSocket.disconnect();
    console.log('✅ WebSocket system tests completed!');
    process.exit(0);
  }, 12000);
}

// Handle connection errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Start tests
testWebSocketSystem().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});