/**
 * Recovery Coordinator - Coordina la recuperación del sistema completo
 * 
 * Integra FailureRecoveryManager con el resto del sistema:
 * - Cluster Manager
 * - Priority Queue Manager
 * - WebSocket Manager
 * - Database Service
 */

import FailureRecoveryManager from './failureRecoveryManager.js';
import logService from './logService.js';

const logInfo = (message, data) => logService.info(message, data);
const logError = (message, data) => logService.error(message, data);
const logWarning = (message, data) => logService.warn(message, data);

class RecoveryCoordinator {
    constructor(dependencies = {}) {
        this.clusterManager = dependencies.clusterManager;
        this.priorityQueueManager = dependencies.priorityQueueManager;
        this.websocketManager = dependencies.websocketManager;
        this.databaseService = dependencies.databaseService;

        // Inicializar el sistema de recuperación
        this.failureRecoveryManager = new FailureRecoveryManager({
            maxRetries: 3,
            baseDelay: 1000,
            maxDelay: 30000,
            workerHealthCheckInterval: 5000,
            jobTimeoutMs: 300000
        });

        this.isInitialized = false;
        this.setupEventHandlers();
        
        logInfo('RecoveryCoordinator initialized');
    }

    /**
     * Configura los manejadores de eventos
     */
    setupEventHandlers() {
        // Eventos del FailureRecoveryManager
        this.failureRecoveryManager.on('workerFailed', this.handleWorkerFailedEvent.bind(this));
        this.failureRecoveryManager.on('workerRecovered', this.handleWorkerRecoveredEvent.bind(this));
        this.failureRecoveryManager.on('requeueJob', this.handleRequeueJobEvent.bind(this));
        this.failureRecoveryManager.on('jobPermanentlyFailed', this.handleJobPermanentlyFailedEvent.bind(this));
        this.failureRecoveryManager.on('notifyUser', this.handleNotifyUserEvent.bind(this));
        this.failureRecoveryManager.on('requestWorkerReplacement', this.handleWorkerReplacementRequest.bind(this));

        // Eventos del Cluster Manager (si está disponible)
        if (this.clusterManager) {
            this.clusterManager.on('workerStarted', this.handleWorkerStartedEvent.bind(this));
            this.clusterManager.on('workerStopped', this.handleWorkerStoppedEvent.bind(this));
            this.clusterManager.on('workerError', this.handleWorkerErrorEvent.bind(this));
        }

        logInfo('Recovery event handlers configured');
    }

    /**
     * Inicializa el sistema de recuperación
     */
    async initialize() {
        if (this.isInitialized) {
            logWarning('RecoveryCoordinator already initialized');
            return;
        }

        try {
            // Recuperar trabajos pendientes de la base de datos
            await this.recoverPendingJobsFromDatabase();
            
            // Inicializar monitoreo de workers existentes
            await this.initializeWorkerMonitoring();
            
            this.isInitialized = true;
            logInfo('RecoveryCoordinator initialization completed');
            
        } catch (error) {
            logError('Failed to initialize RecoveryCoordinator', { error: error.message });
            throw error;
        }
    }

    /**
     * Recupera trabajos pendientes de la base de datos al iniciar
     */
    async recoverPendingJobsFromDatabase() {
        if (!this.databaseService) {
            logWarning('Database service not available, skipping job recovery');
            return;
        }

        try {
            logInfo('Starting recovery of pending jobs from database');

            // Buscar trabajos en estado 'processing' o 'queued' que no se completaron
            const pendingJobs = await this.databaseService.query(`
                SELECT 
                    id,
                    user_id as userId,
                    file_name as fileName,
                    file_path as filePath,
                    status,
                    priority,
                    retry_count as retryCount,
                    created_at as createdAt,
                    started_at as startedAt,
                    worker_id as workerId
                FROM documents 
                WHERE status IN ('processing', 'queued', 'pending')
                AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
                ORDER BY priority ASC, created_at ASC
            `);

            if (pendingJobs.length === 0) {
                logInfo('No pending jobs found for recovery');
                return;
            }

            logInfo(`Found ${pendingJobs.length} pending jobs for recovery`);

            // Marcar trabajos como 'failed' temporalmente para evitar duplicados
            const jobIds = pendingJobs.map(job => job.id);
            await this.databaseService.query(`
                UPDATE documents 
                SET status = 'recovery_pending', 
                    updated_at = NOW() 
                WHERE id IN (${jobIds.map(() => '?').join(',')})
            `, jobIds);

            // Procesar recuperación
            await this.failureRecoveryManager.recoverPendingJobs(pendingJobs);

        } catch (error) {
            logError('Error recovering pending jobs from database', { error: error.message });
            throw error;
        }
    }

