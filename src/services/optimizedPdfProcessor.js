import ResourceOptimizationManager from './resourceOptimizationManager.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * OptimizedPdfProcessor - PDF processing service with full resource optimization
 * Integrates the resource optimization system with PDF processing workflows
 */
class OptimizedPdfProcessor {
    constructor(config = {}) {
        this.config = {
            // Resource optimization settings
            maxConcurrentJobs: config.maxConcurrentJobs || 10,
            maxMemoryUsageMB: config.maxMemoryUsageMB || 2048,
            largeFileThresholdMB: config.largeFileThresholdMB || 50,
            
            // Processing settings
            processingTimeout: config.processingTimeout || 300000, // 5 minutes
            retryAttempts: config.retryAttempts || 3,
            
            // Temp file settings
            tempDir: config.tempDir || path.join(process.cwd(), 'temp', 'pdf-processing'),
            
            ...config
        };

        // Initialize resource optimization manager
        this.resourceManager = new ResourceOptimizationManager({
            resourcePool: {
                maxConcurrentJobs: this.config.maxConcurrentJobs,
                maxMemoryUsageMB: this.config.maxMemoryUsageMB,
                largeFileThresholdMB: this.config.largeFileThresholdMB,
                tempDir: this.config.tempDir
            },
            autoStart: true
        });

        // Processing statistics
        this.stats = {
            totalProcessed: 0,
            successfulProcessed: 0,
            failedProcessed: 0,
            averageProcessingTime: 0,
            largeFilesProcessed: 0,
            memoryOptimizationsTriggered: 0
        };

        this.isInitialized = false;
        this.setupEventHandlers();
    }

    /**
     * Initialize the optimized PDF processor
     */
    async initialize() {
        if (this.isInitialized) {
            console.warn('OptimizedPdfProcessor already initialized');
            return;
        }

        console.log('Initializing OptimizedPdfProcessor...');

        try {
            await this.resourceManager.initialize();
            this.isInitialized = true;
            
            console.log('OptimizedPdfProcessor initialized successfully');
            
        } catch (error) {
            console.error('Failed to initialize OptimizedPdfProcessor:', error);
            throw error;
        }
    }

    /**
     * Process a PDF file with full resource optimization
     * @param {Object} jobRequest - Job request object
     * @returns {Object} Processing result
     */
    async processPdf(jobRequest) {
        const { filePath, userId, options = {} } = jobRequest;
        
        if (!this.isInitialized) {
            throw new Error('OptimizedPdfProcessor not initialized');
        }

        console.log(`Starting optimized PDF processing for user ${userId}: ${path.basename(filePath)}`);
        
        let jobContext = null;
        const startTime = Date.now();

        try {
            // 1. Acquire resources and analyze file
            jobContext = await this.resourceManager.processJob({
                filePath,
                userId,
                jobType: 'pdf-processing'
            });

            console.log(`Job ${jobContext.jobId} acquired resources:`, {
                category: jobContext.fileAnalysis.category,
                estimatedTime: jobContext.fileAnalysis.estimatedProcessingTime.estimatedSeconds + 's',
                strategy: jobContext.processingStrategy
            });

            // 2. Apply processing strategy based on file analysis
            const processingResult = await this.executeProcessingStrategy(jobContext, options);

            // 3. Complete job successfully
            await this.resourceManager.completeJob(jobContext.jobId, {
                success: true,
                result: processingResult
            });

            // 4. Update statistics
            this.updateStatistics(jobContext, processingResult, Date.now() - startTime);

            console.log(`PDF processing completed successfully for job ${jobContext.jobId}`);
            
            return {
                success: true,
                jobId: jobContext.jobId,
                result: processingResult,
                processingTime: Date.now() - startTime,
                fileAnalysis: jobContext.fileAnalysis,
                resourcesUsed: this.resourceManager.getSystemStatus().resources
            };

        } catch (error) {
            console.error(`PDF processing failed for job ${jobContext?.jobId || 'unknown'}:`, error);

            // Handle job failure
            if (jobContext) {
                await this.resourceManager.failJob(jobContext.jobId, error);
            }

            this.stats.failedProcessed++;
            
            throw error;
        }
    }

