/**
 * FailureRecoveryManager - Sistema de recuperación y tolerancia a fallos
 * 
 * Responsabilidades:
 * - Detectar workers caídos y reasignar trabajos
 * - Implementar reintentos automáticos con backoff exponencial
 * - Gestionar recuperación de trabajos pendientes al reiniciar
 * - Coordinar con Circuit Breaker para prevenir cascadas de fallos
 */

import { EventEmitter } from 'events';
import CircuitBreaker from './circuitBreaker.js';
import logService from './logService.js';

const logInfo = (message, data) => logService.info(message, data);
const logError = (message, data) => logService.error(message, data);
const logWarning = (message, data) => logService.warn(message, data);

class FailureRecoveryManager extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.config = {
            maxRetries: options.maxRetries || 3,
            baseDelay: options.baseDelay || 1000, // 1 segundo base
            maxDelay: options.maxDelay || 30000, // 30 segundos máximo
            workerHealthCheckInterval: options.workerHealthCheckInterval || 5000, // 5 segundos
            jobTimeoutMs: options.jobTimeoutMs || 300000, // 5 minutos timeout por job
            ...options
        };

        this.activeJobs = new Map(); // jobId -> { workerId, startTime, retryCount, originalJob }
        this.failedWorkers = new Set();
        this.workerHealthChecks = new Map(); // workerId -> lastHeartbeat
        this.circuitBreaker = new CircuitBreaker({
            failureThreshold: 5,
            timeout: 60000,
            monitoringPeriod: 30000
        });

        this.isRecovering = false;
        this.recoveryQueue = [];

        // Iniciar monitoreo de salud de workers
        this.startWorkerHealthMonitoring();
        
        logInfo('FailureRecoveryManager initialized', { config: this.config });
    }

    /**
     * Registra un trabajo activo para monitoreo
     */
    registerActiveJob(jobId, workerId, jobData) {
        this.activeJobs.set(jobId, {
            workerId,
            startTime: Date.now(),
            retryCount: 0,
            originalJob: jobData,
            lastUpdate: Date.now()
        });

        logInfo('Job registered for monitoring', { jobId, workerId });
    }

    /**
     * Actualiza el estado de un trabajo activo
     */
    updateJobProgress(jobId, progress) {
        const job = this.activeJobs.get(jobId);
        if (job) {
            job.lastUpdate = Date.now();
            job.progress = progress;
        }
    }

    /**
     * Marca un trabajo como completado
     */
    markJobCompleted(jobId) {
        const job = this.activeJobs.get(jobId);
        if (job) {
            this.activeJobs.delete(jobId);
            logInfo('Job completed successfully', { jobId, workerId: job.workerId });
        }
    }

    /**
     * Maneja el fallo de un worker
     */
    async handleWorkerFailure(workerId, reason = 'unknown') {
        logError('Worker failure detected', { workerId, reason });
        
        // Marcar worker como fallido
        this.failedWorkers.add(workerId);
        this.workerHealthChecks.delete(workerId);

        // Encontrar todos los trabajos asignados a este worker
        const failedJobs = [];
        for (const [jobId, jobInfo] of this.activeJobs.entries()) {
            if (jobInfo.workerId === workerId) {
                failedJobs.push({ jobId, jobInfo });
            }
        }

        logWarning(`Found ${failedJobs.length} jobs to recover from failed worker`, { workerId });

        // Procesar cada trabajo fallido
        for (const { jobId, jobInfo } of failedJobs) {
            await this.handleJobFailure(jobId, jobInfo, `Worker ${workerId} failed: ${reason}`);
        }

        // Emitir evento de fallo de worker
        this.emit('workerFailed', { workerId, reason, affectedJobs: failedJobs.length });

        // Solicitar reemplazo del worker
        this.emit('requestWorkerReplacement', { failedWorkerId: workerId });
    }

    /**
     * Maneja el fallo de un trabajo específico
     */
    async handleJobFailure(jobId, jobInfo, reason) {
        logError('Job failure detected', { jobId, workerId: jobInfo.workerId, reason });

        // Remover de trabajos activos
        this.activeJobs.delete(jobId);

        // Verificar si se pueden hacer más reintentos
        if (jobInfo.retryCount < this.config.maxRetries) {
            await this.retryJob(jobId, jobInfo, reason);
        } else {
            // Máximo de reintentos alcanzado
            await this.markJobAsPermanentlyFailed(jobId, jobInfo, reason);
        }
    }

    /**
     * Reintenta un trabajo con backoff exponencial
     */
    async retryJob(jobId, jobInfo, reason) {
        const retryCount = jobInfo.retryCount + 1;
        const delay = this.calculateBackoffDelay(retryCount);

        logWarning(`Scheduling job retry ${retryCount}/${this.config.maxRetries}`, {
            jobId,
            delay,
            reason
        });

        // Programar reintento después del delay
        setTimeout(async () => {
            try {
                // Verificar circuit breaker antes del reintento
                await this.circuitBreaker.execute(async () => {
                    await this.requeueJobForRetry(jobId, jobInfo, retryCount);
                });
            } catch (error) {
                logError('Circuit breaker prevented job retry', { jobId, error: error.message });
                await this.markJobAsPermanentlyFailed(jobId, jobInfo, 'Circuit breaker open');
            }
        }, delay);
    }

    /**
     * Calcula el delay para backoff exponencial
     */
    calculateBackoffDelay(retryCount) {
        const exponentialDelay = this.config.baseDelay * Math.pow(2, retryCount - 1);
        const jitter = Math.random() * 0.1 * exponentialDelay; // 10% jitter
        return Math.min(exponentialDelay + jitter, this.config.maxDelay);
    }

    /**
     * Reencola un trabajo para reintento
     */
    async requeueJobForRetry(jobId, jobInfo, retryCount) {
        const updatedJob = {
            ...jobInfo.originalJob,
            retryCount,
            previousFailures: jobInfo.previousFailures || [],
            lastFailureReason: jobInfo.lastFailureReason
        };

        // Añadir información del fallo anterior
        updatedJob.previousFailures.push({
            workerId: jobInfo.workerId,
            failureTime: Date.now(),
            reason: jobInfo.lastFailureReason
        });

        logInfo('Requeueing job for retry', { jobId, retryCount });

        // Emitir evento para que el sistema reencole el trabajo
        this.emit('requeueJob', { jobId, jobData: updatedJob, retryCount });
    }

    /**
     * Marca un trabajo como permanentemente fallido
     */
    async markJobAsPermanentlyFailed(jobId, jobInfo, finalReason) {
        logError('Job permanently failed after max retries', {
            jobId,
            retryCount: jobInfo.retryCount,
            finalReason
        });

        const failureData = {
            jobId,
            userId: jobInfo.originalJob.userId,
            fileName: jobInfo.originalJob.fileName,
            finalReason,
            retryCount: jobInfo.retryCount,
            totalProcessingTime: Date.now() - jobInfo.startTime,
            previousFailures: jobInfo.previousFailures || []
        };

        // Emitir evento de fallo permanente
        this.emit('jobPermanentlyFailed', failureData);

        // Notificar al usuario
        this.emit('notifyUser', {
            userId: jobInfo.originalJob.userId,
            type: 'job_failed',
            data: {
                jobId,
                fileName: jobInfo.originalJob.fileName,
                reason: 'El procesamiento falló después de múltiples intentos'
            }
        });
    }

    /**
     * Inicia el monitoreo de salud de workers
     */
    startWorkerHealthMonitoring() {
        setInterval(() => {
            this.checkWorkerHealth();
            this.checkJobTimeouts();
        }, this.config.workerHealthCheckInterval);

        logInfo('Worker health monitoring started');
    }

    /**
     * Verifica la salud de todos los workers
     */
    checkWorkerHealth() {
        const now = Date.now();
        const healthCheckTimeout = this.config.workerHealthCheckInterval * 3; // 3 intervalos de gracia

        for (const [workerId, lastHeartbeat] of this.workerHealthChecks.entries()) {
            if (now - lastHeartbeat > healthCheckTimeout) {
                this.handleWorkerFailure(workerId, 'Health check timeout');
            }
        }
    }

    /**
     * Verifica trabajos que han excedido el timeout
     */
    checkJobTimeouts() {
        const now = Date.now();

        for (const [jobId, jobInfo] of this.activeJobs.entries()) {
            const jobAge = now - jobInfo.startTime;
            const timeSinceUpdate = now - jobInfo.lastUpdate;

            // Timeout si el trabajo ha estado corriendo demasiado tiempo
            // o si no ha habido actualizaciones recientes
            if (jobAge > this.config.jobTimeoutMs || timeSinceUpdate > this.config.jobTimeoutMs / 2) {
                logWarning('Job timeout detected', { jobId, jobAge, timeSinceUpdate });
                this.handleJobFailure(jobId, jobInfo, 'Job timeout');
            }
        }
    }

    /**
     * Registra heartbeat de un worker
     */
    recordWorkerHeartbeat(workerId) {
        this.workerHealthChecks.set(workerId, Date.now());
        
        // Si el worker estaba marcado como fallido, removerlo
        if (this.failedWorkers.has(workerId)) {
            this.failedWorkers.delete(workerId);
            logInfo('Worker recovered from failure', { workerId });
            this.emit('workerRecovered', { workerId });
        }
    }

    /**
     * Recupera trabajos pendientes al reiniciar el sistema
     */
    async recoverPendingJobs(pendingJobs) {
        if (this.isRecovering) {
            logWarning('Recovery already in progress, queuing jobs');
            this.recoveryQueue.push(...pendingJobs);
            return;
        }

        this.isRecovering = true;
        logInfo(`Starting recovery of ${pendingJobs.length} pending jobs`);

        try {
            for (const job of pendingJobs) {
                await this.recoverSingleJob(job);
            }

            // Procesar cola de recuperación si hay trabajos adicionales
            while (this.recoveryQueue.length > 0) {
                const additionalJobs = this.recoveryQueue.splice(0);
                for (const job of additionalJobs) {
                    await this.recoverSingleJob(job);
                }
            }

            logInfo('Job recovery completed successfully');
        } catch (error) {
            logError('Error during job recovery', { error: error.message });
            throw error;
        } finally {
            this.isRecovering = false;
        }
    }

    /**
     * Recupera un trabajo individual
     */
    async recoverSingleJob(job) {
        try {
            // Verificar si el trabajo ya está siendo procesado
            if (this.activeJobs.has(job.id)) {
                logWarning('Job already active, skipping recovery', { jobId: job.id });
                return;
            }

            // Determinar si el trabajo necesita ser reintentado
            const retryCount = job.retryCount || 0;
            
            if (retryCount >= this.config.maxRetries) {
                logWarning('Job exceeded max retries during recovery', { jobId: job.id });
                await this.markJobAsPermanentlyFailed(job.id, { originalJob: job }, 'Max retries exceeded during recovery');
                return;
            }

            // Reencolar el trabajo
            logInfo('Recovering job', { jobId: job.id, retryCount });
            this.emit('requeueJob', { 
                jobId: job.id, 
                jobData: { ...job, retryCount: retryCount + 1 },
                isRecovery: true 
            });

        } catch (error) {
            logError('Error recovering individual job', { jobId: job.id, error: error.message });
        }
    }

    /**
     * Obtiene estadísticas del sistema de recuperación
     */
    getRecoveryStats() {
        return {
            activeJobs: this.activeJobs.size,
            failedWorkers: this.failedWorkers.size,
            monitoredWorkers: this.workerHealthChecks.size,
            isRecovering: this.isRecovering,
            recoveryQueueLength: this.recoveryQueue.length,
            circuitBreakerState: this.circuitBreaker.getState()
        };
    }

    /**
     * Limpia recursos y detiene monitoreo
     */
    shutdown() {
        logInfo('Shutting down FailureRecoveryManager');
        this.removeAllListeners();
        this.activeJobs.clear();
        this.failedWorkers.clear();
        this.workerHealthChecks.clear();
    }
}

export default FailureRecoveryManager;