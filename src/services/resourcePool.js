import EventEmitter from 'events';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';

/**
 * ResourcePool - Manages concurrent job limits and memory usage
 * Prevents system overload by controlling resource allocation
 */
class ResourcePool extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            maxConcurrentJobs: config.maxConcurrentJobs || 10,
            maxMemoryUsageMB: config.maxMemoryUsageMB || 2048, // 2GB
            memoryCheckInterval: config.memoryCheckInterval || 5000, // 5 seconds
            largeFileThresholdMB: config.largeFileThresholdMB || 50,
            maxLargeFileConcurrent: config.maxLargeFileConcurrent || 2,
            tempDir: config.tempDir || path.join(process.cwd(), 'temp'),
            cleanupInterval: config.cleanupInterval || 30000, // 30 seconds
            ...config
        };

        // Active job tracking
        this.activeJobs = new Map();
        this.largeFileJobs = new Set();
        this.waitingQueue = [];
        this.largeFileQueue = [];
        
        // Memory monitoring
        this.memoryMonitorInterval = null;
        this.cleanupInterval = null;
        this.isPaused = false;
        this.lastMemoryCheck = Date.now();
        
        // Statistics
        this.stats = {
            totalJobsProcessed: 0,
            totalJobsRejected: 0,
            averageMemoryUsage: 0,
            peakMemoryUsage: 0,
            largeFilesProcessed: 0,
            tempFilesCreated: 0,
            tempFilesCleanedUp: 0
        };

        this.initialize();
    }

    async initialize() {
        // Ensure temp directory exists
        await this.ensureTempDirectory();
        
        // Start memory monitoring
        this.startMemoryMonitoring();
        
        // Start cleanup process
        this.startCleanupProcess();
        
        console.log('ResourcePool initialized with config:', {
            maxConcurrentJobs: this.config.maxConcurrentJobs,
            maxMemoryUsageMB: this.config.maxMemoryUsageMB,
            largeFileThresholdMB: this.config.largeFileThresholdMB,
            tempDir: this.config.tempDir
        });
    }

    /**
     * Acquire a resource slot for job processing
     * @param {Object} jobInfo - Job information including file size
     * @returns {Promise<string>} Job ID if resource acquired
     */
    async acquireResource(jobInfo = {}) {
        const { fileSize = 0, userId, jobType = 'normal' } = jobInfo;
        const fileSizeMB = fileSize / (1024 * 1024);
        const isLargeFile = fileSizeMB > this.config.largeFileThresholdMB;

        // Check if system is paused due to memory constraints
        if (this.isPaused) {
            throw new Error('System temporarily paused due to high memory usage');
        }

        // Check memory before accepting new jobs
        const memoryUsage = await this.getCurrentMemoryUsage();
        if (memoryUsage > this.config.maxMemoryUsageMB * 0.9) { // 90% threshold
            this.pauseNewJobs('High memory usage detected');
            throw new Error('System memory usage too high, job rejected');
        }

        const jobId = this.generateJobId();
        
        return new Promise((resolve, reject) => {
            const jobRequest = {
                jobId,
                userId,
                jobType,
                fileSize: fileSizeMB,
                isLargeFile,
                resolve,
                reject,
                timestamp: Date.now()
            };

            if (isLargeFile) {
                if (this.largeFileJobs.size < this.config.maxLargeFileConcurrent) {
                    this.allocateLargeFileResource(jobRequest);
                } else {
                    this.largeFileQueue.push(jobRequest);
                    this.emit('job-queued', { jobId, type: 'large-file', queuePosition: this.largeFileQueue.length });
                }
            } else {
                if (this.activeJobs.size < this.config.maxConcurrentJobs) {
                    this.allocateNormalResource(jobRequest);
                } else {
                    this.waitingQueue.push(jobRequest);
                    this.emit('job-queued', { jobId, type: 'normal', queuePosition: this.waitingQueue.length });
                }
            }
        });
    }

    /**
     * Release a resource slot after job completion
     * @param {string} jobId - Job ID to release
     */
    async releaseResource(jobId) {
        const job = this.activeJobs.get(jobId);
        if (!job) {
            console.warn(`Attempted to release unknown job: ${jobId}`);
            return;
        }

        // Update statistics
        this.stats.totalJobsProcessed++;
        
        // Clean up job-specific temp files
        await this.cleanupJobFiles(jobId);

        // Remove from active tracking
        this.activeJobs.delete(jobId);
        if (job.isLargeFile) {
            this.largeFileJobs.delete(jobId);
        }

        this.emit('job-completed', { 
            jobId, 
            processingTime: Date.now() - job.startTime,
            memoryUsed: job.memoryUsed 
        });

        // Process waiting queue
        await this.processWaitingQueue();
    }

    /**
     * Create temporary file for job processing
     * @param {string} jobId - Job ID
     * @param {string} filename - Original filename
     * @returns {string} Temporary file path
     */
    async createTempFile(jobId, filename) {
        const jobTempDir = path.join(this.config.tempDir, jobId);
        await fs.mkdir(jobTempDir, { recursive: true });
        
        const tempFilePath = path.join(jobTempDir, filename);
        this.stats.tempFilesCreated++;
        
        // Track temp file for cleanup
        const job = this.activeJobs.get(jobId);
        if (job) {
            if (!job.tempFiles) job.tempFiles = [];
            job.tempFiles.push(tempFilePath);
        }

        return tempFilePath;
    }

    /**
     * Get current system memory usage in MB
     * @returns {number} Memory usage in MB
     */
    async getCurrentMemoryUsage() {
        const memInfo = process.memoryUsage();
        const systemMemory = os.totalmem();
        const freeMemory = os.freemem();
        const usedMemory = systemMemory - freeMemory;
        
        const processMemoryMB = memInfo.rss / (1024 * 1024);
        const systemMemoryMB = usedMemory / (1024 * 1024);
        
        // Update statistics
        this.stats.averageMemoryUsage = (this.stats.averageMemoryUsage + processMemoryMB) / 2;
        if (processMemoryMB > this.stats.peakMemoryUsage) {
            this.stats.peakMemoryUsage = processMemoryMB;
        }

        return Math.max(processMemoryMB, systemMemoryMB);
    }

    /**
     * Pause new job acceptance due to resource constraints
     * @param {string} reason - Reason for pausing
     */
    pauseNewJobs(reason = 'Resource constraints') {
        if (!this.isPaused) {
            this.isPaused = true;
            console.warn(`ResourcePool paused: ${reason}`);
            this.emit('system-paused', { reason, timestamp: Date.now() });
            
            // Auto-resume after memory check
            setTimeout(() => this.checkResumeConditions(), 10000);
        }
    }

    /**
     * Resume job acceptance if conditions are met
     */
    async resumeJobs() {
        if (this.isPaused) {
            const memoryUsage = await this.getCurrentMemoryUsage();
            if (memoryUsage < this.config.maxMemoryUsageMB * 0.7) { // 70% threshold for resume
                this.isPaused = false;
                console.log('ResourcePool resumed - memory usage normalized');
                this.emit('system-resumed', { timestamp: Date.now() });
                
                // Process waiting queues
                await this.processWaitingQueue();
            }
        }
    }

    /**
     * Get current resource pool statistics
     * @returns {Object} Current statistics
     */
    getStats() {
        return {
            ...this.stats,
            activeJobs: this.activeJobs.size,
            largeFileJobs: this.largeFileJobs.size,
            waitingQueue: this.waitingQueue.length,
            largeFileQueue: this.largeFileQueue.length,
            isPaused: this.isPaused,
            currentMemoryUsage: 0, // Will be updated by monitoring
            resourceUtilization: (this.activeJobs.size / this.config.maxConcurrentJobs) * 100
        };
    }

    // Private methods

    allocateNormalResource(jobRequest) {
        const { jobId, resolve } = jobRequest;
        
        this.activeJobs.set(jobId, {
            ...jobRequest,
            startTime: Date.now(),
            tempFiles: []
        });

        this.emit('job-started', { jobId, type: 'normal' });
        resolve(jobId);
    }

    allocateLargeFileResource(jobRequest) {
        const { jobId, resolve } = jobRequest;
        
        this.activeJobs.set(jobId, {
            ...jobRequest,
            startTime: Date.now(),
            tempFiles: []
        });
        
        this.largeFileJobs.add(jobId);
        this.stats.largeFilesProcessed++;

        this.emit('job-started', { jobId, type: 'large-file' });
        resolve(jobId);
    }

    async processWaitingQueue() {
        // Process normal queue
        while (this.waitingQueue.length > 0 && this.activeJobs.size < this.config.maxConcurrentJobs) {
            const jobRequest = this.waitingQueue.shift();
            this.allocateNormalResource(jobRequest);
        }

        // Process large file queue
        while (this.largeFileQueue.length > 0 && this.largeFileJobs.size < this.config.maxLargeFileConcurrent) {
            const jobRequest = this.largeFileQueue.shift();
            this.allocateLargeFileResource(jobRequest);
        }
    }

    generateJobId() {
        return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    async ensureTempDirectory() {
        try {
            await fs.mkdir(this.config.tempDir, { recursive: true });
        } catch (error) {
            console.error('Failed to create temp directory:', error);
            throw error;
        }
    }

    startMemoryMonitoring() {
        this.memoryMonitorInterval = setInterval(async () => {
            try {
                const memoryUsage = await this.getCurrentMemoryUsage();
                
                // Update current memory in stats
                this.stats.currentMemoryUsage = memoryUsage;
                
                // Check if we need to pause/resume
                if (memoryUsage > this.config.maxMemoryUsageMB * 0.9) {
                    this.pauseNewJobs(`Memory usage: ${memoryUsage.toFixed(2)}MB`);
                } else if (this.isPaused && memoryUsage < this.config.maxMemoryUsageMB * 0.7) {
                    await this.resumeJobs();
                }

                this.emit('memory-check', { 
                    usage: memoryUsage, 
                    threshold: this.config.maxMemoryUsageMB,
                    isPaused: this.isPaused 
                });

            } catch (error) {
                console.error('Memory monitoring error:', error);
            }
        }, this.config.memoryCheckInterval);
    }

    startCleanupProcess() {
        this.cleanupInterval = setInterval(async () => {
            await this.performAggressiveCleanup();
        }, this.config.cleanupInterval);
    }

    async performAggressiveCleanup() {
        try {
            const tempDirExists = await fs.access(this.config.tempDir).then(() => true).catch(() => false);
            if (!tempDirExists) return;

            const entries = await fs.readdir(this.config.tempDir, { withFileTypes: true });
            const now = Date.now();
            let cleanedFiles = 0;

            for (const entry of entries) {
                const fullPath = path.join(this.config.tempDir, entry.name);
                
                try {
                    const stats = await fs.stat(fullPath);
                    const ageMinutes = (now - stats.mtime.getTime()) / (1000 * 60);
                    
                    // Clean files older than 30 minutes or from completed jobs
                    if (ageMinutes > 30 || !this.activeJobs.has(entry.name)) {
                        if (entry.isDirectory()) {
                            await fs.rmdir(fullPath, { recursive: true });
                        } else {
                            await fs.unlink(fullPath);
                        }
                        cleanedFiles++;
                        this.stats.tempFilesCleanedUp++;
                    }
                } catch (error) {
                    // File might have been deleted already, continue
                    continue;
                }
            }

            if (cleanedFiles > 0) {
                console.log(`Cleaned up ${cleanedFiles} temporary files/directories`);
                this.emit('cleanup-completed', { filesRemoved: cleanedFiles });
            }

        } catch (error) {
            console.error('Cleanup process error:', error);
        }
    }

    async cleanupJobFiles(jobId) {
        const job = this.activeJobs.get(jobId);
        if (!job || !job.tempFiles) return;

        let cleanedFiles = 0;
        for (const filePath of job.tempFiles) {
            try {
                await fs.unlink(filePath);
                cleanedFiles++;
                this.stats.tempFilesCleanedUp++;
            } catch (error) {
                // File might already be deleted
                continue;
            }
        }

        // Clean job directory
        const jobTempDir = path.join(this.config.tempDir, jobId);
        try {
            await fs.rmdir(jobTempDir, { recursive: true });
            cleanedFiles++;
        } catch (error) {
            // Directory might not exist or already cleaned
        }

        if (cleanedFiles > 0) {
            console.log(`Cleaned up ${cleanedFiles} files for job ${jobId}`);
        }
    }

    async checkResumeConditions() {
        if (this.isPaused) {
            await this.resumeJobs();
        }
    }

    /**
     * Shutdown the resource pool gracefully
     */
    async shutdown() {
        console.log('Shutting down ResourcePool...');
        
        // Clear intervals
        if (this.memoryMonitorInterval) {
            clearInterval(this.memoryMonitorInterval);
        }
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }

        // Reject all waiting jobs
        [...this.waitingQueue, ...this.largeFileQueue].forEach(job => {
            job.reject(new Error('System shutting down'));
        });

        // Final cleanup
        await this.performAggressiveCleanup();
        
        console.log('ResourcePool shutdown complete');
    }
}

export default ResourcePool;