    /**
     * Execute processing strategy based on file analysis
     * @param {Object} jobContext - Job context from resource manager
     * @param {Object} options - Processing options
     * @returns {Object} Processing result
     */
    async executeProcessingStrategy(jobContext, options) {
        const { fileAnalysis, processingStrategy, tempFilePath, originalFilePath } = jobContext;
        
        // Copy file to temp location for processing
        await fs.copyFile(originalFilePath, tempFilePath);
        
        // Select processing approach based on file category
        switch (fileAnalysis.category) {
            case 'small':
                return await this.processSmallFile(tempFilePath, options, processingStrategy);
                
            case 'medium':
                return await this.processMediumFile(tempFilePath, options, processingStrategy);
                
            case 'large':
                return await this.processLargeFile(tempFilePath, options, processingStrategy);
                
            case 'extraLarge':
                return await this.processExtraLargeFile(tempFilePath, options, processingStrategy);
                
            case 'huge':
                return await this.processHugeFile(tempFilePath, options, processingStrategy);
                
            default:
                return await this.processMediumFile(tempFilePath, options, processingStrategy);
        }
    }

    /**
     * Process small files (< 5MB) - Fast processing
     * @param {string} filePath - File path
     * @param {Object} options - Processing options
     * @param {Object} strategy - Processing strategy
     * @returns {Object} Processing result
     */
    async processSmallFile(filePath, options, strategy) {
        console.log('Processing small file with optimized pipeline');
        
        // Use lightweight processing for small files
        const result = await this.performBasicProcessing(filePath, {
            ...options,
            optimization: 'speed',
            memoryLimit: strategy.memoryLimit
        });

        return {
            ...result,
            processingType: 'small-file-optimized',
            optimizations: ['fast-pipeline', 'minimal-memory']
        };
    }

    /**
     * Process medium files (5-25MB) - Standard processing
     * @param {string} filePath - File path
     * @param {Object} options - Processing options
     * @param {Object} strategy - Processing strategy
     * @returns {Object} Processing result
     */
    async processMediumFile(filePath, options, strategy) {
        console.log('Processing medium file with standard pipeline');
        
        const result = await this.performStandardProcessing(filePath, {
            ...options,
            optimization: 'balanced',
            memoryLimit: strategy.memoryLimit
        });

        return {
            ...result,
            processingType: 'medium-file-standard',
            optimizations: ['balanced-pipeline']
        };
    }

    /**
     * Process large files (25-50MB) - Memory-optimized processing
     * @param {string} filePath - File path
     * @param {Object} options - Processing options
     * @param {Object} strategy - Processing strategy
     * @returns {Object} Processing result
     */
    async processLargeFile(filePath, options, strategy) {
        console.log('Processing large file with memory-optimized pipeline');
        
        this.stats.largeFilesProcessed++;
        
        // Use chunked processing for large files
        const result = await this.performChunkedProcessing(filePath, {
            ...options,
            optimization: 'memory',
            memoryLimit: strategy.memoryLimit,
            chunkSize: 5 * 1024 * 1024 // 5MB chunks
        });

        return {
            ...result,
            processingType: 'large-file-chunked',
            optimizations: ['memory-optimized', 'chunked-processing']
        };
    }

    /**
     * Process extra large files (50-100MB) - Specialized processing
     * @param {string} filePath - File path
     * @param {Object} options - Processing options
     * @param {Object} strategy - Processing strategy
     * @returns {Object} Processing result
     */
    async processExtraLargeFile(filePath, options, strategy) {
        console.log('Processing extra large file with specialized pipeline');
        
        this.stats.largeFilesProcessed++;
        
        // Use streaming processing for extra large files
        const result = await this.performStreamingProcessing(filePath, {
            ...options,
            optimization: 'memory-aggressive',
            memoryLimit: strategy.memoryLimit,
            streamBufferSize: 2 * 1024 * 1024 // 2MB buffer
        });

        return {
            ...result,
            processingType: 'extra-large-streaming',
            optimizations: ['streaming-processing', 'aggressive-memory-management']
        };
    }

