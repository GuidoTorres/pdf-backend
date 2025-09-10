/**
 * Failure Recovery Integration
 * 
 * Integra el sistema de recuperación de fallos con los componentes existentes
 * del sistema de procesamiento escalable de PDFs.
 */

import RecoveryCoordinator from './recoveryCoordinator.js';
import logService from './logService.js';

const logInfo = (message, data) => logService.info(message, data);
const logError = (message, data) => logService.error(message, data);
const logWarning = (message, data) => logService.warn(message, data);

class FailureRecoveryIntegration {
    constructor() {
        this.recoveryCoordinator = null;
        this.isInitialized = false;
        this.dependencies = {};
    }

    /**
     * Inicializa la integración con los servicios existentes
     */
    async initialize(services = {}) {
        try {
            logInfo('Initializing Failure Recovery Integration');

            // Validar dependencias requeridas
            this.validateDependencies(services);
            
            // Almacenar referencias a servicios
            this.dependencies = {
                clusterManager: services.clusterManager,
                priorityQueueManager: services.priorityQueueManager,
                websocketManager: services.websocketManager,
                databaseService: services.databaseService,
                loadBalancer: services.loadBalancer,
                resourcePool: services.resourcePool
            };

            // Crear coordinador de recuperación
            this.recoveryCoordinator = new RecoveryCoordinator(this.dependencies);

            // Configurar integraciones
            await this.setupClusterManagerIntegration();
            await this.setupQueueManagerIntegration();
            await this.setupWebSocketIntegration();
            await this.setupLoadBalancerIntegration();

            // Inicializar el coordinador
            await this.recoveryCoordinator.initialize();

            this.isInitialized = true;
            logInfo('Failure Recovery Integration initialized successfully');

        } catch (error) {
            logError('Failed to initialize Failure Recovery Integration', { error: error.message });
            throw error;
        }
    }

    /**
     * Valida que todas las dependencias requeridas estén disponibles
     */
    validateDependencies(services) {
        const required = ['clusterManager', 'priorityQueueManager', 'websocketManager', 'databaseService'];
        const missing = required.filter(service => !services[service]);

        if (missing.length > 0) {
            throw new Error(`Missing required services: ${missing.join(', ')}`);
        }
    }

    /**
     * Configura la integración con el Cluster Manager
     */
    async setupClusterManagerIntegration() {
        const clusterManager = this.dependencies.clusterManager;

        // Interceptar eventos del cluster manager
        clusterManager.on('workerStarted', (data) => {
            logInfo('Worker started, registering with recovery system', data);
            this.recoveryCoordinator.recordWorkerHeartbeat(data.workerId);
        });

        clusterManager.on('workerStopped', (data) => {
            logInfo('Worker stopped normally', data);
            // No es un fallo, solo log
        });

        clusterManager.on('workerError', (data) => {
            logError('Worker error detected by cluster manager', data);
            this.recoveryCoordinator.failureRecoveryManager.handleWorkerFailure(
                data.workerId, 
                data.error || 'Unknown cluster manager error'
            );
        });

        clusterManager.on('jobAssigned', (data) => {
            logInfo('Job assigned to worker', data);
            this.recoveryCoordinator.registerJob(data.jobId, data.workerId, data.jobData);
        });

        clusterManager.on('jobProgress', (data) => {
            this.recoveryCoordinator.updateJobProgress(data.jobId, data.progress);
        });

        clusterManager.on('jobCompleted', (data) => {
            this.recoveryCoordinator.markJobCompleted(data.jobId, data.result);
        });

        // Extender cluster manager con funcionalidad de recovery
        this.extendClusterManagerWithRecovery(clusterManager);

        logInfo('Cluster Manager integration configured');
    }

    /**
     * Extiende el Cluster Manager con funcionalidad de recovery
     */
    extendClusterManagerWithRecovery(clusterManager) {
        // Método para reportar heartbeat de worker
        const originalReportWorkerStatus = clusterManager.reportWorkerStatus || function() {};
        clusterManager.reportWorkerStatus = (workerId, status, metrics = {}) => {
            // Llamar método original si existe
            originalReportWorkerStatus.call(clusterManager, workerId, status, metrics);
            
            // Registrar heartbeat en sistema de recovery
            this.recoveryCoordinator.recordWorkerHeartbeat(workerId, metrics);
        };

        // Método para manejar fallos de worker
        const originalHandleWorkerFailure = clusterManager.handleWorkerFailure || function() {};
        clusterManager.handleWorkerFailure = async (workerId, reason) => {
            logWarning('Cluster manager handling worker failure', { workerId, reason });
            
            // Llamar método original si existe
            if (originalHandleWorkerFailure) {
                await originalHandleWorkerFailure.call(clusterManager, workerId, reason);
            }
            
            // Notificar al sistema de recovery
            await this.recoveryCoordinator.failureRecoveryManager.handleWorkerFailure(workerId, reason);
        };

        // Método para reemplazar worker fallido
        clusterManager.replaceWorker = async (failedWorkerId) => {
            logInfo('Replacing failed worker', { failedWorkerId });
            
            try {
                // Crear nuevo worker
                const newWorker = await clusterManager.createWorker();
                
                // Detener worker fallido si aún está corriendo
                try {
                    await clusterManager.stopWorker(failedWorkerId);
                } catch (error) {
                    logWarning('Could not stop failed worker', { failedWorkerId, error: error.message });
                }
                
                logInfo('Worker replaced successfully', { 
                    failedWorkerId, 
                    newWorkerId: newWorker.id 
                });
                
                return newWorker;
                
            } catch (error) {
                logError('Failed to replace worker', { failedWorkerId, error: error.message });
                throw error;
            }
        };
    }

