/**
 * Comprehensive tests for Failure Recovery System
 * Tests FailureRecoveryManager, CircuitBreaker, and RecoveryCoordinator
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
// Since the services use CommonJS, we need to import them differently
const FailureRecoveryManager = (await import('../src/services/failureRecoveryManager.js')).default;
const CircuitBreaker = (await import('../src/services/circuitBreaker.js')).default;
const RecoveryCoordinator = (await import('../src/services/recoveryCoordinator.js')).default;

// Mock dependencies
const mockClusterManager = {
    getActiveWorkers: vi.fn(),
    replaceWorker: vi.fn(),
    on: vi.fn(),
    emit: vi.fn()
};

const mockPriorityQueueManager = {
    addJob: vi.fn()
};

const mockWebsocketManager = {
    notifyUser: vi.fn(),
    broadcast: vi.fn()
};

const mockDatabaseService = {
    query: vi.fn()
};

const mockLogService = {
    logInfo: vi.fn(),
    logError: vi.fn(),
    logWarning: vi.fn()
};

// Mock log service
vi.mock('../src/services/logService', () => mockLogService);

describe('CircuitBreaker', () => {
    let circuitBreaker;

    beforeEach(() => {
        circuitBreaker = new CircuitBreaker({
            failureThreshold: 3,
            timeout: 1000,
            monitoringPeriod: 500
        });
    });

    afterEach(() => {
        if (circuitBreaker) {
            circuitBreaker.reset();
        }
    });

    test('should start in CLOSED state', () => {
        const state = circuitBreaker.getState();
        expect(state.state).toBe('CLOSED');
        expect(state.failureCount).toBe(0);
    });

    test('should execute successful operations in CLOSED state', async () => {
        const mockOperation = vi.fn().mockResolvedValue('success');
        
        const result = await circuitBreaker.execute(mockOperation);
        
        expect(result).toBe('success');
        expect(mockOperation).toHaveBeenCalledTimes(1);
        
        const state = circuitBreaker.getState();
        expect(state.state).toBe('CLOSED');
    });

    test('should transition to OPEN after failure threshold', async () => {
        const mockOperation = vi.fn().mockRejectedValue(new Error('Test failure'));
        
        // Ejecutar operaciones fallidas hasta alcanzar el threshold
        for (let i = 0; i < 3; i++) {
            try {
                await circuitBreaker.execute(mockOperation);
            } catch (error) {
                // Expected to fail
            }
        }
        
        const state = circuitBreaker.getState();
        expect(state.state).toBe('OPEN');
        expect(state.failureCount).toBe(3);
    });

    test('should reject operations immediately when OPEN', async () => {
        const mockOperation = vi.fn().mockRejectedValue(new Error('Test failure'));
        
        // Abrir el circuito
        for (let i = 0; i < 3; i++) {
            try {
                await circuitBreaker.execute(mockOperation);
            } catch (error) {
                // Expected to fail
            }
        }
        
        // Intentar ejecutar otra operación
        const newOperation = vi.fn().mockResolvedValue('success');
        
        await expect(circuitBreaker.execute(newOperation)).rejects.toThrow('Circuit breaker is OPEN');
        expect(newOperation).not.toHaveBeenCalled();
    });

    test('should transition to HALF_OPEN after timeout', async () => {
        const mockOperation = vi.fn().mockRejectedValue(new Error('Test failure'));
        
        // Abrir el circuito
        for (let i = 0; i < 3; i++) {
            try {
                await circuitBreaker.execute(mockOperation);
            } catch (error) {
                // Expected to fail
            }
        }
        
        // Esperar timeout
        await new Promise(resolve => setTimeout(resolve, 1100));
        
        // Intentar operación exitosa
        const successOperation = vi.fn().mockResolvedValue('success');
        const result = await circuitBreaker.execute(successOperation);
        
        expect(result).toBe('success');
        const state = circuitBreaker.getState();
        expect(state.state).toBe('HALF_OPEN');
    });

    test('should execute fallback when circuit is OPEN', async () => {
        const mockOperation = vi.fn().mockRejectedValue(new Error('Test failure'));
        const mockFallback = vi.fn().mockResolvedValue('fallback result');
        
        // Abrir el circuito
        for (let i = 0; i < 3; i++) {
            try {
                await circuitBreaker.execute(mockOperation);
            } catch (error) {
                // Expected to fail
            }
        }
        
        // Ejecutar con fallback
        const result = await circuitBreaker.execute(mockOperation, mockFallback);
        
        expect(result).toBe('fallback result');
        expect(mockFallback).toHaveBeenCalledTimes(1);
    });

    test('should provide accurate metrics', () => {
        const metrics = circuitBreaker.getMetrics();
        
        expect(metrics).toHaveProperty('state');
        expect(metrics).toHaveProperty('totalCalls');
        expect(metrics).toHaveProperty('totalFailures');
        expect(metrics).toHaveProperty('totalSuccesses');
        expect(metrics).toHaveProperty('failureRate');
        expect(metrics).toHaveProperty('successRate');
        expect(metrics).toHaveProperty('isHealthy');
    });
});

describe('FailureRecoveryManager', () => {
    let recoveryManager;

    beforeEach(() => {
        recoveryManager = new FailureRecoveryManager({
            maxRetries: 3,
            baseDelay: 100, // Reducido para tests
            maxDelay: 1000,
            workerHealthCheckInterval: 100,
            jobTimeoutMs: 5000
        });
    });

    afterEach(() => {
        if (recoveryManager) {
            recoveryManager.shutdown();
        }
    });

    test('should register and track active jobs', () => {
        const jobId = 'test-job-1';
        const workerId = 'worker-1';
        const jobData = { userId: 'user-1', fileName: 'test.pdf' };
        
        recoveryManager.registerActiveJob(jobId, workerId, jobData);
        
        expect(recoveryManager.activeJobs.has(jobId)).toBe(true);
        
        const job = recoveryManager.activeJobs.get(jobId);
        expect(job.workerId).toBe(workerId);
        expect(job.originalJob).toEqual(jobData);
        expect(job.retryCount).toBe(0);
    });

    test('should update job progress', () => {
        const jobId = 'test-job-1';
        const workerId = 'worker-1';
        const jobData = { userId: 'user-1', fileName: 'test.pdf' };
        
        recoveryManager.registerActiveJob(jobId, workerId, jobData);
        recoveryManager.updateJobProgress(jobId, 50);
        
        const job = recoveryManager.activeJobs.get(jobId);
        expect(job.progress).toBe(50);
    });

    test('should mark job as completed and remove from active jobs', () => {
        const jobId = 'test-job-1';
        const workerId = 'worker-1';
        const jobData = { userId: 'user-1', fileName: 'test.pdf' };
        
        recoveryManager.registerActiveJob(jobId, workerId, jobData);
        recoveryManager.markJobCompleted(jobId);
        
        expect(recoveryManager.activeJobs.has(jobId)).toBe(false);
    });

    test('should handle worker failure and emit events', async () => {
        const workerId = 'worker-1';
        const jobId = 'test-job-1';
        const jobData = { userId: 'user-1', fileName: 'test.pdf' };
        
        // Registrar job activo
        recoveryManager.registerActiveJob(jobId, workerId, jobData);
        
        // Mock event listeners
        const workerFailedListener = vi.fn();
        const requeueJobListener = vi.fn();
        
        recoveryManager.on('workerFailed', workerFailedListener);
        recoveryManager.on('requeueJob', requeueJobListener);
        
        // Simular fallo del worker
        await recoveryManager.handleWorkerFailure(workerId, 'Test failure');
        
        expect(recoveryManager.failedWorkers.has(workerId)).toBe(true);
        expect(workerFailedListener).toHaveBeenCalledWith(
            expect.objectContaining({
                workerId,
                reason: 'Test failure',
                affectedJobs: 1
            })
        );
    });

    test('should retry jobs with exponential backoff', async () => {
        const jobId = 'test-job-1';
        const workerId = 'worker-1';
        const jobData = { userId: 'user-1', fileName: 'test.pdf' };
        
        recoveryManager.registerActiveJob(jobId, workerId, jobData);
        
        const requeueListener = vi.fn();
        recoveryManager.on('requeueJob', requeueListener);
        
        // Simular fallo del trabajo
        const jobInfo = recoveryManager.activeJobs.get(jobId);
        await recoveryManager.handleJobFailure(jobId, jobInfo, 'Test failure');
        
        // Esperar a que se ejecute el reintento
        await new Promise(resolve => setTimeout(resolve, 200));
        
        expect(requeueListener).toHaveBeenCalledWith(
            expect.objectContaining({
                jobId,
                retryCount: 1
            })
        );
    });

    test('should mark job as permanently failed after max retries', async () => {
        const jobId = 'test-job-1';
        const workerId = 'worker-1';
        const jobData = { userId: 'user-1', fileName: 'test.pdf' };
        
        recoveryManager.registerActiveJob(jobId, workerId, jobData);
        
        const permanentFailureListener = vi.fn();
        recoveryManager.on('jobPermanentlyFailed', permanentFailureListener);
        
        // Simular múltiples fallos
        const jobInfo = recoveryManager.activeJobs.get(jobId);
        jobInfo.retryCount = 3; // Ya alcanzó el máximo
        
        await recoveryManager.handleJobFailure(jobId, jobInfo, 'Final failure');
        
        expect(permanentFailureListener).toHaveBeenCalledWith(
            expect.objectContaining({
                jobId,
                finalReason: 'Final failure',
                retryCount: 3
            })
        );
    });

    test('should calculate correct backoff delays', () => {
        const delay1 = recoveryManager.calculateBackoffDelay(1);
        const delay2 = recoveryManager.calculateBackoffDelay(2);
        const delay3 = recoveryManager.calculateBackoffDelay(3);
        
        expect(delay1).toBeGreaterThanOrEqual(100); // Base delay
        expect(delay2).toBeGreaterThan(delay1); // Exponential increase
        expect(delay3).toBeGreaterThan(delay2);
        expect(delay3).toBeLessThanOrEqual(1000); // Max delay
    });

    test('should record worker heartbeats', () => {
        const workerId = 'worker-1';
        
        recoveryManager.recordWorkerHeartbeat(workerId);
        
        expect(recoveryManager.workerHealthChecks.has(workerId)).toBe(true);
        expect(recoveryManager.workerHealthChecks.get(workerId)).toBeCloseTo(Date.now(), -2);
    });

    test('should recover pending jobs', async () => {
        const pendingJobs = [
            { id: 'job-1', userId: 'user-1', fileName: 'test1.pdf', retryCount: 0 },
            { id: 'job-2', userId: 'user-2', fileName: 'test2.pdf', retryCount: 1 },
            { id: 'job-3', userId: 'user-3', fileName: 'test3.pdf', retryCount: 3 } // Max retries
        ];
        
        const requeueListener = vi.fn();
        const permanentFailureListener = vi.fn();
        
        recoveryManager.on('requeueJob', requeueListener);
        recoveryManager.on('jobPermanentlyFailed', permanentFailureListener);
        
        await recoveryManager.recoverPendingJobs(pendingJobs);
        
        // Debería reencolar los primeros 2 trabajos
        expect(requeueListener).toHaveBeenCalledTimes(2);
        
        // El tercero debería marcarse como permanentemente fallido
        expect(permanentFailureListener).toHaveBeenCalledTimes(1);
    });

    test('should provide recovery statistics', () => {
        const workerId = 'worker-1';
        const jobId = 'test-job-1';
        const jobData = { userId: 'user-1', fileName: 'test.pdf' };
        
        recoveryManager.registerActiveJob(jobId, workerId, jobData);
        recoveryManager.recordWorkerHeartbeat(workerId);
        recoveryManager.failedWorkers.add('failed-worker');
        
        const stats = recoveryManager.getRecoveryStats();
        
        expect(stats.activeJobs).toBe(1);
        expect(stats.failedWorkers).toBe(1);
        expect(stats.monitoredWorkers).toBe(1);
        expect(stats.isRecovering).toBe(false);
        expect(stats.circuitBreakerState).toBeDefined();
    });
});

describe('RecoveryCoordinator', () => {
    let recoveryCoordinator;

    beforeEach(() => {
        // Reset mocks
        vi.clearAllMocks();
        
        recoveryCoordinator = new RecoveryCoordinator({
            clusterManager: mockClusterManager,
            priorityQueueManager: mockPriorityQueueManager,
            websocketManager: mockWebsocketManager,
            databaseService: mockDatabaseService
        });
    });

    afterEach(async () => {
        if (recoveryCoordinator) {
            await recoveryCoordinator.shutdown();
        }
    });

    test('should initialize with dependencies', () => {
        expect(recoveryCoordinator.clusterManager).toBe(mockClusterManager);
        expect(recoveryCoordinator.priorityQueueManager).toBe(mockPriorityQueueManager);
        expect(recoveryCoordinator.websocketManager).toBe(mockWebsocketManager);
        expect(recoveryCoordinator.databaseService).toBe(mockDatabaseService);
        expect(recoveryCoordinator.failureRecoveryManager).toBeDefined();
    });

    test('should register job and update database', async () => {
        const jobId = 'test-job-1';
        const workerId = 'worker-1';
        const jobData = { userId: 'user-1', fileName: 'test.pdf' };
        
        mockDatabaseService.query.mockResolvedValue([{ affectedRows: 1 }]);
        
        await recoveryCoordinator.registerJob(jobId, workerId, jobData);
        
        expect(mockDatabaseService.query).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE documents'),
            [workerId, jobId]
        );
    });

    test('should update job progress and notify via WebSocket', async () => {
        const jobId = 'test-job-1';
        const workerId = 'worker-1';
        const jobData = { userId: 'user-1', fileName: 'test.pdf' };
        
        // Registrar job primero
        recoveryCoordinator.failureRecoveryManager.registerActiveJob(jobId, workerId, jobData);
        
        await recoveryCoordinator.updateJobProgress(jobId, 75);
        
        expect(mockWebsocketManager.notifyUser).toHaveBeenCalledWith(
            'user-1',
            'job-progress',
            expect.objectContaining({
                jobId,
                progress: 75,
                fileName: 'test.pdf'
            })
        );
    });

    test('should mark job as completed and update database', async () => {
        const jobId = 'test-job-1';
        const result = { success: true, data: 'processed' };
        
        mockDatabaseService.query.mockResolvedValue([{ affectedRows: 1 }]);
        
        await recoveryCoordinator.markJobCompleted(jobId, result);
        
        expect(mockDatabaseService.query).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE documents'),
            [JSON.stringify(result), jobId]
        );
    });

    test('should handle worker failed event', async () => {
        const eventData = {
            workerId: 'worker-1',
            reason: 'Test failure',
            affectedJobs: 2
        };
        
        await recoveryCoordinator.handleWorkerFailedEvent(eventData);
        
        expect(mockWebsocketManager.broadcast).toHaveBeenCalledWith(
            'system-alert',
            expect.objectContaining({
                type: 'worker_failed',
                workerId: 'worker-1',
                affectedJobs: 2
            })
        );
    });

    test('should handle requeue job event', async () => {
        const eventData = {
            jobId: 'test-job-1',
            jobData: {
                userId: 'user-1',
                fileName: 'test.pdf',
                userPlan: 'premium',
                fileSize: 1024000
            },
            retryCount: 1
        };
        
        mockPriorityQueueManager.addJob.mockResolvedValue({ id: 'queue-job-1' });
        mockDatabaseService.query.mockResolvedValue([{ affectedRows: 1 }]);
        
        await recoveryCoordinator.handleRequeueJobEvent(eventData);
        
        expect(mockPriorityQueueManager.addJob).toHaveBeenCalledWith(
            eventData.jobData,
            'premium',
            1024000
        );
        
        expect(mockDatabaseService.query).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE documents'),
            [1, 'test-job-1']
        );
    });

    test('should handle permanently failed job event', async () => {
        const eventData = {
            jobId: 'test-job-1',
            userId: 'user-1',
            fileName: 'test.pdf',
            finalReason: 'Max retries exceeded',
            retryCount: 3
        };
        
        mockDatabaseService.query.mockResolvedValue([{ affectedRows: 1 }]);
        
        await recoveryCoordinator.handleJobPermanentlyFailedEvent(eventData);
        
        expect(mockDatabaseService.query).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE documents'),
            ['Max retries exceeded', 3, 'test-job-1']
        );
        
        expect(mockWebsocketManager.notifyUser).toHaveBeenCalledWith(
            'user-1',
            'job-failed',
            expect.objectContaining({
                jobId: 'test-job-1',
                fileName: 'test.pdf',
                reason: 'Max retries exceeded'
            })
        );
    });

    test('should handle worker replacement request', async () => {
        const eventData = { failedWorkerId: 'worker-1' };
        
        mockClusterManager.replaceWorker.mockResolvedValue({ newWorkerId: 'worker-2' });
        
        await recoveryCoordinator.handleWorkerReplacementRequest(eventData);
        
        expect(mockClusterManager.replaceWorker).toHaveBeenCalledWith('worker-1');
    });

    test('should provide recovery statistics', () => {
        const stats = recoveryCoordinator.getRecoveryStats();
        
        expect(stats).toHaveProperty('activeJobs');
        expect(stats).toHaveProperty('failedWorkers');
        expect(stats).toHaveProperty('monitoredWorkers');
        expect(stats).toHaveProperty('isInitialized');
        expect(stats).toHaveProperty('timestamp');
    });
});

describe('Integration Tests', () => {
    let recoveryCoordinator;
    let circuitBreaker;

    beforeEach(() => {
        vi.clearAllMocks();
        
        recoveryCoordinator = new RecoveryCoordinator({
            clusterManager: mockClusterManager,
            priorityQueueManager: mockPriorityQueueManager,
            websocketManager: mockWebsocketManager,
            databaseService: mockDatabaseService
        });
        
        circuitBreaker = new CircuitBreaker({
            failureThreshold: 2,
            timeout: 500
        });
    });

    afterEach(async () => {
        if (recoveryCoordinator) {
            await recoveryCoordinator.shutdown();
        }
        if (circuitBreaker) {
            circuitBreaker.reset();
        }
    });

    test('should handle complete failure and recovery cycle', async () => {
        const jobId = 'integration-job-1';
        const workerId = 'integration-worker-1';
        const jobData = {
            userId: 'user-1',
            fileName: 'integration-test.pdf',
            userPlan: 'premium',
            fileSize: 2048000
        };
        
        // Setup mocks
        mockDatabaseService.query.mockResolvedValue([{ affectedRows: 1 }]);
        mockPriorityQueueManager.addJob.mockResolvedValue({ id: 'requeued-job' });
        mockClusterManager.replaceWorker.mockResolvedValue({ newWorkerId: 'new-worker' });
        
        // 1. Registrar trabajo
        await recoveryCoordinator.registerJob(jobId, workerId, jobData);
        
        // 2. Simular progreso
        await recoveryCoordinator.updateJobProgress(jobId, 25);
        
        // 3. Simular fallo del worker
        await recoveryCoordinator.failureRecoveryManager.handleWorkerFailure(workerId, 'Integration test failure');
        
        // 4. Esperar reintento
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Verificar que se llamaron los métodos esperados
        expect(mockWebsocketManager.notifyUser).toHaveBeenCalledWith(
            'user-1',
            'job-progress',
            expect.objectContaining({ progress: 25 })
        );
        
        expect(mockWebsocketManager.broadcast).toHaveBeenCalledWith(
            'system-alert',
            expect.objectContaining({ type: 'worker_failed' })
        );
        
        expect(mockClusterManager.replaceWorker).toHaveBeenCalledWith(workerId);
    });

    test('should integrate circuit breaker with recovery system', async () => {
        const mockOperation = vi.fn()
            .mockRejectedValueOnce(new Error('Failure 1'))
            .mockRejectedValueOnce(new Error('Failure 2'))
            .mockResolvedValue('Success after recovery');
        
        // Primeros dos fallos deberían abrir el circuito
        try {
            await circuitBreaker.execute(mockOperation);
        } catch (error) {
            // Expected failure
        }
        
        try {
            await circuitBreaker.execute(mockOperation);
        } catch (error) {
            // Expected failure - should open circuit
        }
        
        expect(circuitBreaker.getState().state).toBe('OPEN');
        
        // Esperar timeout para transición a HALF_OPEN
        await new Promise(resolve => setTimeout(resolve, 600));
        
        // Operación exitosa debería cerrar el circuito
        const result = await circuitBreaker.execute(mockOperation);
        
        expect(result).toBe('Success after recovery');
        expect(circuitBreaker.getState().state).toBe('CLOSED');
    });
});

// Test de carga para verificar rendimiento
describe('Load Tests', () => {
    test('should handle multiple concurrent job registrations', async () => {
        const recoveryManager = new FailureRecoveryManager({
            maxRetries: 3,
            baseDelay: 10,
            workerHealthCheckInterval: 1000
        });
        
        const jobs = [];
        const numJobs = 100;
        
        // Registrar múltiples trabajos concurrentemente
        for (let i = 0; i < numJobs; i++) {
            jobs.push({
                jobId: `load-test-job-${i}`,
                workerId: `worker-${i % 10}`, // 10 workers
                jobData: { userId: `user-${i}`, fileName: `test-${i}.pdf` }
            });
        }
        
        const startTime = Date.now();
        
        jobs.forEach(job => {
            recoveryManager.registerActiveJob(job.jobId, job.workerId, job.jobData);
        });
        
        const endTime = Date.now();
        
        expect(recoveryManager.activeJobs.size).toBe(numJobs);
        expect(endTime - startTime).toBeLessThan(1000); // Debería ser rápido
        
        recoveryManager.shutdown();
    });

    test('should handle circuit breaker under high load', async () => {
        const circuitBreaker = new CircuitBreaker({
            failureThreshold: 10,
            timeout: 100
        });
        
        const operations = [];
        const numOperations = 50;
        
        // Crear operaciones que fallan aleatoriamente
        for (let i = 0; i < numOperations; i++) {
            operations.push(async () => {
                if (Math.random() < 0.3) { // 30% de fallos
                    throw new Error(`Random failure ${i}`);
                }
                return `Success ${i}`;
            });
        }
        
        const results = await Promise.allSettled(
            operations.map(op => circuitBreaker.execute(op))
        );
        
        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;
        
        expect(successful + failed).toBe(numOperations);
        expect(successful).toBeGreaterThan(0); // Al menos algunas deberían ser exitosas
        
        const metrics = circuitBreaker.getMetrics();
        expect(metrics.totalCalls).toBe(numOperations);
        
        circuitBreaker.reset();
    });
});