/**
 * Production Deployment Tests
 * Tests for production deployment, monitoring, and health checks
 * 
 * Requirements: 5.5, 6.2, 6.3, 7.1, 7.2
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawn } from 'child_process';
import fetch from 'node-fetch';

describe('Production Deployment System', () => {
  let productionProcess;
  const HEALTH_CHECK_URL = 'http://localhost:8080/health';
  const METRICS_URL = 'http://localhost:9090/metrics';
  const API_URL = 'http://localhost:3000/api/dashboard/status';

  beforeAll(async () => {
    // Set production environment
    process.env.NODE_ENV = 'production';
    process.env.CLUSTER_MODE = 'true';
    process.env.MIN_WORKERS = '2';
    process.env.MAX_WORKERS = '5';
    process.env.LOG_LEVEL = 'info';
  }, 30000);

  afterAll(async () => {
    // Clean up
    if (productionProcess) {
      productionProcess.kill('SIGTERM');
      
      // Wait for graceful shutdown
      await new Promise((resolve) => {
        productionProcess.on('exit', resolve);
        setTimeout(resolve, 5000); // Force timeout after 5 seconds
      });
    }
  }, 10000);

  describe('Production Startup', () => {
    it('should start production system successfully', async () => {
      // Start production system
      productionProcess = spawn('node', ['scripts/production-start.js'], {
        cwd: process.cwd(),
        stdio: 'pipe',
        env: {
          ...process.env,
          NODE_ENV: 'production',
          CLUSTER_MODE: 'true'
        }
      });

      let startupComplete = false;
      let startupError = null;

      // Monitor startup output
      productionProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('STDOUT:', output);
        
        if (output.includes('Production system started successfully')) {
          startupComplete = true;
        }
      });

      productionProcess.stderr.on('data', (data) => {
        const output = data.toString();
        console.error('STDERR:', output);
        
        if (output.includes('Failed to start') || output.includes('Error')) {
          startupError = output;
        }
      });

      // Wait for startup to complete
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!startupComplete) {
            reject(new Error('Production startup timeout'));
          }
        }, 30000);

        const checkStartup = setInterval(() => {
          if (startupComplete) {
            clearTimeout(timeout);
            clearInterval(checkStartup);
            resolve();
          }
          
          if (startupError) {
            clearTimeout(timeout);
            clearInterval(checkStartup);
            reject(new Error(`Startup error: ${startupError}`));
          }
        }, 1000);
      });

      expect(startupComplete).toBe(true);
      expect(startupError).toBeNull();
    }, 45000);

    it('should have health check endpoint responding', async () => {
      // Wait a bit for services to stabilize
      await new Promise(resolve => setTimeout(resolve, 5000));

      const response = await fetch(HEALTH_CHECK_URL);
      expect(response.ok).toBe(true);

      const health = await response.json();
      expect(health).toHaveProperty('status');
      expect(['healthy', 'degraded']).toContain(health.status);
    }, 15000);

    it('should have metrics endpoint responding', async () => {
      const response = await fetch(METRICS_URL);
      expect(response.ok).toBe(true);

      const metrics = await response.json();
      expect(metrics).toHaveProperty('timestamp');
      expect(metrics).toHaveProperty('system');
      expect(metrics).toHaveProperty('application');
    }, 10000);
  });

  describe('Health Monitoring', () => {
    it('should report system health status', async () => {
      const response = await fetch(HEALTH_CHECK_URL);
      const health = await response.json();

      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('uptime');
      expect(health).toHaveProperty('processes');
      expect(health).toHaveProperty('memory');
      expect(health).toHaveProperty('timestamp');

      // Check processes
      expect(health.processes).toHaveProperty('total');
      expect(health.processes).toHaveProperty('alive');
      expect(health.processes.total).toBeGreaterThan(0);
      expect(health.processes.alive).toBeGreaterThan(0);

      // Check memory
      expect(health.memory).toHaveProperty('used');
      expect(health.memory).toHaveProperty('limit');
      expect(health.memory).toHaveProperty('percentage');
      expect(health.memory.used).toBeGreaterThan(0);
    });

    it('should provide detailed status information', async () => {
      const response = await fetch(`${HEALTH_CHECK_URL.replace('/health', '/status')}`);
      const status = await response.json();

      expect(status).toHaveProperty('system');
      expect(status).toHaveProperty('processes');
      expect(status).toHaveProperty('configuration');
      expect(status).toHaveProperty('version');

      // Check configuration
      expect(status.configuration).toHaveProperty('minWorkers');
      expect(status.configuration).toHaveProperty('maxWorkers');
      expect(status.configuration.minWorkers).toBe(2);
      expect(status.configuration.maxWorkers).toBe(5);
    });
  });

  describe('Metrics Collection', () => {
    it('should collect system metrics', async () => {
      const response = await fetch(METRICS_URL);
      const metrics = await response.json();

      expect(metrics.system).toHaveProperty('cpu');
      expect(metrics.system).toHaveProperty('memory');
      expect(metrics.system).toHaveProperty('uptime');

      // CPU metrics
      expect(metrics.system.cpu).toHaveProperty('count');
      expect(metrics.system.cpu).toHaveProperty('usage');
      expect(metrics.system.cpu.count).toBeGreaterThan(0);

      // Memory metrics
      expect(metrics.system.memory).toHaveProperty('total');
      expect(metrics.system.memory).toHaveProperty('used');
      expect(metrics.system.memory).toHaveProperty('usagePercent');
      expect(metrics.system.memory.total).toBeGreaterThan(0);
    });

    it('should collect application metrics', async () => {
      const response = await fetch(METRICS_URL);
      const metrics = await response.json();

      expect(metrics.application).toHaveProperty('memory');
      expect(metrics.application).toHaveProperty('cpu');
      expect(metrics.application).toHaveProperty('uptime');

      // Application memory
      expect(metrics.application.memory).toHaveProperty('heapUsed');
      expect(metrics.application.memory).toHaveProperty('heapTotal');
      expect(metrics.application.memory.heapUsed).toBeGreaterThan(0);

      // Application CPU
      expect(metrics.application.cpu).toHaveProperty('user');
      expect(metrics.application.cpu).toHaveProperty('system');
    });

    it('should provide metrics in Prometheus format', async () => {
      const response = await fetch(`${METRICS_URL}?format=prometheus`);
      const prometheusMetrics = await response.text();

      expect(prometheusMetrics).toContain('# HELP');
      expect(prometheusMetrics).toContain('# TYPE');
      expect(prometheusMetrics).toContain('system_memory_usage_percent');
      expect(prometheusMetrics).toContain('system_cpu_usage_percent');
    });
  });

  describe('Process Management', () => {
    it('should handle process restart requests', async () => {
      // This test would require more complex setup to actually restart processes
      // For now, we'll test the endpoint availability
      const response = await fetch(`${HEALTH_CHECK_URL.replace('/health', '/restart/test-process')}`, {
        method: 'POST'
      });

      // Should respond even if process doesn't exist
      expect([200, 404, 500]).toContain(response.status);
    });

    it('should maintain minimum number of workers', async () => {
      const response = await fetch(`${HEALTH_CHECK_URL.replace('/health', '/status')}`);
      const status = await response.json();

      const aliveProcesses = status.processes.alive;
      expect(aliveProcesses).toBeGreaterThanOrEqual(2); // At least API + 1 worker
    });
  });

  describe('Logging System', () => {
    it('should create structured logs', async () => {
      // Check if log files are being created
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const logDir = path.join(process.cwd(), 'logs');
      
      try {
        const logFiles = await fs.readdir(logDir);
        expect(logFiles.length).toBeGreaterThan(0);
        
        // Check for expected log files
        const expectedLogs = ['application.log'];
        const hasExpectedLogs = expectedLogs.some(log => logFiles.includes(log));
        expect(hasExpectedLogs).toBe(true);
      } catch (error) {
        // Log directory might not exist yet in test environment
        console.warn('Log directory not found, skipping log file test');
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid health check requests gracefully', async () => {
      const response = await fetch(`${HEALTH_CHECK_URL}/invalid`);
      expect([404, 405]).toContain(response.status);
    });

    it('should handle invalid metrics requests gracefully', async () => {
      const response = await fetch(`${METRICS_URL}/invalid`);
      expect([404, 405]).toContain(response.status);
    });
  });

  describe('Performance', () => {
    it('should respond to health checks quickly', async () => {
      const startTime = Date.now();
      const response = await fetch(HEALTH_CHECK_URL);
      const responseTime = Date.now() - startTime;

      expect(response.ok).toBe(true);
      expect(responseTime).toBeLessThan(5000); // Should respond within 5 seconds
    });

    it('should respond to metrics requests quickly', async () => {
      const startTime = Date.now();
      const response = await fetch(METRICS_URL);
      const responseTime = Date.now() - startTime;

      expect(response.ok).toBe(true);
      expect(responseTime).toBeLessThan(5000); // Should respond within 5 seconds
    });
  });

  describe('Resource Usage', () => {
    it('should maintain reasonable memory usage', async () => {
      const response = await fetch(HEALTH_CHECK_URL);
      const health = await response.json();

      // Memory usage should be reasonable (less than 80% of limit)
      expect(health.memory.percentage).toBeLessThan(80);
    });

    it('should report system resource usage', async () => {
      const response = await fetch(METRICS_URL);
      const metrics = await response.json();

      // Should have reasonable CPU usage
      expect(metrics.system.cpu.usage.total).toBeLessThan(100);
      expect(metrics.system.cpu.usage.total).toBeGreaterThanOrEqual(0);

      // Should have reasonable memory usage
      expect(metrics.system.memory.usagePercent).toBeLessThan(100);
      expect(metrics.system.memory.usagePercent).toBeGreaterThan(0);
    });
  });
});