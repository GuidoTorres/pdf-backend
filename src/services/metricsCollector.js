/**
 * System Metrics Collector for Production Monitoring
 * Collects CPU, memory, disk, and application metrics
 * 
 * Requirements: 7.1, 7.2
 */

import os from 'os';
import fs from 'fs/promises';
import { performance } from 'perf_hooks';
import { createServer } from 'http';
import { URL } from 'url';

class MetricsCollector {
  constructor(options = {}) {
    this.port = options.port || 9090;
    this.collectInterval = options.collectInterval || 10000; // 10 seconds
    this.retentionPeriod = options.retentionPeriod || 24 * 60 * 60 * 1000; // 24 hours
    
    this.metrics = {
      system: new Map(),
      application: new Map(),
      processes: new Map(),
      queues: new Map()
    };
    
    this.server = null;
    this.collectTimer = null;
    this.startTime = Date.now();
  }

  async start() {
    console.log('📊 Starting metrics collector...');
    
    // Start metrics collection
    this.startCollection();
    
    // Start metrics server
    await this.startServer();
    
    console.log(`✅ Metrics collector started on port ${this.port}`);
  }

  async stop() {
    console.log('🛑 Stopping metrics collector...');
    
    if (this.collectTimer) {
      clearInterval(this.collectTimer);
    }
    
    if (this.server) {
      this.server.close();
    }
    
    console.log('✅ Metrics collector stopped');
  }

  startCollection() {
    // Collect initial metrics
    this.collectMetrics();
    
    // Set up periodic collection
    this.collectTimer = setInterval(() => {
      this.collectMetrics();
      this.cleanupOldMetrics();
    }, this.collectInterval);
  }

  async collectMetrics() {
    const timestamp = Date.now();
    
    try {
      // System metrics
      const systemMetrics = await this.collectSystemMetrics();
      this.metrics.system.set(timestamp, systemMetrics);
      
      // Application metrics
      const appMetrics = await this.collectApplicationMetrics();
      this.metrics.application.set(timestamp, appMetrics);
      
      // Process metrics
      const processMetrics = await this.collectProcessMetrics();
      this.metrics.processes.set(timestamp, processMetrics);
      
      // Queue metrics (if available)
      const queueMetrics = await this.collectQueueMetrics();
      this.metrics.queues.set(timestamp, queueMetrics);
      
    } catch (error) {
      console.error('Error collecting metrics:', error);
    }
  }

  async collectSystemMetrics() {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    
    // CPU usage calculation
    const cpuUsage = await this.getCpuUsage();
    
    // Disk usage
    const diskUsage = await this.getDiskUsage();
    
    // Network stats
    const networkStats = os.networkInterfaces();
    
    return {
      timestamp: Date.now(),
      uptime: os.uptime(),
      loadavg: os.loadavg(),
      
      // CPU metrics
      cpu: {
        count: cpus.length,
        model: cpus[0]?.model || 'unknown',
        usage: cpuUsage,
        loadAverage: {
          '1m': os.loadavg()[0],
          '5m': os.loadavg()[1],
          '15m': os.loadavg()[2]
        }
      },
      
      // Memory metrics
      memory: {
        total: totalMem,
        free: freeMem,
        used: usedMem,
        usagePercent: (usedMem / totalMem) * 100,
        available: freeMem
      },
      
      // Disk metrics
      disk: diskUsage,
      
      // Network interfaces count
      network: {
        interfaces: Object.keys(networkStats).length
      }
    };
  }

