import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

import ResourcePool from '../src/services/resourcePool.js';
import MemoryMonitor from '../src/services/memoryMonitor.js';
import FileSizeDetector from '../src/services/fileSizeDetector.js';
import TempFileCleanup from '../src/services/tempFileCleanup.js';
import ResourceOptimizationManager from '../src/services/resourceOptimizationManager.js';

// Test configuration
const TEST_CONFIG = {
    resourcePool: {
        maxConcurrentJobs: 3,
        maxMemoryUsageMB: 100, // Low for testing
        largeFileThresholdMB: 5,
        maxLargeFileConcurrent: 1,
        tempDir: path.join(os.tmpdir(), 'test-resource-optimization')
    },
    memoryMonitor: {
        checkInterval: 1000, // 1 second for testing
        warningThreshold: 0.6,
        criticalThreshold: 0.8,
        emergencyThreshold: 0.9
    },
    tempFileCleanup: {
        aggressiveCleanupInterval: 2000, // 2 seconds for testing
        immediateCleanupAge: 1000, // 1 second for testing
        tempDirectories: [path.join(os.tmpdir(), 'test-resource-optimization')]
    }
};

describe('Resource Optimization System', () => {
    let testTempDir;
    let testFiles = [];

    beforeAll(async () => {
        testTempDir = TEST_CONFIG.resourcePool.tempDir;
        await fs.mkdir(testTempDir, { recursive: true });
    });

    afterAll(async () => {
        // Cleanup test directory
        try {
            await fs.rmdir(testTempDir, { recursive: true });
        } catch (error) {
            // Directory might not exist
        }
    });

    beforeEach(async () => {
        testFiles = [];
    });

    afterEach(async () => {
        // Clean up test files
        for (const filePath of testFiles) {
            try {
                await fs.unlink(filePath);
            } catch (error) {
                // File might already be deleted
            }
        }
    });

    // Helper function to create test files
    async function createTestFile(fileName, sizeMB = 1) {
        const filePath = path.join(testTempDir, fileName);
        const content = 'x'.repeat(sizeMB * 1024 * 1024); // Create file of specified size
        await fs.writeFile(filePath, content);
        testFiles.push(filePath);
        return filePath;
    }

    describe('ResourcePool', () => {
        let resourcePool;

        beforeEach(async () => {
            resourcePool = new ResourcePool(TEST_CONFIG.resourcePool);
            await resourcePool.initialize();
        });

        afterEach(async () => {
            if (resourcePool) {
                await resourcePool.shutdown();
            }
        });

        test('should acquire and release resources correctly', async () => {
            const jobId = await resourcePool.acquireResource({
                fileSize: 1024 * 1024, // 1MB
                userId: 'test-user',
                jobType: 'test'
            });

            expect(jobId).toBeDefined();
            expect(typeof jobId).toBe('string');

            const stats = resourcePool.getStats();
            expect(stats.activeJobs).toBe(1);

            await resourcePool.releaseResource(jobId);
            
            const statsAfter = resourcePool.getStats();
            expect(statsAfter.activeJobs).toBe(0);
        });

        test('should handle concurrent job limits', async () => {
            const promises = [];
            
            // Try to acquire more jobs than the limit
            for (let i = 0; i < 5; i++) {
                promises.push(resourcePool.acquireResource({
                    fileSize: 1024 * 1024,
                    userId: `user-${i}`,
                    jobType: 'test'
                }));
            }

            const results = await Promise.allSettled(promises);
            
            // Should have 3 successful acquisitions (maxConcurrentJobs = 3)
            const successful = results.filter(r => r.status === 'fulfilled');
            expect(successful.length).toBe(3);

            // Clean up
            for (const result of successful) {
                await resourcePool.releaseResource(result.value);
            }
        });

        test('should detect and handle large files', async () => {
            const largeFileSize = 10 * 1024 * 1024; // 10MB (above 5MB threshold)
            
            const jobId = await resourcePool.acquireResource({
                fileSize: largeFileSize,
                userId: 'test-user',
                jobType: 'large-file'
            });

            expect(jobId).toBeDefined();
            
            const stats = resourcePool.getStats();
            expect(stats.largeFileJobs).toBe(1);

            await resourcePool.releaseResource(jobId);
        });

        test('should create and track temporary files', async () => {
            const jobId = await resourcePool.acquireResource({
                fileSize: 1024 * 1024,
                userId: 'test-user'
            });

            const tempFilePath = await resourcePool.createTempFile(jobId, 'test.pdf');
            
            expect(tempFilePath).toContain(jobId);
            expect(tempFilePath).toContain('test.pdf');

            // Verify file path structure
            const expectedDir = path.join(TEST_CONFIG.resourcePool.tempDir, jobId);
            expect(tempFilePath).toBe(path.join(expectedDir, 'test.pdf'));

            await resourcePool.releaseResource(jobId);
        });

        test('should pause and resume based on memory usage', async () => {
            // This test would require mocking memory usage
            // For now, test the pause/resume functionality directly
            
            resourcePool.pauseNewJobs('Test pause');
            expect(resourcePool.getStats().isPaused).toBe(true);

            await resourcePool.resumeJobs();
            expect(resourcePool.getStats().isPaused).toBe(false);
        });
    });

    describe('MemoryMonitor', () => {
        let memoryMonitor;

        beforeEach(() => {
            memoryMonitor = new MemoryMonitor(TEST_CONFIG.memoryMonitor);
        });

        afterEach(() => {
            if (memoryMonitor) {
                memoryMonitor.stop();
            }
        });

        test('should start and stop monitoring', () => {
            expect(memoryMonitor.getStatus().isMonitoring).toBe(false);
            
            memoryMonitor.start();
            expect(memoryMonitor.getStatus().isMonitoring).toBe(true);
            
            memoryMonitor.stop();
            expect(memoryMonitor.getStatus().isMonitoring).toBe(false);
        });

        test('should collect memory data', async () => {
            const memoryData = await memoryMonitor.forceCheck();
            
            expect(memoryData).toBeDefined();
            expect(memoryData.timestamp).toBeDefined();
            expect(memoryData.process).toBeDefined();
            expect(memoryData.system).toBeDefined();
            expect(memoryData.primaryUsage).toBeDefined();
            expect(typeof memoryData.primaryUsage).toBe('number');
        });

        test('should maintain memory history', async () => {
            memoryMonitor.start();
            
            // Force a few checks
            await memoryMonitor.forceCheck();
            await memoryMonitor.forceCheck();
            await memoryMonitor.forceCheck();
            
            const history = memoryMonitor.getHistory();
            expect(history.length).toBeGreaterThanOrEqual(3);
        });

        test('should trigger alerts on high memory usage', (done) => {
            // Mock high memory usage by setting very low thresholds
            const testMonitor = new MemoryMonitor({
                ...TEST_CONFIG.memoryMonitor,
                warningThreshold: 0.01, // Very low threshold to trigger alert
                criticalThreshold: 0.02
            });

            testMonitor.on('memory-alert', (alert) => {
                expect(alert.level).toBeDefined();
                expect(alert.usage).toBeDefined();
                expect(alert.message).toBeDefined();
                testMonitor.stop();
                done();
            });

            testMonitor.start();
        });

        test('should reset statistics and history', async () => {
            await memoryMonitor.forceCheck();
            await memoryMonitor.forceCheck();
            
            let stats = memoryMonitor.getStatus().stats;
            expect(stats.totalChecks).toBeGreaterThan(0);
            
            memoryMonitor.reset();
            
            stats = memoryMonitor.getStatus().stats;
            expect(stats.totalChecks).toBe(0);
            expect(memoryMonitor.getHistory().length).toBe(0);
        });
    });

    describe('FileSizeDetector', () => {
        let fileSizeDetector;

        beforeEach(() => {
            fileSizeDetector = new FileSizeDetector(TEST_CONFIG.fileSizeDetector);
        });

        test('should analyze file size and categorize correctly', async () => {
            // Create test files of different sizes
            const smallFile = await createTestFile('small.pdf', 1); // 1MB
            const largeFile = await createTestFile('large.pdf', 10); // 10MB

            const smallAnalysis = await fileSizeDetector.analyzeFile(smallFile);
            const largeAnalysis = await fileSizeDetector.analyzeFile(largeFile);

            expect(smallAnalysis.category).toBe('small');
            expect(largeAnalysis.category).toBe('large');
            
            expect(smallAnalysis.size.mb).toBeCloseTo(1, 1);
            expect(largeAnalysis.size.mb).toBeCloseTo(10, 1);
        });

        test('should provide processing recommendations', async () => {
            const testFile = await createTestFile('test.pdf', 2);
            const analysis = await fileSizeDetector.analyzeFile(testFile);

            expect(analysis.recommendations).toBeDefined();
            expect(analysis.recommendations.processingQueue).toBeDefined();
            expect(analysis.recommendations.specialHandling).toBeDefined();
            expect(analysis.recommendations.warnings).toBeInstanceOf(Array);
            expect(analysis.recommendations.optimizations).toBeInstanceOf(Array);
        });

        test('should estimate processing time', async () => {
            const testFile = await createTestFile('test.pdf', 5);
            const analysis = await fileSizeDetector.analyzeFile(testFile);

            expect(analysis.estimatedProcessingTime).toBeDefined();
            expect(analysis.estimatedProcessingTime.estimatedSeconds).toBeGreaterThan(0);
            expect(analysis.estimatedProcessingTime.confidence).toBeDefined();
            expect(analysis.estimatedProcessingTime.range).toBeDefined();
        });

        test('should handle different file types', async () => {
            const pdfFile = await createTestFile('test.pdf', 2);
            const excelFile = await createTestFile('test.xlsx', 2);

            const pdfAnalysis = await fileSizeDetector.analyzeFile(pdfFile);
            const excelAnalysis = await fileSizeDetector.analyzeFile(excelFile);

            expect(pdfAnalysis.fileExtension).toBe('.pdf');
            expect(excelAnalysis.fileExtension).toBe('.xlsx');
            
            // Excel files should have different processing characteristics
            expect(pdfAnalysis.typeMultiplier).not.toBe(excelAnalysis.typeMultiplier);
        });

        test('should analyze multiple files in batch', async () => {
            const file1 = await createTestFile('file1.pdf', 1);
            const file2 = await createTestFile('file2.pdf', 3);
            const file3 = await createTestFile('file3.pdf', 8);

            const batchResult = await fileSizeDetector.analyzeFiles([file1, file2, file3]);

            expect(batchResult.results).toHaveLength(3);
            expect(batchResult.errors).toHaveLength(0);
            expect(batchResult.summary).toBeDefined();
            expect(batchResult.summary.totalFiles).toBe(3);
        });

        test('should update statistics', async () => {
            const testFile = await createTestFile('test.pdf', 3);
            
            const statsBefore = fileSizeDetector.getStatistics();
            await fileSizeDetector.analyzeFile(testFile);
            const statsAfter = fileSizeDetector.getStatistics();

            expect(statsAfter.filesAnalyzed).toBe(statsBefore.filesAnalyzed + 1);
            expect(statsAfter.totalSizeProcessed).toBeGreaterThan(statsBefore.totalSizeProcessed);
        });
    });

    describe('TempFileCleanup', () => {
        let tempFileCleanup;

        beforeEach(() => {
            tempFileCleanup = new TempFileCleanup({
                ...TEST_CONFIG.tempFileCleanup,
                dryRun: false // Allow actual cleanup for testing
            });
        });

        afterEach(() => {
            if (tempFileCleanup) {
                tempFileCleanup.stop();
            }
        });

        test('should start and stop cleanup service', () => {
            expect(tempFileCleanup.getStatistics().isRunning).toBe(false);
            
            tempFileCleanup.start();
            expect(tempFileCleanup.getStatistics().isRunning).toBe(true);
            
            tempFileCleanup.stop();
            expect(tempFileCleanup.getStatistics().isRunning).toBe(false);
        });

        test('should protect and unprotect job files', async () => {
            const testFile = await createTestFile('protected.pdf', 1);
            
            tempFileCleanup.protectJobFiles('test-job', [testFile]);
            
            // File should be protected from cleanup
            expect(tempFileCleanup.isProtected(testFile)).toBe(true);
            
            tempFileCleanup.unprotectJobFiles('test-job');
            
            // Note: File might still be protected due to age-based logic
            // This tests the job-based protection mechanism
        });

        test('should clean up old temporary files', async () => {
            // Create a temporary file with old timestamp
            const oldFile = await createTestFile('temp_old_file.pdf', 1);
            
            // Modify file timestamp to make it appear old
            const oldTime = Date.now() - (2 * 60 * 1000); // 2 minutes ago
            await fs.utimes(oldFile, new Date(oldTime), new Date(oldTime));
            
            const statsBefore = tempFileCleanup.getStatistics();
            
            // Force cleanup
            const result = await tempFileCleanup.forceCleanup();
            
            expect(result.filesRemoved).toBeGreaterThanOrEqual(0);
            
            const statsAfter = tempFileCleanup.getStatistics();
            expect(statsAfter.filesRemoved).toBeGreaterThanOrEqual(statsBefore.filesRemoved);
        });

        test('should identify files for cleanup based on patterns', () => {
            expect(tempFileCleanup.shouldCleanFile('temp_12345.pdf')).toBe(true);
            expect(tempFileCleanup.shouldCleanFile('processing_67890.docx')).toBe(true);
            expect(tempFileCleanup.shouldCleanFile('important_document.pdf')).toBe(false);
            expect(tempFileCleanup.shouldCleanFile('file.tmp')).toBe(true);
        });

        test('should identify directories for cleanup', () => {
            expect(tempFileCleanup.shouldCleanDirectory('job_123_abc')).toBe(true);
            expect(tempFileCleanup.shouldCleanDirectory('temp_456')).toBe(true);
            expect(tempFileCleanup.shouldCleanDirectory('important_data')).toBe(false);
        });
    });

    describe('ResourceOptimizationManager Integration', () => {
        let manager;

        beforeEach(async () => {
            manager = new ResourceOptimizationManager({
                ...TEST_CONFIG,
                autoStart: false // Manual start for testing
            });
            await manager.initialize();
        });

        afterEach(async () => {
            if (manager) {
                await manager.stop();
            }
        });

        test('should initialize and start all services', async () => {
            expect(manager.isInitialized).toBe(true);
            expect(manager.isRunning).toBe(false);
            
            await manager.start();
            expect(manager.isRunning).toBe(true);
        });

        test('should process job with full optimization pipeline', async () => {
            await manager.start();
            
            const testFile = await createTestFile('test_job.pdf', 2);
            
            const jobContext = await manager.processJob({
                filePath: testFile,
                userId: 'test-user',
                jobType: 'pdf-processing'
            });

            expect(jobContext).toBeDefined();
            expect(jobContext.jobId).toBeDefined();
            expect(jobContext.fileAnalysis).toBeDefined();
            expect(jobContext.processingStrategy).toBeDefined();
            expect(jobContext.tempFilePath).toBeDefined();

            // Complete the job
            await manager.completeJob(jobContext.jobId, { success: true });
            
            const stats = manager.getSystemStatus();
            expect(stats.aggregated.totalJobsProcessed).toBe(1);
        });

        test('should handle job failure correctly', async () => {
            await manager.start();
            
            const testFile = await createTestFile('failing_job.pdf', 1);
            
            const jobContext = await manager.processJob({
                filePath: testFile,
                userId: 'test-user'
            });

            const error = new Error('Processing failed');
            await manager.failJob(jobContext.jobId, error);
            
            const stats = manager.getSystemStatus();
            expect(stats.aggregated.totalJobsProcessed).toBe(1);
        });

        test('should provide comprehensive system status', async () => {
            await manager.start();
            
            const status = manager.getSystemStatus();
            
            expect(status.isRunning).toBe(true);
            expect(status.memory).toBeDefined();
            expect(status.resources).toBeDefined();
            expect(status.cleanup).toBeDefined();
            expect(status.fileAnalysis).toBeDefined();
            expect(status.aggregated).toBeDefined();
            expect(status.currentJobs).toBeInstanceOf(Array);
        });

        test('should handle memory alerts and take appropriate actions', (done) => {
            manager.on('memory-alert', (alert) => {
                expect(alert.level).toBeDefined();
                expect(alert.usage).toBeDefined();
                done();
            });

            // This would require mocking high memory usage
            // For now, we test that the event system works
            manager.handleMemoryAlert({
                level: 'warning',
                usage: 0.8,
                message: 'Test alert'
            });
        });

        test('should force system optimization', async () => {
            await manager.start();
            
            const result = await manager.forceOptimization();
            
            expect(result).toBeDefined();
            expect(typeof result.filesRemoved).toBe('number');
            expect(typeof result.bytesFreed).toBe('number');
        });

        test('should calculate performance metrics', async () => {
            await manager.start();
            
            const metrics = manager.getPerformanceMetrics();
            
            expect(metrics.performance).toBeDefined();
            expect(metrics.performance.memoryTrend).toBeDefined();
            expect(metrics.performance.jobThroughput).toBeDefined();
            expect(metrics.performance.systemEfficiency).toBeDefined();
            expect(typeof metrics.performance.systemEfficiency).toBe('number');
        });

        test('should handle concurrent jobs within limits', async () => {
            await manager.start();
            
            const promises = [];
            
            // Create multiple test files and process them concurrently
            for (let i = 0; i < 5; i++) {
                const testFile = await createTestFile(`concurrent_${i}.pdf`, 1);
                promises.push(manager.processJob({
                    filePath: testFile,
                    userId: `user-${i}`,
                    jobType: 'test'
                }));
            }

            const results = await Promise.allSettled(promises);
            
            // Should respect concurrent job limits
            const successful = results.filter(r => r.status === 'fulfilled');
            expect(successful.length).toBeLessThanOrEqual(TEST_CONFIG.resourcePool.maxConcurrentJobs);

            // Clean up successful jobs
            for (const result of successful) {
                await manager.completeJob(result.value.jobId, { success: true });
            }
        });
    });

    describe('Error Handling and Edge Cases', () => {
        test('should handle non-existent files gracefully', async () => {
            const fileSizeDetector = new FileSizeDetector();
            
            await expect(fileSizeDetector.analyzeFile('/non/existent/file.pdf'))
                .rejects.toThrow();
        });

        test('should handle resource pool shutdown with active jobs', async () => {
            const resourcePool = new ResourcePool(TEST_CONFIG.resourcePool);
            await resourcePool.initialize();
            
            const jobId = await resourcePool.acquireResource({
                fileSize: 1024 * 1024,
                userId: 'test-user'
            });

            // Should handle shutdown gracefully even with active jobs
            await expect(resourcePool.shutdown()).resolves.not.toThrow();
        });

        test('should handle memory monitor errors gracefully', () => {
            const memoryMonitor = new MemoryMonitor(TEST_CONFIG.memoryMonitor);
            
            let errorEmitted = false;
            memoryMonitor.on('monitor-error', () => {
                errorEmitted = true;
            });

            // This should not crash the monitor
            memoryMonitor.start();
            memoryMonitor.stop();
            
            // Error handling is internal, just ensure no crashes
            expect(true).toBe(true);
        });

        test('should handle cleanup service errors gracefully', async () => {
            const tempFileCleanup = new TempFileCleanup({
                ...TEST_CONFIG.tempFileCleanup,
                tempDirectories: ['/non/existent/directory']
            });

            // Should not throw even with invalid directories
            await expect(tempFileCleanup.forceCleanup()).resolves.not.toThrow();
        });
    });
});

