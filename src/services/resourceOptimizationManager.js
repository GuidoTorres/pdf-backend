import EventEmitter from 'events';
import ResourcePool from './resourcePool.js';
import MemoryMonitor from './memoryMonitor.js';
import FileSizeDetector from './fileSizeDetector.js';
import TempFileCleanup from './tempFileCleanup.js';

/**
 * ResourceOptimizationManager - Central coordinator for all resource optimization services
 * Integrates memory monitoring, resource pooling, file size detection, and cleanup
 */
class ResourceOptimizationManager extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            // Resource pool configuration
            resourcePool: {
                maxConcurrentJobs: config.maxConcurrentJobs || 10,
                maxMemoryUsageMB: config.maxMemoryUsageMB || 2048,
                largeFileThresholdMB: config.largeFileThresholdMB || 50,
                maxLargeFileConcurrent: config.maxLargeFileConcurrent || 2,
                ...config.resourcePool
            },
            
            // Memory monitor configuration
            memoryMonitor: {
                checkInterval: config.memoryCheckInterval || 3000,
                warningThreshold: config.memoryWarningThreshold || 0.75,
                criticalThreshold: config.memoryCriticalThreshold || 0.85,
                emergencyThreshold: config.memoryEmergencyThreshold || 0.95,
                ...config.memoryMonitor
            },
            
            // File size detector configuration
            fileSizeDetector: {
                largeFileThreshold: config.largeFileThresholdMB || 50,
                ...config.fileSizeDetector
            },
            
            // Temp file cleanup configuration
            tempFileCleanup: {
                aggressiveCleanupInterval: config.cleanupInterval || 30000,
                ...config.tempFileCleanup
            },
            
            // Integration settings
            autoStart: config.autoStart !== false, // Default true
            enableAutoScaling: config.enableAutoScaling !== false,
            enableMemoryPausing: config.enableMemoryPausing !== false,
            
            ...config
        };

        // Initialize components
        this.resourcePool = new ResourcePool(this.config.resourcePool);
        this.memoryMonitor = new MemoryMonitor(this.config.memoryMonitor);
        this.fileSizeDetector = new FileSizeDetector(this.config.fileSizeDetector);
        this.tempFileCleanup = new TempFileCleanup(this.config.tempFileCleanup);
        
        // State tracking
        this.isInitialized = false;
        this.isRunning = false;
        this.currentJobs = new Map();
        
        // Statistics aggregation
        this.aggregatedStats = {
            totalJobsProcessed: 0,
            totalMemoryAlerts: 0,
            totalCleanupOperations: 0,
            averageJobDuration: 0,
            systemUptime: Date.now()
        };

        this.setupEventHandlers();
    }

    /**
     * Initialize the resource optimization manager
     */
    async initialize() {
        if (this.isInitialized) {
            console.warn('ResourceOptimizationManager already initialized');
            return;
        }

        console.log('Initializing ResourceOptimizationManager...');

        try {
            // Initialize all components
            await this.resourcePool.initialize();
            
            if (this.config.autoStart) {
                await this.start();
            }

            this.isInitialized = true;
            console.log('ResourceOptimizationManager initialized successfully');
            this.emit('initialized');

        } catch (error) {
            console.error('Failed to initialize ResourceOptimizationManager:', error);
            throw error;
        }
    }

    /**
     * Start all monitoring and cleanup services
     */
    async start() {
        if (this.isRunning) {
            console.warn('ResourceOptimizationManager already running');
            return;
        }

        console.log('Starting ResourceOptimizationManager services...');

        try {
            // Start memory monitoring
            this.memoryMonitor.start();
            
            // Start temp file cleanup
            this.tempFileCleanup.start();
            
            this.isRunning = true;
            this.aggregatedStats.systemUptime = Date.now();
            
            console.log('All ResourceOptimizationManager services started');
            this.emit('started');

        } catch (error) {
            console.error('Failed to start ResourceOptimizationManager:', error);
            throw error;
        }
    }

    /**
     * Stop all services
     */
    async stop() {
        if (!this.isRunning) return;

        console.log('Stopping ResourceOptimizationManager services...');

        try {
            // Stop monitoring services
            this.memoryMonitor.stop();
            this.tempFileCleanup.stop();
            
            // Shutdown resource pool
            await this.resourcePool.shutdown();
            
            this.isRunning = false;
            console.log('ResourceOptimizationManager stopped');
            this.emit('stopped');

        } catch (error) {
            console.error('Error stopping ResourceOptimizationManager:', error);
        }
    }

    /**
     * Process a new job with full resource optimization
     * @param {Object} jobInfo - Job information
     * @returns {Object} Job processing result
     */
    async processJob(jobInfo) {
        const { filePath, userId, jobType = 'pdf-processing' } = jobInfo;
        
        try {
            // 1. Analyze file size and get processing strategy
            const fileAnalysis = await this.fileSizeDetector.analyzeFile(filePath);
            console.log(`File analysis for ${fileAnalysis.fileName}:`, {
                size: fileAnalysis.size.formatted,
                category: fileAnalysis.category,
                estimatedTime: fileAnalysis.estimatedProcessingTime.estimatedSeconds + 's'
            });

            // 2. Acquire resource slot based on file analysis
            const jobId = await this.resourcePool.acquireResource({
                fileSize: fileAnalysis.size.bytes,
                userId,
                jobType,
                category: fileAnalysis.category
            });

            // 3. Protect job files from cleanup
            this.tempFileCleanup.protectJobFiles(jobId, [filePath]);

            // 4. Track job
            const jobData = {
                jobId,
                userId,
                filePath,
                fileAnalysis,
                startTime: Date.now(),
                status: 'processing'
            };
            
            this.currentJobs.set(jobId, jobData);

            // 5. Create temp files if needed
            const tempFilePath = await this.resourcePool.createTempFile(jobId, fileAnalysis.fileName);

            // 6. Return job context for processing
            const jobContext = {
                jobId,
                originalFilePath: filePath,
                tempFilePath,
                fileAnalysis,
                processingStrategy: fileAnalysis.processingStrategy,
                recommendations: fileAnalysis.recommendations
            };

            this.emit('job-started', jobContext);
            return jobContext;

        } catch (error) {
            console.error('Failed to process job:', error);
            throw error;
        }
    }

    /**
     * Complete a job and release resources
     * @param {string} jobId - Job ID
     * @param {Object} result - Processing result
     */
    async completeJob(jobId, result = {}) {
        const jobData = this.currentJobs.get(jobId);
        if (!jobData) {
            console.warn(`Attempted to complete unknown job: ${jobId}`);
            return;
        }

        try {
            // 1. Release resource pool slot
            await this.resourcePool.releaseResource(jobId);

            // 2. Unprotect files for cleanup
            this.tempFileCleanup.unprotectJobFiles(jobId);

            // 3. Update job data
            jobData.endTime = Date.now();
            jobData.duration = jobData.endTime - jobData.startTime;
            jobData.status = result.success ? 'completed' : 'failed';
            jobData.result = result;

            // 4. Update statistics
            this.updateAggregatedStats(jobData);

            // 5. Remove from active jobs
            this.currentJobs.delete(jobId);

            console.log(`Job ${jobId} completed in ${jobData.duration}ms`);
            this.emit('job-completed', { jobId, jobData, result });

        } catch (error) {
            console.error(`Error completing job ${jobId}:`, error);
        }
    }

    /**
     * Handle job failure
     * @param {string} jobId - Job ID
     * @param {Error} error - Error that caused failure
     */
    async failJob(jobId, error) {
        const jobData = this.currentJobs.get(jobId);
        if (!jobData) {
            console.warn(`Attempted to fail unknown job: ${jobId}`);
            return;
        }

        console.error(`Job ${jobId} failed:`, error.message);

        await this.completeJob(jobId, {
            success: false,
            error: error.message,
            errorType: error.constructor.name
        });

        this.emit('job-failed', { jobId, error });
    }

    /**
     * Get comprehensive system status
     * @returns {Object} System status
     */
    getSystemStatus() {
        const memoryStatus = this.memoryMonitor.getStatus();
        const resourceStats = this.resourcePool.getStats();
        const cleanupStats = this.tempFileCleanup.getStatistics();
        const detectorStats = this.fileSizeDetector.getStatistics();

        return {
            isRunning: this.isRunning,
            timestamp: new Date(),
            
            // Memory status
            memory: {
                currentUsage: memoryStatus.latestReading?.primaryUsage || 0,
                level: memoryStatus.currentState.level,
                trend: memoryStatus.currentState.trend,
                alertsTriggered: memoryStatus.stats.alertsTriggered
            },
            
            // Resource pool status
            resources: {
                activeJobs: resourceStats.activeJobs,
                largeFileJobs: resourceStats.largeFileJobs,
                waitingQueue: resourceStats.waitingQueue,
                isPaused: resourceStats.isPaused,
                utilization: resourceStats.resourceUtilization
            },
            
            // Cleanup status
            cleanup: {
                filesRemoved: cleanupStats.filesRemoved,
                bytesFreed: cleanupStats.bytesFreed,
                lastCleanup: cleanupStats.lastCleanupTime,
                protectedFiles: cleanupStats.protectedFiles
            },
            
            // File analysis stats
            fileAnalysis: {
                filesAnalyzed: detectorStats.filesAnalyzed,
                averageFileSize: detectorStats.averageFileSize,
                largestFile: detectorStats.largestFileProcessed
            },
            
            // Aggregated stats
            aggregated: this.aggregatedStats,
            
            // Current jobs
            currentJobs: Array.from(this.currentJobs.values()).map(job => ({
                jobId: job.jobId,
                userId: job.userId,
                fileName: job.fileAnalysis.fileName,
                category: job.fileAnalysis.category,
                duration: Date.now() - job.startTime,
                status: job.status
            }))
        };
    }

    /**
     * Force system optimization (cleanup, GC, etc.)
     */
    async forceOptimization() {
        console.log('Forcing system optimization...');

        try {
            // Force memory check and potential GC
            await this.memoryMonitor.forceCheck();
            
            // Force cleanup
            const cleanupResult = await this.tempFileCleanup.forceCleanup();
            
            // Trigger GC if available
            if (global.gc) {
                global.gc();
            }

            console.log('System optimization completed:', {
                filesRemoved: cleanupResult.filesRemoved,
                bytesFreed: cleanupResult.bytesFreed
            });

            this.emit('optimization-completed', cleanupResult);
            return cleanupResult;

        } catch (error) {
            console.error('System optimization failed:', error);
            throw error;
        }
    }

    /**
     * Setup event handlers for component integration
     */
    setupEventHandlers() {
        // Memory monitor events
        this.memoryMonitor.on('memory-alert', (alert) => {
            this.handleMemoryAlert(alert);
        });

        this.memoryMonitor.on('memory-action', (action) => {
            this.handleMemoryAction(action);
        });

        // Resource pool events
        this.resourcePool.on('system-paused', (data) => {
            console.warn('System paused due to resource constraints:', data.reason);
            this.emit('system-paused', data);
        });

        this.resourcePool.on('system-resumed', (data) => {
            console.log('System resumed - resources available');
            this.emit('system-resumed', data);
        });

        // Cleanup events
        this.tempFileCleanup.on('cleanup-completed', (result) => {
            this.aggregatedStats.totalCleanupOperations++;
            this.emit('cleanup-completed', result);
        });

        // Error handling
        this.memoryMonitor.on('monitor-error', (error) => {
            console.error('Memory monitor error:', error);
            this.emit('error', { component: 'memoryMonitor', error });
        });

        this.tempFileCleanup.on('cleanup-error', (error) => {
            console.error('Cleanup error:', error);
            this.emit('error', { component: 'tempFileCleanup', error });
        });
    }

    /**
     * Handle memory alerts
     * @param {Object} alert - Memory alert data
     */
    handleMemoryAlert(alert) {
        this.aggregatedStats.totalMemoryAlerts++;
        
        console.warn(`Memory alert [${alert.level}]: ${alert.message}`);
        
        // Take action based on alert level
        if (alert.level === 'critical' || alert.level === 'emergency') {
            if (this.config.enableMemoryPausing) {
                this.resourcePool.pauseNewJobs(`Memory ${alert.level}: ${(alert.usage * 100).toFixed(1)}%`);
            }
        }

        this.emit('memory-alert', alert);
    }

    /**
     * Handle memory actions
     * @param {Object} action - Memory action data
     */
    handleMemoryAction(action) {
        switch (action.action) {
            case 'pause-new-jobs':
                if (this.config.enableMemoryPausing) {
                    this.resourcePool.pauseNewJobs('Memory monitor requested pause');
                }
                break;
                
            case 'emergency-pause':
                this.resourcePool.pauseNewJobs('EMERGENCY: Critical memory usage');
                // Also force cleanup
                this.tempFileCleanup.forceCleanup();
                break;
        }

        this.emit('memory-action', action);
    }

    /**
     * Update aggregated statistics
     * @param {Object} jobData - Completed job data
     */
    updateAggregatedStats(jobData) {
        this.aggregatedStats.totalJobsProcessed++;
        
        // Update average job duration
        const currentAvg = this.aggregatedStats.averageJobDuration;
        const totalJobs = this.aggregatedStats.totalJobsProcessed;
        this.aggregatedStats.averageJobDuration = 
            (currentAvg * (totalJobs - 1) + jobData.duration) / totalJobs;
    }

    /**
     * Get detailed performance metrics
     * @returns {Object} Performance metrics
     */
    getPerformanceMetrics() {
        const systemStatus = this.getSystemStatus();
        const memoryHistory = this.memoryMonitor.getHistory(20);
        
        return {
            ...systemStatus,
            performance: {
                memoryTrend: this.calculateMemoryTrend(memoryHistory),
                jobThroughput: this.calculateJobThroughput(),
                systemEfficiency: this.calculateSystemEfficiency(),
                resourceUtilization: systemStatus.resources.utilization
            }
        };
    }

    /**
     * Calculate memory trend from history
     * @param {Array} memoryHistory - Memory history data
     * @returns {string} Trend direction
     */
    calculateMemoryTrend(memoryHistory) {
        if (memoryHistory.length < 2) return 'stable';
        
        const recent = memoryHistory.slice(-5);
        const older = memoryHistory.slice(-10, -5);
        
        if (older.length === 0) return 'stable';
        
        const recentAvg = recent.reduce((sum, data) => sum + data.primaryUsage, 0) / recent.length;
        const olderAvg = older.reduce((sum, data) => sum + data.primaryUsage, 0) / older.length;
        
        const difference = recentAvg - olderAvg;
        
        if (difference > 0.05) return 'increasing';
        if (difference < -0.05) return 'decreasing';
        return 'stable';
    }

    /**
     * Calculate job throughput (jobs per minute)
     * @returns {number} Jobs per minute
     */
    calculateJobThroughput() {
        const uptime = Date.now() - this.aggregatedStats.systemUptime;
        const uptimeMinutes = uptime / (1000 * 60);
        
        if (uptimeMinutes === 0) return 0;
        
        return Math.round((this.aggregatedStats.totalJobsProcessed / uptimeMinutes) * 100) / 100;
    }

    /**
     * Calculate system efficiency percentage
     * @returns {number} Efficiency percentage
     */
    calculateSystemEfficiency() {
        const resourceStats = this.resourcePool.getStats();
        const memoryStatus = this.memoryMonitor.getStatus();
        
        // Base efficiency on resource utilization and memory health
        const resourceEfficiency = Math.min(resourceStats.resourceUtilization / 80, 1); // 80% is optimal
        const memoryEfficiency = memoryStatus.currentState.level === 'normal' ? 1 : 0.5;
        
        return Math.round((resourceEfficiency * memoryEfficiency) * 100);
    }
}

export default ResourceOptimizationManager;