  async collectApplicationMetrics() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    return {
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      
      // Process memory
      memory: {
        rss: memUsage.rss,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
        external: memUsage.external,
        arrayBuffers: memUsage.arrayBuffers
      },
      
      // Process CPU
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      
      // Event loop metrics
      eventLoop: {
        delay: await this.getEventLoopDelay(),
        utilization: await this.getEventLoopUtilization()
      },
      
      // Garbage collection stats
      gc: this.getGCStats()
    };
  }

  async collectProcessMetrics() {
    // This would collect metrics from child processes
    // For now, return basic info
    return {
      timestamp: Date.now(),
      pid: process.pid,
      ppid: process.ppid,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      
      // Environment info
      env: {
        nodeEnv: process.env.NODE_ENV,
        port: process.env.PORT
      }
    };
  }

  async collectQueueMetrics() {
    try {
      // Try to get queue metrics from priority queue manager
      const { default: priorityQueueManager } = await import('./priorityQueueManager.js');
      return await priorityQueueManager.getQueueStats();
    } catch (error) {
      return {
        timestamp: Date.now(),
        error: 'Queue metrics not available'
      };
    }
  }

  async getCpuUsage() {
    return new Promise((resolve) => {
      const startUsage = process.cpuUsage();
      const startTime = performance.now();
      
      setTimeout(() => {
        const endUsage = process.cpuUsage(startUsage);
        const endTime = performance.now();
        const timeDiff = endTime - startTime;
        
        const userPercent = (endUsage.user / 1000) / timeDiff * 100;
        const systemPercent = (endUsage.system / 1000) / timeDiff * 100;
        
        resolve({
          user: Math.min(100, Math.max(0, userPercent)),
          system: Math.min(100, Math.max(0, systemPercent)),
          total: Math.min(100, Math.max(0, userPercent + systemPercent))
        });
      }, 100);
    });
  }

  async getDiskUsage() {
    try {
      const stats = await fs.stat('.');
      // This is a simplified disk usage - in production you'd want more detailed stats
      return {
        available: true,
        path: process.cwd()
      };
    } catch (error) {
      return {
        available: false,
        error: error.message
      };
    }
  }

  async getEventLoopDelay() {
    return new Promise((resolve) => {
      const start = performance.now();
      setImmediate(() => {
        const delay = performance.now() - start;
        resolve(delay);
      });
    });
  }

  async getEventLoopUtilization() {
    try {
      const { performance } = await import('perf_hooks');
      if (performance.eventLoopUtilization) {
        return performance.eventLoopUtilization();
      }
    } catch (error) {
      // Fallback for older Node versions
    }
    return { idle: 0, active: 0, utilization: 0 };
  }

  getGCStats() {
    try {
      if (performance.measureUserAgentSpecificMemory) {
        return {
          available: true,
          // Would include GC stats if available
        };
      }
    } catch (error) {
      // GC stats not available
    }
    return { available: false };
  }

  cleanupOldMetrics() {
    const cutoff = Date.now() - this.retentionPeriod;
    
    for (const [category, metricsMap] of Object.entries(this.metrics)) {
      if (metricsMap instanceof Map) {
        for (const [timestamp] of metricsMap) {
          if (timestamp < cutoff) {
            metricsMap.delete(timestamp);
          }
        }
      }
    }
  }

  async startServer() {
    this.server = createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      
      // Enable CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }
      
      if (req.method !== 'GET') {
        res.writeHead(405);
        res.end('Method Not Allowed');
        return;
      }
      
      try {
        switch (url.pathname) {
          case '/metrics':
            this.handleMetricsRequest(req, res);
            break;
          case '/health':
            this.handleHealthRequest(req, res);
            break;
          case '/system':
            this.handleSystemRequest(req, res);
            break;
          case '/application':
            this.handleApplicationRequest(req, res);
            break;
          default:
            this.handleIndexRequest(req, res);
        }
      } catch (error) {
        console.error('Error handling metrics request:', error);
        res.writeHead(500);
        res.end('Internal Server Error');
      }
    });
    
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  handleMetricsRequest(req, res) {
    const latest = this.getLatestMetrics();
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(latest, null, 2));
  }

  handleHealthRequest(req, res) {
    const health = this.getSystemHealth();
    const statusCode = health.status === 'healthy' ? 200 : 503;
    
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health, null, 2));
  }

  handleSystemRequest(req, res) {
    const systemMetrics = Array.from(this.metrics.system.entries())
      .slice(-100) // Last 100 entries
      .map(([timestamp, data]) => ({ timestamp, ...data }));
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(systemMetrics, null, 2));
  }

  handleApplicationRequest(req, res) {
    const appMetrics = Array.from(this.metrics.application.entries())
      .slice(-100) // Last 100 entries
      .map(([timestamp, data]) => ({ timestamp, ...data }));
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(appMetrics, null, 2));
  }

  handleIndexRequest(req, res) {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>PDF Processing System - Metrics</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .metric-card { border: 1px solid #ddd; padding: 20px; margin: 10px 0; border-radius: 5px; }
        .healthy { border-left: 5px solid #4CAF50; }
        .warning { border-left: 5px solid #FF9800; }
        .error { border-left: 5px solid #F44336; }
        pre { background: #f5f5f5; padding: 10px; border-radius: 3px; overflow-x: auto; }
    </style>
</head>
<body>
    <h1>📊 PDF Processing System Metrics</h1>
    
    <div class="metric-card">
        <h2>Available Endpoints</h2>
        <ul>
            <li><a href="/metrics">/metrics</a> - All current metrics (JSON)</li>
            <li><a href="/health">/health</a> - System health status</li>
            <li><a href="/system">/system</a> - System metrics history</li>
            <li><a href="/application">/application</a> - Application metrics history</li>
        </ul>
    </div>
    
    <div class="metric-card">
        <h2>System Status</h2>
        <div id="status">Loading...</div>
    </div>
    
    <script>
        fetch('/health')
            .then(r => r.json())
            .then(data => {
                const statusDiv = document.getElementById('status');
                statusDiv.innerHTML = '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
                statusDiv.className = data.status === 'healthy' ? 'healthy' : 
                                    data.status === 'warning' ? 'warning' : 'error';
            })
            .catch(e => {
                document.getElementById('status').innerHTML = 'Error loading status: ' + e.message;
            });
    </script>
</body>
</html>`;
    
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  getLatestMetrics() {
    const latest = {};
    
    for (const [category, metricsMap] of Object.entries(this.metrics)) {
      if (metricsMap instanceof Map && metricsMap.size > 0) {
        const timestamps = Array.from(metricsMap.keys()).sort((a, b) => b - a);
        const latestTimestamp = timestamps[0];
        latest[category] = metricsMap.get(latestTimestamp);
      }
    }
    
    return {
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      ...latest
    };
  }

  getSystemHealth() {
    const latest = this.getLatestMetrics();
    const issues = [];
    let status = 'healthy';
    
    // Check system metrics
    if (latest.system) {
      if (latest.system.memory.usagePercent > 85) {
        issues.push('high_memory_usage');
        status = 'warning';
      }
      
      if (latest.system.cpu.usage.total > 80) {
        issues.push('high_cpu_usage');
        status = 'warning';
      }
      
      if (latest.system.loadavg[0] > os.cpus().length * 2) {
        issues.push('high_load_average');
        status = 'error';
      }
    }
    
    // Check application metrics
    if (latest.application) {
      if (latest.application.memory.heapUsed > latest.application.memory.heapTotal * 0.9) {
        issues.push('heap_memory_pressure');
        status = 'warning';
      }
      
      if (latest.application.eventLoop.delay > 100) {
        issues.push('event_loop_delay');
        status = 'warning';
      }
    }
    
    return {
      status,
      issues,
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      metrics: latest
    };
  }

  // Prometheus-style metrics export
  getPrometheusMetrics() {
    const latest = this.getLatestMetrics();
    let output = '';
    
    if (latest.system) {
      output += `# HELP system_memory_usage_percent System memory usage percentage\n`;
      output += `# TYPE system_memory_usage_percent gauge\n`;
      output += `system_memory_usage_percent ${latest.system.memory.usagePercent}\n\n`;
      
      output += `# HELP system_cpu_usage_percent System CPU usage percentage\n`;
      output += `# TYPE system_cpu_usage_percent gauge\n`;
      output += `system_cpu_usage_percent ${latest.system.cpu.usage.total}\n\n`;
      
      output += `# HELP system_load_average System load average (1m)\n`;
      output += `# TYPE system_load_average gauge\n`;
      output += `system_load_average ${latest.system.loadavg[0]}\n\n`;
    }
    
    if (latest.application) {
      output += `# HELP app_memory_heap_used Application heap memory used\n`;
      output += `# TYPE app_memory_heap_used gauge\n`;
      output += `app_memory_heap_used ${latest.application.memory.heapUsed}\n\n`;
      
      output += `# HELP app_event_loop_delay Application event loop delay\n`;
      output += `# TYPE app_event_loop_delay gauge\n`;
      output += `app_event_loop_delay ${latest.application.eventLoop.delay}\n\n`;
    }
    
    return output;
  }
}

export { MetricsCollector };
export default MetricsCollector;