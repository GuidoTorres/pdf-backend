import fs from 'fs/promises';
import path from 'path';

/**
 * FileSizeDetector - Analyzes file sizes and categorizes them for optimal processing
 * Provides automatic detection of large files and processing recommendations
 */
class FileSizeDetector {
    constructor(config = {}) {
        this.config = {
            // Size thresholds in MB
            smallFileThreshold: config.smallFileThreshold || 5,     // < 5MB
            mediumFileThreshold: config.mediumFileThreshold || 25,  // 5-25MB
            largeFileThreshold: config.largeFileThreshold || 50,    // 25-50MB
            extraLargeThreshold: config.extraLargeThreshold || 100, // 50-100MB
            // > 100MB = huge files
            
            // Processing recommendations
            processingStrategies: {
                small: {
                    maxConcurrent: 10,
                    priority: 'normal',
                    memoryLimit: 100, // MB
                    timeout: 30000,   // 30 seconds
                    retries: 3
                },
                medium: {
                    maxConcurrent: 5,
                    priority: 'normal',
                    memoryLimit: 200,
                    timeout: 60000,   // 1 minute
                    retries: 3
                },
                large: {
                    maxConcurrent: 2,
                    priority: 'low',
                    memoryLimit: 400,
                    timeout: 180000,  // 3 minutes
                    retries: 2
                },
                extraLarge: {
                    maxConcurrent: 1,
                    priority: 'low',
                    memoryLimit: 800,
                    timeout: 300000,  // 5 minutes
                    retries: 1
                },
                huge: {
                    maxConcurrent: 1,
                    priority: 'background',
                    memoryLimit: 1200,
                    timeout: 600000,  // 10 minutes
                    retries: 1,
                    requiresSpecialHandling: true
                }
            },
            
            // File type specific adjustments
            fileTypeMultipliers: {
                '.pdf': 1.0,      // Base multiplier
                '.docx': 0.8,     // Usually smaller when processed
                '.xlsx': 1.2,     // Can expand significantly
                '.pptx': 1.5,     // Often contains images
                '.txt': 0.3,      // Very lightweight
                '.csv': 0.5,      // Structured but lightweight
                '.html': 0.7,     // Moderate processing overhead
                '.xml': 0.6       // Structured, moderate overhead
            },
            
            ...config
        };

        // Statistics tracking
        this.stats = {
            filesAnalyzed: 0,
            categoryCounts: {
                small: 0,
                medium: 0,
                large: 0,
                extraLarge: 0,
                huge: 0
            },
            averageFileSize: 0,
            largestFileProcessed: 0,
            totalSizeProcessed: 0
        };
    }

    /**
     * Analyze a file and determine its processing category
     * @param {string} filePath - Path to the file
     * @param {Object} options - Additional options
     * @returns {Object} Analysis result
     */
    async analyzeFile(filePath, options = {}) {
        try {
            const fileStats = await fs.stat(filePath);
            const fileSizeBytes = fileStats.size;
            const fileSizeMB = fileSizeBytes / (1024 * 1024);
            
            const fileExtension = path.extname(filePath).toLowerCase();
            const fileName = path.basename(filePath);
            
            // Apply file type multiplier for processing estimation
            const typeMultiplier = this.config.fileTypeMultipliers[fileExtension] || 1.0;
            const estimatedProcessingSizeMB = fileSizeMB * typeMultiplier;
            
            // Determine category based on actual file size
            const category = this.categorizeFileSize(fileSizeMB);
            
            // Get processing strategy
            const strategy = this.config.processingStrategies[category];
            
            // Calculate estimated processing time (rough estimation)
            const estimatedProcessingTime = this.estimateProcessingTime(fileSizeMB, fileExtension);
            
            // Update statistics
            this.updateStatistics(fileSizeMB, category);
            
            const analysis = {
                filePath,
                fileName,
                fileExtension,
                size: {
                    bytes: fileSizeBytes,
                    mb: Math.round(fileSizeMB * 100) / 100,
                    formatted: this.formatFileSize(fileSizeBytes)
                },
                category,
                typeMultiplier,
                estimatedProcessingSizeMB: Math.round(estimatedProcessingSizeMB * 100) / 100,
                processingStrategy: strategy,
                estimatedProcessingTime,
                recommendations: this.generateRecommendations(category, fileSizeMB, fileExtension),
                metadata: {
                    created: fileStats.birthtime,
                    modified: fileStats.mtime,
                    isSymbolicLink: fileStats.isSymbolicLink(),
                    permissions: fileStats.mode
                },
                timestamp: new Date()
            };

            return analysis;
            
        } catch (error) {
            throw new Error(`Failed to analyze file ${filePath}: ${error.message}`);
        }
    }