    /**
     * Inicializa el monitoreo de workers existentes
     */
    async initializeWorkerMonitoring() {
        if (!this.clusterManager) {
            logWarning('Cluster manager not available, skipping worker monitoring initialization');
            return;
        }

        try {
            const activeWorkers = await this.clusterManager.getActiveWorkers();
            
            for (const worker of activeWorkers) {
                // Registrar heartbeat inicial para cada worker
                this.failureRecoveryManager.recordWorkerHeartbeat(worker.id);
                
                // Registrar trabajos activos si los hay
                if (worker.currentJob) {
                    this.failureRecoveryManager.registerActiveJob(
                        worker.currentJob.id,
                        worker.id,
                        worker.currentJob
                    );
                }
            }

            logInfo(`Initialized monitoring for ${activeWorkers.length} active workers`);

        } catch (error) {
            logError('Error initializing worker monitoring', { error: error.message });
        }
    }

    /**
     * Registra un nuevo trabajo para monitoreo
     */
    async registerJob(jobId, workerId, jobData) {
        this.failureRecoveryManager.registerActiveJob(jobId, workerId, jobData);
        
        // Actualizar estado en base de datos
        if (this.databaseService) {
            try {
                await this.databaseService.query(`
                    UPDATE documents 
                    SET status = 'processing', 
                        worker_id = ?, 
                        started_at = NOW(),
                        updated_at = NOW()
                    WHERE id = ?
                `, [workerId, jobId]);
            } catch (error) {
                logError('Error updating job status in database', { jobId, error: error.message });
            }
        }
    }

    /**
     * Actualiza el progreso de un trabajo
     */
    async updateJobProgress(jobId, progress) {
        this.failureRecoveryManager.updateJobProgress(jobId, progress);
        
        // Notificar progreso via WebSocket
        if (this.websocketManager) {
            const jobInfo = this.failureRecoveryManager.activeJobs.get(jobId);
            if (jobInfo && jobInfo.originalJob) {
                this.websocketManager.notifyUser(jobInfo.originalJob.userId, 'job-progress', {
                    jobId,
                    progress,
                    fileName: jobInfo.originalJob.fileName
                });
            }
        }
    }

    /**
     * Marca un trabajo como completado
     */
    async markJobCompleted(jobId, result) {
        this.failureRecoveryManager.markJobCompleted(jobId);
        
        // Actualizar estado en base de datos
        if (this.databaseService) {
            try {
                await this.databaseService.query(`
                    UPDATE documents 
                    SET status = 'completed', 
                        completed_at = NOW(),
                        updated_at = NOW(),
                        result_data = ?
                    WHERE id = ?
                `, [JSON.stringify(result), jobId]);
            } catch (error) {
                logError('Error updating completed job in database', { jobId, error: error.message });
            }
        }
    }

    /**
     * Registra heartbeat de un worker
     */
    recordWorkerHeartbeat(workerId, metrics = {}) {
        this.failureRecoveryManager.recordWorkerHeartbeat(workerId);
        
        // Opcional: almacenar métricas del worker
        if (this.databaseService && Object.keys(metrics).length > 0) {
            this.storeWorkerMetrics(workerId, metrics).catch(error => {
                logError('Error storing worker metrics', { workerId, error: error.message });
            });
        }
    }

    /**
     * Almacena métricas del worker en la base de datos
     */
    async storeWorkerMetrics(workerId, metrics) {
        try {
            await this.databaseService.query(`
                INSERT INTO worker_metrics 
                (worker_id, timestamp, jobs_in_progress, memory_usage_mb, cpu_usage_percent, status)
                VALUES (?, NOW(), ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                timestamp = NOW(),
                jobs_in_progress = VALUES(jobs_in_progress),
                memory_usage_mb = VALUES(memory_usage_mb),
                cpu_usage_percent = VALUES(cpu_usage_percent),
                status = VALUES(status)
            `, [
                workerId,
                metrics.jobsInProgress || 0,
                metrics.memoryUsageMb || 0,
                metrics.cpuUsagePercent || 0,
                metrics.status || 'active'
            ]);
        } catch (error) {
            // Error no crítico, solo log
            logError('Failed to store worker metrics', { workerId, error: error.message });
        }
    }

    // Event Handlers