    /**
     * Process huge files (>100MB) - Maximum optimization
     * @param {string} filePath - File path
     * @param {Object} options - Processing options
     * @param {Object} strategy - Processing strategy
     * @returns {Object} Processing result
     */
    async processHugeFile(filePath, options, strategy) {
        console.log('Processing huge file with maximum optimization pipeline');
        
        this.stats.largeFilesProcessed++;
        
        // Use progressive processing for huge files
        const result = await this.performProgressiveProcessing(filePath, {
            ...options,
            optimization: 'maximum',
            memoryLimit: strategy.memoryLimit,
            progressiveChunks: true,
            backgroundProcessing: true
        });

        return {
            ...result,
            processingType: 'huge-file-progressive',
            optimizations: ['progressive-processing', 'background-processing', 'maximum-memory-optimization']
        };
    }

    /**
     * Perform basic processing for small files
     * @param {string} filePath - File path
     * @param {Object} options - Processing options
     * @returns {Object} Processing result
     */
    async performBasicProcessing(filePath, options) {
        // Simulate basic PDF processing
        await this.simulateProcessing(1000, options.memoryLimit); // 1 second
        
        return {
            pages: 10,
            text: 'Extracted text content',
            metadata: { title: 'Sample PDF', author: 'Test' },
            processingTime: 1000,
            memoryUsed: 50 // MB
        };
    }

    /**
     * Perform standard processing for medium files
     * @param {string} filePath - File path
     * @param {Object} options - Processing options
     * @returns {Object} Processing result
     */
    async performStandardProcessing(filePath, options) {
        // Simulate standard PDF processing
        await this.simulateProcessing(3000, options.memoryLimit); // 3 seconds
        
        return {
            pages: 25,
            text: 'Extracted text content with formatting',
            metadata: { title: 'Medium PDF', author: 'Test', pages: 25 },
            images: ['image1.jpg', 'image2.jpg'],
            processingTime: 3000,
            memoryUsed: 150 // MB
        };
    }

    /**
     * Perform chunked processing for large files
     * @param {string} filePath - File path
     * @param {Object} options - Processing options
     * @returns {Object} Processing result
     */
    async performChunkedProcessing(filePath, options) {
        console.log('Using chunked processing strategy');
        
        // Simulate chunked processing
        const chunks = 5;
        const results = [];
        
        for (let i = 0; i < chunks; i++) {
            console.log(`Processing chunk ${i + 1}/${chunks}`);
            await this.simulateProcessing(2000, options.memoryLimit / chunks); // 2 seconds per chunk
            results.push(`chunk_${i + 1}_result`);
            
            // Force garbage collection between chunks if available
            if (global.gc) {
                global.gc();
            }
        }
        
        return {
            pages: 50,
            text: 'Extracted text content from chunked processing',
            metadata: { title: 'Large PDF', author: 'Test', pages: 50 },
            chunks: results,
            processingTime: 10000,
            memoryUsed: 300 // MB
        };
    }

    /**
     * Perform streaming processing for extra large files
     * @param {string} filePath - File path
     * @param {Object} options - Processing options
     * @returns {Object} Processing result
     */
    async performStreamingProcessing(filePath, options) {
        console.log('Using streaming processing strategy');
        
        // Simulate streaming processing with memory management
        const streams = 10;
        
        for (let i = 0; i < streams; i++) {
            console.log(`Processing stream ${i + 1}/${streams}`);
            await this.simulateProcessing(1500, options.streamBufferSize); // 1.5 seconds per stream
            
            // Aggressive memory cleanup
            if (i % 3 === 0 && global.gc) {
                global.gc();
            }
        }
        
        return {
            pages: 100,
            text: 'Extracted text content from streaming processing',
            metadata: { title: 'Extra Large PDF', author: 'Test', pages: 100 },
            streams: streams,
            processingTime: 15000,
            memoryUsed: 500 // MB
        };
    }

