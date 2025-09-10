#!/usr/bin/env node

/**
 * Production startup script for PDF Processing System
 * Launches complete cluster with API server and multiple workers
 * Includes health checks, auto-restart, and structured logging
 * 
 * Requirements: 5.5, 6.2, 6.3, 7.1, 7.2
 */

import { spawn, fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import os from 'os';
import cluster from 'cluster';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Production configuration
const PRODUCTION_CONFIG = {
  // Process management
  maxRestarts: 5,
  restartDelay: 5000,
  healthCheckInterval: 30000,
  
  // Cluster configuration
  minWorkers: parseInt(process.env.MIN_WORKERS) || 5,
  maxWorkers: parseInt(process.env.MAX_WORKERS) || Math.min(15, os.cpus().length * 2),
  
  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
  logDir: process.env.LOG_DIR || path.join(__dirname, '../logs'),
  
  // Monitoring
  metricsPort: parseInt(process.env.METRICS_PORT) || 9090,
  healthCheckPort: parseInt(process.env.HEALTH_CHECK_PORT) || 8080,
  
  // System limits
  maxMemoryMB: parseInt(process.env.MAX_MEMORY_MB) || 2048,
  maxCpuPercent: parseInt(process.env.MAX_CPU_PERCENT) || 80
};

class ProductionManager {
  constructor() {
    this.processes = new Map();
    this.restartCounts = new Map();
    this.isShuttingDown = false;
    this.startTime = Date.now();
    this.healthCheckServer = null;
    this.metricsCollector = null;
    
    this.setupSignalHandlers();
    this.setupLogging();
  }

  async start() {
    try {
      console.log(`🚀 Starting PDF Processing System v${packageJson.version}`);
      console.log(`📊 Configuration:`, {
        minWorkers: PRODUCTION_CONFIG.minWorkers,
        maxWorkers: PRODUCTION_CONFIG.maxWorkers,
        logLevel: PRODUCTION_CONFIG.logLevel,
        environment: process.env.NODE_ENV || 'production'
      });

      // Ensure log directory exists
      await this.ensureLogDirectory();
      
      // Start health check server
      await this.startHealthCheckServer();
      
      // Start metrics collector
      await this.startMetricsCollector();
      
      // Start main API server
      await this.startApiServer();
      
      // Start initial worker cluster
      await this.startWorkerCluster();
      
      // Start monitoring
      this.startMonitoring();
      
      console.log('✅ Production system started successfully!');
      console.log(`🔍 Health checks available at: http://localhost:${PRODUCTION_CONFIG.healthCheckPort}/health`);
      console.log(`📈 Metrics available at: http://localhost:${PRODUCTION_CONFIG.metricsPort}/metrics`);
      
    } catch (error) {
      console.error('❌ Failed to start production system:', error);
      process.exit(1);
    }
  }

  async ensureLogDirectory() {
    try {
      await fs.mkdir(PRODUCTION_CONFIG.logDir, { recursive: true });
      console.log(`📁 Log directory ready: ${PRODUCTION_CONFIG.logDir}`);
    } catch (error) {
      console.error('Failed to create log directory:', error);
      throw error;
    }
  }

  async startApiServer() {
    console.log('📡 Starting API server...');
    
    const apiProcess = spawn('node', ['src/app.js'], {
      cwd: path.join(__dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: 'production',
        LOG_LEVEL: PRODUCTION_CONFIG.logLevel,
        CLUSTER_MODE: 'true'
      }
    });

    this.processes.set('api-server', {
      process: apiProcess,
      type: 'api',
      startTime: Date.now(),
      restarts: 0
    });

    this.setupProcessLogging(apiProcess, 'API');
    this.setupProcessMonitoring(apiProcess, 'api-server');
    
    // Wait for API server to be ready
    await this.waitForApiReady();
    console.log('✅ API server started');
  }

  async startWorkerCluster() {
    console.log(`⚙️  Starting worker cluster (${PRODUCTION_CONFIG.minWorkers} workers)...`);
    
    for (let i = 0; i < PRODUCTION_CONFIG.minWorkers; i++) {
      await this.startWorker(i);
    }
    
    console.log(`✅ Worker cluster started with ${PRODUCTION_CONFIG.minWorkers} workers`);
  }

  async startWorker(workerId) {
    const workerProcess = spawn('node', ['src/workers/pdfProcessor.js'], {
      cwd: path.join(__dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: 'production',
        WORKER_ID: `worker-${workerId}`,
        LOG_LEVEL: PRODUCTION_CONFIG.logLevel,
        CLUSTER_MODE: 'true'
      }
    });

    const processKey = `worker-${workerId}`;
    this.processes.set(processKey, {
      process: workerProcess,
      type: 'worker',
      workerId,
      startTime: Date.now(),
      restarts: 0
    });

    this.setupProcessLogging(workerProcess, `WORKER-${workerId}`);
    this.setupProcessMonitoring(workerProcess, processKey);
    
    return workerProcess;
  }

  setupProcessLogging(process, prefix) {
    const logFile = path.join(PRODUCTION_CONFIG.logDir, `${prefix.toLowerCase()}.log`);
    const errorLogFile = path.join(PRODUCTION_CONFIG.logDir, `${prefix.toLowerCase()}-error.log`);
    
    // Structured logging with timestamps
    process.stdout.on('data', (data) => {
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] [${prefix}] ${data.toString().trim()}\n`;
      
      console.log(logEntry.trim());
      this.appendToLogFile(logFile, logEntry);
    });

    process.stderr.on('data', (data) => {
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] [${prefix}] ERROR: ${data.toString().trim()}\n`;
      
      console.error(logEntry.trim());
      this.appendToLogFile(errorLogFile, logEntry);
    });
  }

  async appendToLogFile(filePath, data) {
    try {
      await fs.appendFile(filePath, data);
    } catch (error) {
      console.error(`Failed to write to log file ${filePath}:`, error);
    }
  }

  setupProcessMonitoring(process, processKey) {
    const processInfo = this.processes.get(processKey);
    
    process.on('exit', async (code, signal) => {
      if (this.isShuttingDown) return;
      
      console.log(`⚠️  Process ${processKey} exited with code ${code} (signal: ${signal})`);
      
      const restartCount = this.restartCounts.get(processKey) || 0;
      
      if (restartCount < PRODUCTION_CONFIG.maxRestarts) {
        console.log(`🔄 Restarting ${processKey} (attempt ${restartCount + 1}/${PRODUCTION_CONFIG.maxRestarts})`);
        
        this.restartCounts.set(processKey, restartCount + 1);
        
        setTimeout(async () => {
          await this.restartProcess(processKey);
        }, PRODUCTION_CONFIG.restartDelay);
      } else {
        console.error(`❌ Process ${processKey} exceeded max restart attempts`);
        this.processes.delete(processKey);
      }
    });

    process.on('error', (error) => {
      console.error(`❌ Process ${processKey} error:`, error);
    });
  }

  async restartProcess(processKey) {
    try {
      const processInfo = this.processes.get(processKey);
      if (!processInfo) return;

      if (processInfo.type === 'api') {
        await this.startApiServer();
      } else if (processInfo.type === 'worker') {
        await this.startWorker(processInfo.workerId);
      }
      
      console.log(`✅ Process ${processKey} restarted successfully`);
      
      // Reset restart count on successful restart
      setTimeout(() => {
        this.restartCounts.set(processKey, 0);
      }, 60000); // Reset after 1 minute of stable operation
      
    } catch (error) {
      console.error(`Failed to restart process ${processKey}:`, error);
    }
  }

  async startHealthCheckServer() {
    const express = (await import('express')).default;
    const app = express();
    
    app.use(express.json());
    
    // Health check endpoint
    app.get('/health', (req, res) => {
      const health = this.getSystemHealth();
      const statusCode = health.status === 'healthy' ? 200 : 503;
      res.status(statusCode).json(health);
    });
    
    // Detailed status endpoint
    app.get('/status', (req, res) => {
      res.json(this.getDetailedStatus());
    });
    
    // Process management endpoints
    app.post('/restart/:processKey', async (req, res) => {
      try {
        await this.restartProcess(req.params.processKey);
        res.json({ success: true, message: `Process ${req.params.processKey} restart initiated` });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    this.healthCheckServer = app.listen(PRODUCTION_CONFIG.healthCheckPort, () => {
      console.log(`🏥 Health check server started on port ${PRODUCTION_CONFIG.healthCheckPort}`);
    });
  }

  async startMetricsCollector() {
    // Import metrics collector
    const { MetricsCollector } = await import('../src/services/metricsCollector.js');
    this.metricsCollector = new MetricsCollector();
    
    // Start metrics collection
    await this.metricsCollector.start();
    
    console.log(`📊 Metrics collector started on port ${PRODUCTION_CONFIG.metricsPort}`);
  }

  startMonitoring() {
    // System health monitoring
    setInterval(() => {
      this.performHealthChecks();
    }, PRODUCTION_CONFIG.healthCheckInterval);
    
    // Resource monitoring
    setInterval(() => {
      this.monitorSystemResources();
    }, 10000); // Every 10 seconds
    
    console.log('🔍 System monitoring started');
  }

  async performHealthChecks() {
    const health = this.getSystemHealth();
    
    if (health.status !== 'healthy') {
      console.warn('⚠️  System health check failed:', health);
      
      // Take corrective actions
      if (health.issues.includes('high_memory')) {
        await this.handleHighMemoryUsage();
      }
      
      if (health.issues.includes('high_cpu')) {
        await this.handleHighCpuUsage();
      }
      
      if (health.issues.includes('failed_processes')) {
        await this.handleFailedProcesses();
      }
    }
  }

  getSystemHealth() {
    const uptime = Date.now() - this.startTime;
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    const issues = [];
    let status = 'healthy';
    
    // Check memory usage
    const memoryUsageMB = memoryUsage.rss / 1024 / 1024;
    if (memoryUsageMB > PRODUCTION_CONFIG.maxMemoryMB) {
      issues.push('high_memory');
      status = 'unhealthy';
    }
    
    // Check process health
    const aliveProcesses = Array.from(this.processes.values()).filter(p => !p.process.killed);
    const totalProcesses = this.processes.size;
    
    if (aliveProcesses.length < totalProcesses * 0.8) {
      issues.push('failed_processes');
      status = 'degraded';
    }
    
    return {
      status,
      uptime: Math.floor(uptime / 1000),
      processes: {
        total: totalProcesses,
        alive: aliveProcesses.length,
        failed: totalProcesses - aliveProcesses.length
      },
      memory: {
        used: Math.round(memoryUsageMB),
        limit: PRODUCTION_CONFIG.maxMemoryMB,
        percentage: Math.round((memoryUsageMB / PRODUCTION_CONFIG.maxMemoryMB) * 100)
      },
      issues,
      timestamp: new Date().toISOString()
    };
  }

  getDetailedStatus() {
    const processes = {};
    
    for (const [key, info] of this.processes.entries()) {
      processes[key] = {
        pid: info.process.pid,
        type: info.type,
        uptime: Math.floor((Date.now() - info.startTime) / 1000),
        restarts: this.restartCounts.get(key) || 0,
        killed: info.process.killed
      };
    }
    
    return {
      system: this.getSystemHealth(),
      processes,
      configuration: PRODUCTION_CONFIG,
      version: packageJson.version
    };
  }

  async waitForApiReady() {
    const maxAttempts = 30;
    const delay = 1000;
    
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(`http://localhost:${process.env.PORT || 3000}/api/dashboard/status`);
        if (response.ok) {
          return;
        }
      } catch (error) {
        // API not ready yet
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    throw new Error('API server failed to start within timeout');
  }

  async handleHighMemoryUsage() {
    console.warn('🚨 High memory usage detected, taking corrective action');
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
    
    // Scale down workers if possible
    const workerProcesses = Array.from(this.processes.entries())
      .filter(([key, info]) => info.type === 'worker');
    
    if (workerProcesses.length > PRODUCTION_CONFIG.minWorkers) {
      const [processKey] = workerProcesses[workerProcesses.length - 1];
      console.log(`🔽 Scaling down worker: ${processKey}`);
      await this.stopProcess(processKey);
    }
  }

  async handleHighCpuUsage() {
    console.warn('🚨 High CPU usage detected');
    // Could implement CPU throttling or worker scaling here
  }

  async handleFailedProcesses() {
    console.warn('🚨 Multiple process failures detected');
    // Could implement emergency restart procedures here
  }

  async stopProcess(processKey) {
    const processInfo = this.processes.get(processKey);
    if (processInfo && !processInfo.process.killed) {
      processInfo.process.kill('SIGTERM');
      this.processes.delete(processKey);
      this.restartCounts.delete(processKey);
    }
  }

  monitorSystemResources() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Log resource usage periodically
    if (PRODUCTION_CONFIG.logLevel === 'debug') {
      console.log('📊 System Resources:', {
        memory: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
        cpu: `${Math.round(cpuUsage.user / 1000)}ms user, ${Math.round(cpuUsage.system / 1000)}ms system`,
        processes: this.processes.size
      });
    }
  }

  setupSignalHandlers() {
    const gracefulShutdown = async (signal) => {
      if (this.isShuttingDown) return;
      
      console.log(`\n🛑 Received ${signal}, initiating graceful shutdown...`);
      this.isShuttingDown = true;
      
      try {
        // Stop health check server
        if (this.healthCheckServer) {
          this.healthCheckServer.close();
        }
        
        // Stop metrics collector
        if (this.metricsCollector) {
          await this.metricsCollector.stop();
        }
        
        // Stop all processes
        const shutdownPromises = [];
        for (const [key, info] of this.processes.entries()) {
          console.log(`Stopping ${key}...`);
          info.process.kill('SIGTERM');
          
          shutdownPromises.push(
            new Promise((resolve) => {
              const timeout = setTimeout(() => {
                console.log(`Force killing ${key}...`);
                info.process.kill('SIGKILL');
                resolve();
              }, 10000);
              
              info.process.on('exit', () => {
                clearTimeout(timeout);
                resolve();
              });
            })
          );
        }
        
        await Promise.all(shutdownPromises);
        
        console.log('✅ Graceful shutdown completed');
        process.exit(0);
        
      } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    };
    
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught Exception:', error);
      gracefulShutdown('UNCAUGHT_EXCEPTION');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
      gracefulShutdown('UNHANDLED_REJECTION');
    });
  }

  setupLogging() {
    // Override console methods for structured logging
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    
    console.log = (...args) => {
      const timestamp = new Date().toISOString();
      originalLog(`[${timestamp}] [INFO]`, ...args);
    };
    
    console.error = (...args) => {
      const timestamp = new Date().toISOString();
      originalError(`[${timestamp}] [ERROR]`, ...args);
    };
    
    console.warn = (...args) => {
      const timestamp = new Date().toISOString();
      originalWarn(`[${timestamp}] [WARN]`, ...args);
    };
  }
}

// Start the production manager
const manager = new ProductionManager();
manager.start().catch((error) => {
  console.error('Failed to start production system:', error);
  process.exit(1);
});