import fs from 'fs/promises';
import path from 'path';
import EventEmitter from 'events';

/**
 * TempFileCleanup - Aggressive temporary file management and cleanup service
 * Ensures no temporary files are left behind and manages disk space efficiently
 */
class TempFileCleanup extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            // Cleanup intervals
            aggressiveCleanupInterval: config.aggressiveCleanupInterval || 30000, // 30 seconds
            deepCleanupInterval: config.deepCleanupInterval || 300000, // 5 minutes
            
            // File age thresholds (in milliseconds)
            immediateCleanupAge: config.immediateCleanupAge || 60000,    // 1 minute
            standardCleanupAge: config.standardCleanupAge || 300000,     // 5 minutes
            deepCleanupAge: config.deepCleanupAge || 1800000,            // 30 minutes
            
            // Directory paths
            tempDirectories: config.tempDirectories || [
                path.join(process.cwd(), 'temp'),
                path.join(process.cwd(), 'uploads'),
                path.join(process.cwd(), 'processing'),
                '/tmp/pdf-processing',
                '/tmp/uploads'
            ],
            
            // File patterns to clean
            cleanupPatterns: config.cleanupPatterns || [
                /^temp_.*\.(pdf|docx|xlsx|pptx|txt|csv|html|xml)$/i,
                /^processing_.*\.(pdf|docx|xlsx|pptx|txt|csv|html|xml)$/i,
                /^upload_.*\.(pdf|docx|xlsx|pptx|txt|csv|html|xml)$/i,
                /^job_.*\.(pdf|docx|xlsx|pptx|txt|csv|html|xml)$/i,
                /\.tmp$/i,
                /\.temp$/i,
                /^\.~.*$/,
                /~$/
            ],
            
            // Directories to clean (by name pattern)
            tempDirPatterns: config.tempDirPatterns || [
                /^job_\d+_[a-z0-9]+$/i,
                /^temp_\d+$/i,
                /^processing_\d+$/i,
                /^upload_\d+$/i
            ],
            
            // Safety settings
            maxFilesPerCleanup: config.maxFilesPerCleanup || 1000,
            maxSizePerCleanup: config.maxSizePerCleanup || 1024 * 1024 * 1024, // 1GB
            dryRun: config.dryRun || false,
            
            ...config
        };

        // Active job tracking (to avoid cleaning files in use)
        this.activeJobs = new Set();
        this.protectedFiles = new Set();
        this.protectedDirectories = new Set();
        
        // Cleanup intervals
        this.aggressiveInterval = null;
        this.deepInterval = null;
        this.isRunning = false;
        
        // Statistics
        this.stats = {
            totalCleanupRuns: 0,
            filesRemoved: 0,
            directoriesRemoved: 0,
            bytesFreed: 0,
            lastCleanupTime: null,
            lastDeepCleanupTime: null,
            errors: 0,
            protectedFilesSkipped: 0
        };
    }

    /**
     * Start the cleanup service
     */
    start() {
        if (this.isRunning) {
            console.warn('TempFileCleanup already running');
            return;
        }

        this.isRunning = true;
        
        console.log('Starting TempFileCleanup service with config:', {
            aggressiveInterval: this.config.aggressiveCleanupInterval,
            deepInterval: this.config.deepCleanupInterval,
            tempDirectories: this.config.tempDirectories.length,
            dryRun: this.config.dryRun
        });

        // Start aggressive cleanup (frequent, light cleanup)
        this.aggressiveInterval = setInterval(() => {
            this.performAggressiveCleanup();
        }, this.config.aggressiveCleanupInterval);

        // Start deep cleanup (less frequent, thorough cleanup)
        this.deepInterval = setInterval(() => {
            this.performDeepCleanup();
        }, this.config.deepCleanupInterval);

        // Perform initial cleanup
        setTimeout(() => this.performAggressiveCleanup(), 5000);
        
        this.emit('cleanup-started');
    }

    /**
     * Stop the cleanup service
     */
    stop() {
        if (!this.isRunning) return;

        this.isRunning = false;
        
        if (this.aggressiveInterval) {
            clearInterval(this.aggressiveInterval);
            this.aggressiveInterval = null;
        }
        
        if (this.deepInterval) {
            clearInterval(this.deepInterval);
            this.deepInterval = null;
        }

        console.log('TempFileCleanup service stopped');
        this.emit('cleanup-stopped');
    }

    /**
     * Register an active job to protect its files
     * @param {string} jobId - Job ID
     * @param {Array} filePaths - Array of file paths to protect
     */
    protectJobFiles(jobId, filePaths = []) {
        this.activeJobs.add(jobId);
        
        filePaths.forEach(filePath => {
            this.protectedFiles.add(path.resolve(filePath));
            
            // Also protect the directory
            const dirPath = path.dirname(filePath);
            this.protectedDirectories.add(dirPath);
        });

        console.log(`Protected ${filePaths.length} files for job ${jobId}`);
    }

    /**
     * Unregister an active job and allow cleanup of its files
     * @param {string} jobId - Job ID
     */
    unprotectJobFiles(jobId) {
        this.activeJobs.delete(jobId);
        
        // Note: We don't remove from protectedFiles immediately
        // as other jobs might be using the same files
        // The cleanup process will handle this with age-based logic
        
        console.log(`Unprotected files for job ${jobId}`);
    }

    /**
     * Perform aggressive cleanup (frequent, targets recent temp files)
     */
    async performAggressiveCleanup() {
        try {
            console.log('Starting aggressive cleanup...');
            
            const cleanupResult = await this.cleanupByAge(this.config.immediateCleanupAge);
            
            this.stats.totalCleanupRuns++;
            this.stats.lastCleanupTime = new Date();
            
            if (cleanupResult.filesRemoved > 0 || cleanupResult.directoriesRemoved > 0) {
                console.log(`Aggressive cleanup completed: ${cleanupResult.filesRemoved} files, ${cleanupResult.directoriesRemoved} directories, ${this.formatBytes(cleanupResult.bytesFreed)} freed`);
            }
            
            this.emit('aggressive-cleanup-completed', cleanupResult);
            
        } catch (error) {
            console.error('Aggressive cleanup failed:', error);
            this.stats.errors++;
            this.emit('cleanup-error', { type: 'aggressive', error });
        }
    }

    /**
     * Perform deep cleanup (less frequent, more thorough)
     */
    async performDeepCleanup() {
        try {
            console.log('Starting deep cleanup...');
            
            const cleanupResult = await this.cleanupByAge(this.config.deepCleanupAge);
            
            // Also clean up empty directories
            const emptyDirResult = await this.cleanupEmptyDirectories();
            
            // Combine results
            const totalResult = {
                filesRemoved: cleanupResult.filesRemoved + emptyDirResult.filesRemoved,
                directoriesRemoved: cleanupResult.directoriesRemoved + emptyDirResult.directoriesRemoved,
                bytesFreed: cleanupResult.bytesFreed + emptyDirResult.bytesFreed,
                errors: cleanupResult.errors + emptyDirResult.errors
            };
            
            this.stats.lastDeepCleanupTime = new Date();
            
            if (totalResult.filesRemoved > 0 || totalResult.directoriesRemoved > 0) {
                console.log(`Deep cleanup completed: ${totalResult.filesRemoved} files, ${totalResult.directoriesRemoved} directories, ${this.formatBytes(totalResult.bytesFreed)} freed`);
            }
            
            this.emit('deep-cleanup-completed', totalResult);
            
        } catch (error) {
            console.error('Deep cleanup failed:', error);
            this.stats.errors++;
            this.emit('cleanup-error', { type: 'deep', error });
        }
    }

    /**
     * Clean up files based on age
     * @param {number} maxAge - Maximum age in milliseconds
     * @returns {Object} Cleanup results
     */
    async cleanupByAge(maxAge) {
        const result = {
            filesRemoved: 0,
            directoriesRemoved: 0,
            bytesFreed: 0,
            errors: 0
        };

        const now = Date.now();
        let totalProcessed = 0;

        for (const tempDir of this.config.tempDirectories) {
            if (totalProcessed >= this.config.maxFilesPerCleanup) break;
            
            try {
                const dirExists = await this.directoryExists(tempDir);
                if (!dirExists) continue;

                const entries = await fs.readdir(tempDir, { withFileTypes: true });
                
                for (const entry of entries) {
                    if (totalProcessed >= this.config.maxFilesPerCleanup) break;
                    
                    const fullPath = path.join(tempDir, entry.name);
                    
                    try {
                        // Skip protected files/directories
                        if (this.isProtected(fullPath)) {
                            this.stats.protectedFilesSkipped++;
                            continue;
                        }

                        const stats = await fs.stat(fullPath);
                        const age = now - stats.mtime.getTime();
                        
                        if (age > maxAge) {
                            if (entry.isDirectory()) {
                                if (this.shouldCleanDirectory(entry.name)) {
                                    const dirResult = await this.removeDirectory(fullPath);
                                    result.directoriesRemoved += dirResult.directoriesRemoved;
                                    result.filesRemoved += dirResult.filesRemoved;
                                    result.bytesFreed += dirResult.bytesFreed;
                                }
                            } else if (entry.isFile()) {
                                if (this.shouldCleanFile(entry.name)) {
                                    const fileSize = stats.size;
                                    await this.removeFile(fullPath);
                                    result.filesRemoved++;
                                    result.bytesFreed += fileSize;
                                }
                            }
                        }
                        
                        totalProcessed++;
                        
                    } catch (error) {
                        result.errors++;
                        console.warn(`Failed to process ${fullPath}:`, error.message);
                    }
                }
                
            } catch (error) {
                result.errors++;
                console.warn(`Failed to process directory ${tempDir}:`, error.message);
            }
        }

        // Update global stats
        this.stats.filesRemoved += result.filesRemoved;
        this.stats.directoriesRemoved += result.directoriesRemoved;
        this.stats.bytesFreed += result.bytesFreed;
        this.stats.errors += result.errors;

        return result;
    }

    /**
     * Clean up empty directories
     * @returns {Object} Cleanup results
     */
    async cleanupEmptyDirectories() {
        const result = {
            filesRemoved: 0,
            directoriesRemoved: 0,
            bytesFreed: 0,
            errors: 0
        };

        for (const tempDir of this.config.tempDirectories) {
            try {
                const dirExists = await this.directoryExists(tempDir);
                if (!dirExists) continue;

                await this.removeEmptyDirectoriesRecursive(tempDir, result);
                
            } catch (error) {
                result.errors++;
                console.warn(`Failed to clean empty directories in ${tempDir}:`, error.message);
            }
        }

        return result;
    }

    /**
     * Recursively remove empty directories
     * @param {string} dirPath - Directory path
     * @param {Object} result - Result object to update
     */
    async removeEmptyDirectoriesRecursive(dirPath, result) {
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            
            // Process subdirectories first
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const subDirPath = path.join(dirPath, entry.name);
                    await this.removeEmptyDirectoriesRecursive(subDirPath, result);
                }
            }
            
            // Check if directory is now empty
            const updatedEntries = await fs.readdir(dirPath);
            if (updatedEntries.length === 0 && !this.isProtected(dirPath)) {
                // Don't remove the main temp directories, only subdirectories
                if (!this.config.tempDirectories.includes(dirPath)) {
                    await this.removeDirectory(dirPath);
                    result.directoriesRemoved++;
                }
            }
            
        } catch (error) {
            result.errors++;
            console.warn(`Failed to process directory ${dirPath}:`, error.message);
        }
    }

    /**
     * Check if a file should be cleaned based on patterns
     * @param {string} fileName - File name
     * @returns {boolean} Should clean
     */
    shouldCleanFile(fileName) {
        return this.config.cleanupPatterns.some(pattern => pattern.test(fileName));
    }

    /**
     * Check if a directory should be cleaned based on patterns
     * @param {string} dirName - Directory name
     * @returns {boolean} Should clean
     */
    shouldCleanDirectory(dirName) {
        return this.config.tempDirPatterns.some(pattern => pattern.test(dirName));
    }

    /**
     * Check if a path is protected from cleanup
     * @param {string} filePath - File path
     * @returns {boolean} Is protected
     */
    isProtected(filePath) {
        const resolvedPath = path.resolve(filePath);
        
        // Check if file is directly protected
        if (this.protectedFiles.has(resolvedPath)) {
            return true;
        }
        
        // Check if directory is protected
        const dirPath = path.dirname(resolvedPath);
        if (this.protectedDirectories.has(dirPath)) {
            return true;
        }
        
        // Check if any parent directory is protected
        for (const protectedDir of this.protectedDirectories) {
            if (resolvedPath.startsWith(protectedDir)) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * Remove a file safely
     * @param {string} filePath - File path
     */
    async removeFile(filePath) {
        if (this.config.dryRun) {
            console.log(`[DRY RUN] Would remove file: ${filePath}`);
            return;
        }
        
        await fs.unlink(filePath);
        console.log(`Removed file: ${filePath}`);
    }

    /**
     * Remove a directory and its contents
     * @param {string} dirPath - Directory path
     * @returns {Object} Removal results
     */
    async removeDirectory(dirPath) {
        const result = {
            filesRemoved: 0,
            directoriesRemoved: 0,
            bytesFreed: 0
        };

        if (this.config.dryRun) {
            console.log(`[DRY RUN] Would remove directory: ${dirPath}`);
            return result;
        }

        try {
            // Calculate size before removal
            const size = await this.calculateDirectorySize(dirPath);
            result.bytesFreed = size.totalSize;
            result.filesRemoved = size.fileCount;
            result.directoriesRemoved = size.dirCount;
            
            await fs.rmdir(dirPath, { recursive: true });
            console.log(`Removed directory: ${dirPath} (${this.formatBytes(size.totalSize)})`);
            
        } catch (error) {
            console.warn(`Failed to remove directory ${dirPath}:`, error.message);
            throw error;
        }

        return result;
    }

    /**
     * Calculate directory size and file count
     * @param {string} dirPath - Directory path
     * @returns {Object} Size information
     */
    async calculateDirectorySize(dirPath) {
        let totalSize = 0;
        let fileCount = 0;
        let dirCount = 1; // Count the directory itself

        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                
                if (entry.isDirectory()) {
                    const subDirSize = await this.calculateDirectorySize(fullPath);
                    totalSize += subDirSize.totalSize;
                    fileCount += subDirSize.fileCount;
                    dirCount += subDirSize.dirCount;
                } else if (entry.isFile()) {
                    const stats = await fs.stat(fullPath);
                    totalSize += stats.size;
                    fileCount++;
                }
            }
        } catch (error) {
            // Directory might have been deleted or is inaccessible
        }

        return { totalSize, fileCount, dirCount };
    }

    /**
     * Check if directory exists
     * @param {string} dirPath - Directory path
     * @returns {boolean} Directory exists
     */
    async directoryExists(dirPath) {
        try {
            const stats = await fs.stat(dirPath);
            return stats.isDirectory();
        } catch {
            return false;
        }
    }

    /**
     * Format bytes for human readability
     * @param {number} bytes - Bytes
     * @returns {string} Formatted string
     */
    formatBytes(bytes) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }

        return `${Math.round(size * 100) / 100} ${units[unitIndex]}`;
    }

    /**
     * Force immediate cleanup of all eligible files
     * @returns {Object} Cleanup results
     */
    async forceCleanup() {
        console.log('Forcing immediate cleanup...');
        
        const aggressiveResult = await this.cleanupByAge(0); // Clean all files
        const emptyDirResult = await this.cleanupEmptyDirectories();
        
        const totalResult = {
            filesRemoved: aggressiveResult.filesRemoved + emptyDirResult.filesRemoved,
            directoriesRemoved: aggressiveResult.directoriesRemoved + emptyDirResult.directoriesRemoved,
            bytesFreed: aggressiveResult.bytesFreed + emptyDirResult.bytesFreed,
            errors: aggressiveResult.errors + emptyDirResult.errors
        };
        
        console.log(`Force cleanup completed: ${totalResult.filesRemoved} files, ${totalResult.directoriesRemoved} directories, ${this.formatBytes(totalResult.bytesFreed)} freed`);
        
        this.emit('force-cleanup-completed', totalResult);
        return totalResult;
    }

    /**
     * Get current statistics
     * @returns {Object} Current statistics
     */
    getStatistics() {
        return {
            ...this.stats,
            isRunning: this.isRunning,
            activeJobs: this.activeJobs.size,
            protectedFiles: this.protectedFiles.size,
            protectedDirectories: this.protectedDirectories.size,
            uptime: this.stats.lastCleanupTime ? Date.now() - this.stats.lastCleanupTime : 0
        };
    }

    /**
     * Reset statistics
     */
    resetStatistics() {
        this.stats = {
            totalCleanupRuns: 0,
            filesRemoved: 0,
            directoriesRemoved: 0,
            bytesFreed: 0,
            lastCleanupTime: null,
            lastDeepCleanupTime: null,
            errors: 0,
            protectedFilesSkipped: 0
        };
    }
}

export default TempFileCleanup;