    /**
     * Configura la integración con el Priority Queue Manager
     */
    async setupQueueManagerIntegration() {
        const queueManager = this.dependencies.priorityQueueManager;

        // Interceptar eventos de cola
        if (queueManager.on) {
            queueManager.on('jobQueued', (data) => {
                logInfo('Job queued, monitoring for processing', data);
            });

            queueManager.on('jobStarted', (data) => {
                logInfo('Job started processing', data);
                this.recoveryCoordinator.registerJob(data.jobId, data.workerId, data.jobData);
            });

            queueManager.on('jobFailed', (data) => {
                logError('Job failed in queue', data);
                // El recovery manager ya debería haber manejado esto
            });
        }

        // Extender queue manager con recovery
        this.extendQueueManagerWithRecovery(queueManager);

        logInfo('Priority Queue Manager integration configured');
    }

    /**
     * Extiende el Queue Manager con funcionalidad de recovery
     */
    extendQueueManagerWithRecovery(queueManager) {
        // Método para reencolar trabajos fallidos
        queueManager.requeueFailedJob = async (jobId, jobData, retryCount) => {
            try {
                logInfo('Requeueing failed job', { jobId, retryCount });
                
                // Determinar prioridad basada en retry count
                const priority = this.calculateRetryPriority(jobData.userPlan, retryCount);
                
                // Añadir metadata de retry
                const enhancedJobData = {
                    ...jobData,
                    retryCount,
                    isRetry: true,
                    originalFailureTime: Date.now()
                };
                
                // Reencolar con prioridad ajustada
                const result = await queueManager.addJob(
                    enhancedJobData, 
                    jobData.userPlan || 'normal',
                    jobData.fileSize || 0,
                    { priority }
                );
                
                logInfo('Job requeued successfully', { jobId, queueJobId: result.id });
                return result;
                
            } catch (error) {
                logError('Failed to requeue job', { jobId, error: error.message });
                throw error;
            }
        };

        // Método para obtener estadísticas de cola para recovery
        queueManager.getRecoveryStats = async () => {
            try {
                const stats = await queueManager.getQueueStats();
                return {
                    ...stats,
                    recoveryMetrics: {
                        retriedJobs: stats.completed?.filter(job => job.data?.isRetry)?.length || 0,
                        avgRetryTime: this.calculateAverageRetryTime(stats),
                        failureRate: this.calculateFailureRate(stats)
                    }
                };
            } catch (error) {
                logError('Failed to get recovery stats from queue', { error: error.message });
                return null;
            }
        };
    }

    /**
     * Configura la integración con WebSocket Manager
     */
    async setupWebSocketIntegration() {
        const websocketManager = this.dependencies.websocketManager;

        // Extender con eventos de recovery
        this.extendWebSocketManagerWithRecovery(websocketManager);

        logInfo('WebSocket Manager integration configured');
    }

    /**
     * Extiende WebSocket Manager con eventos de recovery
     */
    extendWebSocketManagerWithRecovery(websocketManager) {
        // Método para notificar eventos de recovery
        websocketManager.notifyRecoveryEvent = (eventType, data) => {
            const message = {
                type: 'recovery-event',
                eventType,
                data,
                timestamp: new Date().toISOString()
            };

            switch (eventType) {
                case 'job-retry':
                    if (data.userId) {
                        websocketManager.notifyUser(data.userId, 'job-retry', {
                            jobId: data.jobId,
                            retryCount: data.retryCount,
                            estimatedTime: data.estimatedTime
                        });
                    }
                    break;

                case 'worker-failure':
                    websocketManager.broadcast('system-status', {
                        type: 'worker-failure',
                        workerId: data.workerId,
                        affectedJobs: data.affectedJobs,
                        recoveryInProgress: true
                    });
                    break;

                case 'system-recovery':
                    websocketManager.broadcast('system-status', {
                        type: 'system-recovery',
                        message: 'System recovered from failure',
                        recoveredJobs: data.recoveredJobs
                    });
                    break;

                default:
                    websocketManager.broadcast('recovery-event', message);
            }
        };

        // Método para dashboard de recovery
        websocketManager.broadcastRecoveryStats = (stats) => {
            websocketManager.broadcast('recovery-stats', {
                ...stats,
                timestamp: new Date().toISOString()
            });
        };
    }