    /**
     * Analyze multiple files in batch
     * @param {Array} filePaths - Array of file paths
     * @returns {Array} Array of analysis results
     */
    async analyzeFiles(filePaths) {
        const results = [];
        const errors = [];

        for (const filePath of filePaths) {
            try {
                const analysis = await this.analyzeFile(filePath);
                results.push(analysis);
            } catch (error) {
                errors.push({ filePath, error: error.message });
            }
        }

        return {
            results,
            errors,
            summary: this.generateBatchSummary(results)
        };
    }

    /**
     * Categorize file size into processing categories
     * @param {number} fileSizeMB - File size in MB
     * @returns {string} Category name
     */
    categorizeFileSize(fileSizeMB) {
        if (fileSizeMB < this.config.smallFileThreshold) {
            return 'small';
        } else if (fileSizeMB < this.config.mediumFileThreshold) {
            return 'medium';
        } else if (fileSizeMB < this.config.largeFileThreshold) {
            return 'large';
        } else if (fileSizeMB < this.config.extraLargeThreshold) {
            return 'extraLarge';
        } else {
            return 'huge';
        }
    }

    /**
     * Estimate processing time based on file size and type
     * @param {number} fileSizeMB - File size in MB
     * @param {string} fileExtension - File extension
     * @returns {Object} Time estimation
     */
    estimateProcessingTime(fileSizeMB, fileExtension) {
        // Base processing time per MB (in seconds)
        const baseTimePerMB = {
            '.pdf': 2.0,
            '.docx': 1.5,
            '.xlsx': 3.0,
            '.pptx': 2.5,
            '.txt': 0.5,
            '.csv': 1.0,
            '.html': 1.2,
            '.xml': 1.0
        };

        const timePerMB = baseTimePerMB[fileExtension] || 2.0;
        const baseTime = fileSizeMB * timePerMB;
        
        // Add overhead for larger files (non-linear scaling)
        let overhead = 0;
        if (fileSizeMB > 50) {
            overhead = (fileSizeMB - 50) * 0.5; // Additional 0.5s per MB over 50MB
        }
        if (fileSizeMB > 100) {
            overhead += (fileSizeMB - 100) * 0.3; // Additional 0.3s per MB over 100MB
        }

        const totalSeconds = Math.max(5, baseTime + overhead); // Minimum 5 seconds

        return {
            estimatedSeconds: Math.round(totalSeconds),
            estimatedMinutes: Math.round(totalSeconds / 60 * 100) / 100,
            range: {
                min: Math.round(totalSeconds * 0.7), // -30%
                max: Math.round(totalSeconds * 1.5)  // +50%
            },
            confidence: this.calculateConfidence(fileSizeMB, fileExtension)
        };
    }

    /**
     * Calculate confidence level for time estimation
     * @param {number} fileSizeMB - File size in MB
     * @param {string} fileExtension - File extension
     * @returns {string} Confidence level
     */
    calculateConfidence(fileSizeMB, fileExtension) {
        // Higher confidence for smaller files and known formats
        const knownFormats = ['.pdf', '.docx', '.xlsx', '.txt', '.csv'];
        const isKnownFormat = knownFormats.includes(fileExtension);
        
        if (fileSizeMB < 10 && isKnownFormat) {
            return 'high';
        } else if (fileSizeMB < 50 && isKnownFormat) {
            return 'medium';
        } else if (fileSizeMB < 100) {
            return 'medium';
        } else {
            return 'low';
        }
    }