    /**
     * Maneja evento de worker fallido
     */
    async handleWorkerFailedEvent(data) {
        logError('Worker failed event received', data);
        
        // Notificar via WebSocket sobre el estado del sistema
        if (this.websocketManager) {
            this.websocketManager.broadcast('system-alert', {
                type: 'worker_failed',
                workerId: data.workerId,
                affectedJobs: data.affectedJobs,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Maneja evento de worker recuperado
     */
    async handleWorkerRecoveredEvent(data) {
        logInfo('Worker recovered event received', data);
        
        if (this.websocketManager) {
            this.websocketManager.broadcast('system-recovery', {
                type: 'worker_recovered',
                workerId: data.workerId,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Maneja evento de reencolar trabajo
     */
    async handleRequeueJobEvent(data) {
        logInfo('Requeue job event received', data);
        
        try {
            if (this.priorityQueueManager) {
                // Determinar la cola apropiada basada en el plan del usuario
                const userPlan = data.jobData.userPlan || 'normal';
                const fileSize = data.jobData.fileSize || 0;
                
                await this.priorityQueueManager.addJob(data.jobData, userPlan, fileSize);
                
                // Actualizar estado en base de datos
                if (this.databaseService) {
                    await this.databaseService.query(`
                        UPDATE documents 
                        SET status = 'queued', 
                            retry_count = ?,
                            updated_at = NOW()
                        WHERE id = ?
                    `, [data.retryCount, data.jobId]);
                }
                
                logInfo('Job successfully requeued', { jobId: data.jobId, retryCount: data.retryCount });
            }
        } catch (error) {
            logError('Error requeueing job', { jobId: data.jobId, error: error.message });
        }
    }

    /**
     * Maneja evento de trabajo permanentemente fallido
     */
    async handleJobPermanentlyFailedEvent(data) {
        logError('Job permanently failed event received', data);
        
        try {
            // Actualizar estado en base de datos
            if (this.databaseService) {
                await this.databaseService.query(`
                    UPDATE documents 
                    SET status = 'failed', 
                        error_message = ?,
                        retry_count = ?,
                        failed_at = NOW(),
                        updated_at = NOW()
                    WHERE id = ?
                `, [data.finalReason, data.retryCount, data.jobId]);
            }
            
            // Notificar via WebSocket
            if (this.websocketManager) {
                this.websocketManager.notifyUser(data.userId, 'job-failed', {
                    jobId: data.jobId,
                    fileName: data.fileName,
                    reason: data.finalReason,
                    retryCount: data.retryCount
                });
            }
            
        } catch (error) {
            logError('Error handling permanently failed job', { jobId: data.jobId, error: error.message });
        }
    }

    /**
     * Maneja evento de notificar usuario
     */
    async handleNotifyUserEvent(data) {
        if (this.websocketManager) {
            this.websocketManager.notifyUser(data.userId, data.type, data.data);
        }
    }

    /**
     * Maneja solicitud de reemplazo de worker
     */
    async handleWorkerReplacementRequest(data) {
        logInfo('Worker replacement requested', data);
        
        if (this.clusterManager) {
            try {
                await this.clusterManager.replaceWorker(data.failedWorkerId);
                logInfo('Worker replacement initiated', { failedWorkerId: data.failedWorkerId });
            } catch (error) {
                logError('Error replacing worker', { failedWorkerId: data.failedWorkerId, error: error.message });
            }
        }
    }

    /**
     * Maneja evento de worker iniciado
     */
    async handleWorkerStartedEvent(data) {
        logInfo('Worker started event received', data);
        this.failureRecoveryManager.recordWorkerHeartbeat(data.workerId);
    }

    /**
     * Maneja evento de worker detenido
     */
    async handleWorkerStoppedEvent(data) {
        logInfo('Worker stopped event received', data);
        // El worker se detuvo normalmente, no es un fallo
    }

    /**
     * Maneja evento de error de worker
     */
    async handleWorkerErrorEvent(data) {
        logError('Worker error event received', data);
        await this.failureRecoveryManager.handleWorkerFailure(data.workerId, data.error);
    }

    /**
     * Obtiene estadísticas del sistema de recuperación
     */
    getRecoveryStats() {
        return {
            ...this.failureRecoveryManager.getRecoveryStats(),
            isInitialized: this.isInitialized,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Cierra el sistema de recuperación
     */
    async shutdown() {
        logInfo('Shutting down RecoveryCoordinator');
        
        if (this.failureRecoveryManager) {
            this.failureRecoveryManager.shutdown();
        }
        
        this.isInitialized = false;
    }
}

export default RecoveryCoordinator;