    /**
     * Configura la integración con Load Balancer
     */
    async setupLoadBalancerIntegration() {
        const loadBalancer = this.dependencies.loadBalancer;

        if (loadBalancer) {
            // Extender load balancer con awareness de recovery
            this.extendLoadBalancerWithRecovery(loadBalancer);
            logInfo('Load Balancer integration configured');
        }
    }

    /**
     * Extiende Load Balancer con awareness de recovery
     */
    extendLoadBalancerWithRecovery(loadBalancer) {
        // Método para excluir workers fallidos del balanceo
        const originalSelectWorker = loadBalancer.selectWorker || loadBalancer.getNextWorker;
        
        if (originalSelectWorker) {
            loadBalancer.selectWorker = (job) => {
                const failedWorkers = this.recoveryCoordinator.failureRecoveryManager.failedWorkers;
                
                // Filtrar workers fallidos
                const availableWorkers = loadBalancer.workers?.filter(
                    worker => !failedWorkers.has(worker.id)
                ) || [];

                if (availableWorkers.length === 0) {
                    logWarning('No healthy workers available for load balancing');
                    return null;
                }

                // Usar lógica original con workers filtrados
                const originalWorkers = loadBalancer.workers;
                loadBalancer.workers = availableWorkers;
                
                const selectedWorker = originalSelectWorker.call(loadBalancer, job);
                
                loadBalancer.workers = originalWorkers; // Restaurar
                
                return selectedWorker;
            };
        }

        // Método para reportar métricas de workers al recovery system
        loadBalancer.reportWorkerMetrics = (workerId, metrics) => {
            this.recoveryCoordinator.recordWorkerHeartbeat(workerId, metrics);
        };
    }

    /**
     * Calcula prioridad para reintentos
     */
    calculateRetryPriority(userPlan, retryCount) {
        const basePriority = {
            'unlimited': 1,
            'premium': 2,
            'normal': 3
        }[userPlan] || 3;

        // Aumentar prioridad ligeramente para reintentos (pero no demasiado)
        return Math.max(1, basePriority - Math.floor(retryCount / 2));
    }

    /**
     * Calcula tiempo promedio de reintentos
     */
    calculateAverageRetryTime(stats) {
        // Implementación simplificada
        return stats.avgProcessingTime || 0;
    }

    /**
     * Calcula tasa de fallos
     */
    calculateFailureRate(stats) {
        const total = (stats.completed?.length || 0) + (stats.failed?.length || 0);
        return total > 0 ? (stats.failed?.length || 0) / total : 0;
    }

    /**
     * Obtiene estadísticas completas del sistema de recovery
     */
    async getSystemRecoveryStats() {
        if (!this.isInitialized) {
            throw new Error('Failure Recovery Integration not initialized');
        }

        try {
            const recoveryStats = this.recoveryCoordinator.getRecoveryStats();
            const queueStats = this.dependencies.priorityQueueManager.getRecoveryStats ? 
                await this.dependencies.priorityQueueManager.getRecoveryStats() : null;

            return {
                recovery: recoveryStats,
                queues: queueStats,
                system: {
                    isHealthy: recoveryStats.failedWorkers === 0 && recoveryStats.activeJobs < 100,
                    lastUpdate: new Date().toISOString()
                }
            };
        } catch (error) {
            logError('Failed to get system recovery stats', { error: error.message });
            throw error;
        }
    }

    /**
     * Ejecuta verificación de salud del sistema
     */
    async performHealthCheck() {
        if (!this.isInitialized) {
            return { healthy: false, reason: 'Not initialized' };
        }

        try {
            const stats = await this.getSystemRecoveryStats();
            
            const checks = {
                workersHealthy: stats.recovery.failedWorkers === 0,
                queuesHealthy: !stats.queues || stats.queues.recoveryMetrics.failureRate < 0.1,
                systemLoad: stats.recovery.activeJobs < 50,
                circuitBreakerHealthy: stats.recovery.circuitBreakerState.state === 'CLOSED'
            };

            const healthy = Object.values(checks).every(check => check);

            return {
                healthy,
                checks,
                stats,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            logError('Health check failed', { error: error.message });
            return {
                healthy: false,
                reason: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Cierra la integración y limpia recursos
     */
    async shutdown() {
        if (this.recoveryCoordinator) {
            await this.recoveryCoordinator.shutdown();
        }
        
        this.isInitialized = false;
        logInfo('Failure Recovery Integration shut down');
    }
}

export default FailureRecoveryIntegration;