    /**
     * Generate processing recommendations
     * @param {string} category - File category
     * @param {number} fileSizeMB - File size in MB
     * @param {string} fileExtension - File extension
     * @returns {Object} Recommendations
     */
    generateRecommendations(category, fileSizeMB, fileExtension) {
        const recommendations = {
            processingQueue: 'normal',
            specialHandling: false,
            memoryReservation: false,
            userNotification: false,
            backgroundProcessing: false,
            warnings: [],
            optimizations: []
        };

        switch (category) {
            case 'small':
                recommendations.processingQueue = 'fast';
                recommendations.optimizations.push('Can be processed in batch with other small files');
                break;

            case 'medium':
                recommendations.optimizations.push('Standard processing pipeline suitable');
                break;

            case 'large':
                recommendations.processingQueue = 'large-files';
                recommendations.memoryReservation = true;
                recommendations.userNotification = true;
                recommendations.warnings.push('Processing may take several minutes');
                recommendations.optimizations.push('Consider processing during off-peak hours');
                break;

            case 'extraLarge':
                recommendations.processingQueue = 'large-files';
                recommendations.specialHandling = true;
                recommendations.memoryReservation = true;
                recommendations.userNotification = true;
                recommendations.backgroundProcessing = true;
                recommendations.warnings.push('Large file - processing may take 5+ minutes');
                recommendations.warnings.push('System resources will be reserved during processing');
                break;

            case 'huge':
                recommendations.processingQueue = 'huge-files';
                recommendations.specialHandling = true;
                recommendations.memoryReservation = true;
                recommendations.userNotification = true;
                recommendations.backgroundProcessing = true;
                recommendations.warnings.push('Very large file - processing may take 10+ minutes');
                recommendations.warnings.push('File will be processed with maximum resource allocation');
                recommendations.warnings.push('Consider splitting file if possible');
                recommendations.optimizations.push('Schedule processing during maintenance window');
                break;
        }

        // File type specific recommendations
        if (fileExtension === '.xlsx' && fileSizeMB > 25) {
            recommendations.warnings.push('Large Excel files may contain complex formulas that slow processing');
            recommendations.optimizations.push('Consider exporting as CSV for faster processing');
        }

        if (fileExtension === '.pptx' && fileSizeMB > 50) {
            recommendations.warnings.push('Large PowerPoint files often contain high-resolution images');
            recommendations.optimizations.push('Consider reducing image quality before upload');
        }

        return recommendations;
    }

    /**
     * Format file size for human readability
     * @param {number} bytes - File size in bytes
     * @returns {string} Formatted size
     */
    formatFileSize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = bytes;
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }

        return `${Math.round(size * 100) / 100} ${units[unitIndex]}`;
    }

    /**
     * Update internal statistics
     * @param {number} fileSizeMB - File size in MB
     * @param {string} category - File category
     */
    updateStatistics(fileSizeMB, category) {
        this.stats.filesAnalyzed++;
        this.stats.categoryCounts[category]++;
        this.stats.totalSizeProcessed += fileSizeMB;
        
        // Update average
        this.stats.averageFileSize = this.stats.totalSizeProcessed / this.stats.filesAnalyzed;
        
        // Update largest file
        if (fileSizeMB > this.stats.largestFileProcessed) {
            this.stats.largestFileProcessed = fileSizeMB;
        }
    }

    /**
     * Generate summary for batch analysis
     * @param {Array} results - Analysis results
     * @returns {Object} Batch summary
     */
    generateBatchSummary(results) {
        const summary = {
            totalFiles: results.length,
            totalSize: 0,
            categories: {
                small: 0,
                medium: 0,
                large: 0,
                extraLarge: 0,
                huge: 0
            },
            estimatedTotalTime: 0,
            requiresSpecialHandling: 0,
            averageFileSize: 0
        };

        results.forEach(result => {
            summary.totalSize += result.size.mb;
            summary.categories[result.category]++;
            summary.estimatedTotalTime += result.estimatedProcessingTime.estimatedSeconds;
            
            if (result.processingStrategy.requiresSpecialHandling) {
                summary.requiresSpecialHandling++;
            }
        });

        summary.averageFileSize = summary.totalFiles > 0 ? 
            Math.round((summary.totalSize / summary.totalFiles) * 100) / 100 : 0;

        return summary;
    }

    /**
     * Get current statistics
     * @returns {Object} Current statistics
     */
    getStatistics() {
        return {
            ...this.stats,
            averageFileSize: Math.round(this.stats.averageFileSize * 100) / 100,
            largestFileProcessed: Math.round(this.stats.largestFileProcessed * 100) / 100,
            totalSizeProcessed: Math.round(this.stats.totalSizeProcessed * 100) / 100
        };
    }

    /**
     * Reset statistics
     */
    resetStatistics() {
        this.stats = {
            filesAnalyzed: 0,
            categoryCounts: {
                small: 0,
                medium: 0,
                large: 0,
                extraLarge: 0,
                huge: 0
            },
            averageFileSize: 0,
            largestFileProcessed: 0,
            totalSizeProcessed: 0
        };
    }

    /**
     * Check if file exists and is accessible
     * @param {string} filePath - Path to check
     * @returns {boolean} File accessibility
     */
    async isFileAccessible(filePath) {
        try {
            await fs.access(filePath, fs.constants.R_OK);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get processing strategy for a specific category
     * @param {string} category - File category
     * @returns {Object} Processing strategy
     */
    getProcessingStrategy(category) {
        return this.config.processingStrategies[category] || this.config.processingStrategies.medium;
    }
}

export default FileSizeDetector;