    /**
     * Perform progressive processing for huge files
     * @param {string} filePath - File path
     * @param {Object} options - Processing options
     * @returns {Object} Processing result
     */
    async performProgressiveProcessing(filePath, options) {
        console.log('Using progressive processing strategy');
        
        // Simulate progressive processing with background optimization
        const phases = ['analysis', 'extraction', 'processing', 'optimization', 'finalization'];
        
        for (const phase of phases) {
            console.log(`Progressive phase: ${phase}`);
            await this.simulateProcessing(4000, options.memoryLimit / phases.length); // 4 seconds per phase
            
            // Memory optimization between phases
            if (global.gc) {
                global.gc();
            }
        }
        
        return {
            pages: 200,
            text: 'Extracted text content from progressive processing',
            metadata: { title: 'Huge PDF', author: 'Test', pages: 200 },
            phases: phases,
            processingTime: 20000,
            memoryUsed: 800 // MB
        };
    }

    /**
     * Simulate processing with memory constraints
     * @param {number} duration - Processing duration in ms
     * @param {number} memoryLimit - Memory limit in MB
     */
    async simulateProcessing(duration, memoryLimit) {
        // Simulate memory usage within limits
        const startMemory = process.memoryUsage().heapUsed;
        
        // Simulate processing work
        await new Promise(resolve => setTimeout(resolve, duration));
        
        const endMemory = process.memoryUsage().heapUsed;
        const memoryUsedMB = (endMemory - startMemory) / (1024 * 1024);
        
        // Log memory usage for monitoring
        if (memoryUsedMB > memoryLimit * 0.8) {
            console.warn(`Memory usage approaching limit: ${memoryUsedMB.toFixed(2)}MB / ${memoryLimit}MB`);
        }
    }

    /**
     * Get processing queue status
     * @returns {Object} Queue status
     */
    getQueueStatus() {
        const systemStatus = this.resourceManager.getSystemStatus();
        
        return {
            activeJobs: systemStatus.resources.activeJobs,
            waitingQueue: systemStatus.resources.waitingQueue,
            largeFileJobs: systemStatus.resources.largeFileJobs,
            isPaused: systemStatus.resources.isPaused,
            memoryStatus: systemStatus.memory.level,
            utilization: systemStatus.resources.utilization
        };
    }

    /**
     * Get comprehensive processing statistics
     * @returns {Object} Processing statistics
     */
    getStatistics() {
        const systemStatus = this.resourceManager.getSystemStatus();
        
        return {
            processing: this.stats,
            system: systemStatus,
            performance: this.resourceManager.getPerformanceMetrics().performance
        };
    }

    /**
     * Force system optimization
     * @returns {Object} Optimization result
     */
    async forceOptimization() {
        console.log('Forcing system optimization...');
        
        const result = await this.resourceManager.forceOptimization();
        this.stats.memoryOptimizationsTriggered++;
        
        return result;
    }

    /**
     * Setup event handlers for resource management
     */
    setupEventHandlers() {
        this.resourceManager.on('memory-alert', (alert) => {
            console.warn(`Memory alert in PDF processor [${alert.level}]: ${alert.message}`);
            
            if (alert.level === 'critical' || alert.level === 'emergency') {
                this.stats.memoryOptimizationsTriggered++;
            }
        });

        this.resourceManager.on('system-paused', (data) => {
            console.warn('PDF processing paused due to resource constraints:', data.reason);
        });

        this.resourceManager.on('system-resumed', () => {
            console.log('PDF processing resumed - resources available');
        });

        this.resourceManager.on('cleanup-completed', (result) => {
            if (result.filesRemoved > 0) {
                console.log(`Cleanup completed: ${result.filesRemoved} files, ${result.bytesFreed} bytes freed`);
            }
        });
    }

    /**
     * Update processing statistics
     * @param {Object} jobContext - Job context
     * @param {Object} result - Processing result
     * @param {number} duration - Processing duration
     */
    updateStatistics(jobContext, result, duration) {
        this.stats.totalProcessed++;
        this.stats.successfulProcessed++;
        
        // Update average processing time
        const currentAvg = this.stats.averageProcessingTime;
        const totalJobs = this.stats.totalProcessed;
        this.stats.averageProcessingTime = 
            (currentAvg * (totalJobs - 1) + duration) / totalJobs;
    }

    /**
     * Shutdown the processor gracefully
     */
    async shutdown() {
        console.log('Shutting down OptimizedPdfProcessor...');
        
        if (this.resourceManager) {
            await this.resourceManager.stop();
        }
        
        console.log('OptimizedPdfProcessor shutdown complete');
    }
}

export default OptimizedPdfProcessor;