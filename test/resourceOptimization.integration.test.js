import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

import OptimizedPdfProcessor from '../src/services/optimizedPdfProcessor.js';

describe('Resource Optimization Integration Test', () => {
    let processor;
    let testTempDir;
    let testFiles = [];

    beforeAll(async () => {
        testTempDir = path.join(os.tmpdir(), 'test-pdf-optimization');
        await fs.mkdir(testTempDir, { recursive: true });

        // Initialize processor with higher memory limits for testing
        processor = new OptimizedPdfProcessor({
            maxConcurrentJobs: 2,
            maxMemoryUsageMB: 4096, // Higher limit for testing
            largeFileThresholdMB: 10,
            tempDir: testTempDir
        });

        await processor.initialize();
    });

    afterAll(async () => {
        if (processor) {
            await processor.shutdown();
        }

        // Cleanup test files
        for (const filePath of testFiles) {
            try {
                await fs.unlink(filePath);
            } catch (error) {
                // File might already be deleted
            }
        }

        try {
            await fs.rmdir(testTempDir, { recursive: true });
        } catch (error) {
            // Directory might not exist
        }
    });

    // Helper function to create test files
    async function createTestFile(fileName, sizeMB = 1) {
        const filePath = path.join(testTempDir, fileName);
        const content = 'x'.repeat(sizeMB * 1024 * 1024);
        await fs.writeFile(filePath, content);
        testFiles.push(filePath);
        return filePath;
    }

    test('should process small PDF with resource optimization', async () => {
        const testFile = await createTestFile('small_test.pdf', 2);
        
        const result = await processor.processPdf({
            filePath: testFile,
            userId: 'test-user-1',
            options: { extractText: true }
        });

        expect(result.success).toBe(true);
        expect(result.jobId).toBeDefined();
        expect(result.fileAnalysis).toBeDefined();
        expect(result.fileAnalysis.category).toBe('small');
        expect(result.result.processingType).toBe('small-file-optimized');
    });

    test('should handle medium PDF with standard processing', async () => {
        const testFile = await createTestFile('medium_test.pdf', 8);
        
        const result = await processor.processPdf({
            filePath: testFile,
            userId: 'test-user-2',
            options: { extractText: true, extractImages: true }
        });

        expect(result.success).toBe(true);
        expect(result.fileAnalysis.category).toBe('medium');
        expect(result.result.processingType).toBe('medium-file-standard');
    });

    test('should detect and handle large files appropriately', async () => {
        const testFile = await createTestFile('large_test.pdf', 15);
        
        const result = await processor.processPdf({
            filePath: testFile,
            userId: 'test-user-3',
            options: { extractText: true }
        });

        expect(result.success).toBe(true);
        expect(result.fileAnalysis.category).toBe('large');
        expect(result.result.processingType).toBe('large-file-chunked');
        expect(result.result.optimizations).toContain('memory-optimized');
    });

    test('should provide queue status information', () => {
        const queueStatus = processor.getQueueStatus();
        
        expect(queueStatus).toBeDefined();
        expect(typeof queueStatus.activeJobs).toBe('number');
        expect(typeof queueStatus.waitingQueue).toBe('number');
        expect(typeof queueStatus.utilization).toBe('number');
        expect(queueStatus.memoryStatus).toBeDefined();
    });

    test('should provide comprehensive statistics', () => {
        const stats = processor.getStatistics();
        
        expect(stats.processing).toBeDefined();
        expect(stats.system).toBeDefined();
        expect(stats.performance).toBeDefined();
        
        expect(typeof stats.processing.totalProcessed).toBe('number');
        expect(typeof stats.processing.successfulProcessed).toBe('number');
        expect(stats.processing.totalProcessed).toBeGreaterThan(0);
    });

    test('should force system optimization', async () => {
        const result = await processor.forceOptimization();
        
        expect(result).toBeDefined();
        expect(typeof result.filesRemoved).toBe('number');
        expect(typeof result.bytesFreed).toBe('number');
    });

    test('should handle file analysis correctly', async () => {
        // Test different file sizes
        const smallFile = await createTestFile('analysis_small.pdf', 1);
        const mediumFile = await createTestFile('analysis_medium.pdf', 15);
        const largeFile = await createTestFile('analysis_large.pdf', 30);

        const results = await Promise.all([
            processor.processPdf({ filePath: smallFile, userId: 'user1' }),
            processor.processPdf({ filePath: mediumFile, userId: 'user2' }),
            processor.processPdf({ filePath: largeFile, userId: 'user3' })
        ]);

        expect(results[0].fileAnalysis.category).toBe('small');
        expect(results[1].fileAnalysis.category).toBe('medium');
        expect(results[2].fileAnalysis.category).toBe('large');

        // Verify processing strategies are different
        expect(results[0].result.processingType).toBe('small-file-optimized');
        expect(results[1].result.processingType).toBe('medium-file-standard');
        expect(results[2].result.processingType).toBe('large-file-chunked');
    });

    test('should handle processing errors gracefully', async () => {
        // Test with non-existent file
        await expect(processor.processPdf({
            filePath: '/non/existent/file.pdf',
            userId: 'test-user-error'
        })).rejects.toThrow();

        // Statistics should still be valid
        const stats = processor.getStatistics();
        expect(stats.processing.failedProcessed).toBeGreaterThan(0);
    });

    test('should demonstrate memory optimization features', async () => {
        const initialStats = processor.getStatistics();
        
        // Create a file that would trigger memory optimization
        const testFile = await createTestFile('memory_test.pdf', 5);
        
        const result = await processor.processPdf({
            filePath: testFile,
            userId: 'memory-test-user'
        });

        expect(result.success).toBe(true);
        
        // Check that memory monitoring is active
        const systemStatus = processor.getStatistics().system;
        expect(systemStatus.memory).toBeDefined();
        expect(systemStatus.memory.currentUsage).toBeDefined();
        expect(systemStatus.cleanup).toBeDefined();
    });
});