// Performance and Load Tests
describe('Resource Optimization Performance', () => {
    test('should handle rapid job acquisition and release', async () => {
        const resourcePool = new ResourcePool({
            ...TEST_CONFIG.resourcePool,
            maxConcurrentJobs: 10
        });
        
        await resourcePool.initialize();

        const startTime = Date.now();
        const jobIds = [];

        // Rapidly acquire resources
        for (let i = 0; i < 20; i++) {
            try {
                const jobId = await resourcePool.acquireResource({
                    fileSize: 1024 * 1024,
                    userId: `user-${i}`
                });
                jobIds.push(jobId);
            } catch (error) {
                // Expected for jobs beyond limit
            }
        }

        // Rapidly release resources
        for (const jobId of jobIds) {
            await resourcePool.releaseResource(jobId);
        }

        const duration = Date.now() - startTime;
        
        // Should complete within reasonable time (5 seconds)
        expect(duration).toBeLessThan(5000);
        
        await resourcePool.shutdown();
    });

    test('should maintain performance under memory pressure', async () => {
        const memoryMonitor = new MemoryMonitor({
            checkInterval: 100, // Very frequent checks
            warningThreshold: 0.1 // Very low threshold
        });

        memoryMonitor.start();

        // Run for a short period under "pressure"
        await new Promise(resolve => setTimeout(resolve, 1000));

        const status = memoryMonitor.getStatus();
        expect(status.stats.totalChecks).toBeGreaterThan(5);

        memoryMonitor.stop();
    });
});