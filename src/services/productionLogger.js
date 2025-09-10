/**
 * Production Logging Service
 * Structured logging for production debugging and monitoring
 * 
 * Requirements: 6.3, 7.1
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ProductionLogger {
  constructor(options = {}) {
    this.logLevel = options.logLevel || process.env.LOG_LEVEL || 'info';
    this.logDir = options.logDir || process.env.LOG_DIR || path.join(__dirname, '../../logs');
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10MB
    this.maxFiles = options.maxFiles || 10;
    this.enableConsole = options.enableConsole !== false;
    
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
      trace: 4
    };
    
    this.currentLevel = this.levels[this.logLevel] || this.levels.info;
    
    this.logStreams = new Map();
    this.rotationPromises = new Map();
    
    this.init();
  }

  async init() {
    try {
      // Ensure log directory exists
      await fs.mkdir(this.logDir, { recursive: true });
      
      // Initialize log files
      await this.initializeLogFiles();
      
      console.log(`📝 Production logger initialized (level: ${this.logLevel}, dir: ${this.logDir})`);
    } catch (error) {
      console.error('Failed to initialize production logger:', error);
    }
  }

  async initializeLogFiles() {
    const logFiles = [
      'application.log',
      'error.log',
      'access.log',
      'performance.log',
      'security.log'
    ];
    
    for (const logFile of logFiles) {
      const filePath = path.join(this.logDir, logFile);
      
      try {
        // Check if file exists, create if not
        await fs.access(filePath);
      } catch (error) {
        // File doesn't exist, create it
        await fs.writeFile(filePath, '');
      }
    }
  }

  async log(level, message, meta = {}) {
    if (this.levels[level] > this.currentLevel) {
      return; // Skip logging if level is below current threshold
    }
    
    const logEntry = this.formatLogEntry(level, message, meta);
    
    // Console output
    if (this.enableConsole) {
      this.logToConsole(level, logEntry);
    }
    
    // File output
    await this.logToFile(level, logEntry);
  }

  formatLogEntry(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const pid = process.pid;
    const hostname = require('os').hostname();
    
    const entry = {
      timestamp,
      level: level.toUpperCase(),
      pid,
      hostname,
      message,
      ...meta
    };
    
    // Add stack trace for errors
    if (level === 'error' && meta.error instanceof Error) {
      entry.stack = meta.error.stack;
      entry.errorMessage = meta.error.message;
      entry.errorName = meta.error.name;
    }
    
    // Add request context if available
    if (meta.req) {
      entry.request = {
        method: meta.req.method,
        url: meta.req.url,
        userAgent: meta.req.get('User-Agent'),
        ip: meta.req.ip,
        userId: meta.req.user?.id
      };
    }
    
    // Add performance metrics if available
    if (meta.performance) {
      entry.performance = meta.performance;
    }
    
    return entry;
  }

  logToConsole(level, entry) {
    const coloredMessage = this.colorizeMessage(level, JSON.stringify(entry));
    
    switch (level) {
      case 'error':
        console.error(coloredMessage);
        break;
      case 'warn':
        console.warn(coloredMessage);
        break;
      case 'debug':
      case 'trace':
        console.debug(coloredMessage);
        break;
      default:
        console.log(coloredMessage);
    }
  }

  colorizeMessage(level, message) {
    const colors = {
      error: '\x1b[31m', // Red
      warn: '\x1b[33m',  // Yellow
      info: '\x1b[36m',  // Cyan
      debug: '\x1b[35m', // Magenta
      trace: '\x1b[37m'  // White
    };
    
    const reset = '\x1b[0m';
    const color = colors[level] || colors.info;
    
    return `${color}${message}${reset}`;
  }

  async logToFile(level, entry) {
    try {
      const logLine = JSON.stringify(entry) + '\n';
      
      // Determine which file to write to
      let fileName = 'application.log';
      
      if (level === 'error') {
        fileName = 'error.log';
      } else if (entry.request) {
        fileName = 'access.log';
      } else if (entry.performance) {
        fileName = 'performance.log';
      } else if (entry.security) {
        fileName = 'security.log';
      }
      
      const filePath = path.join(this.logDir, fileName);
      
      // Check if file needs rotation
      await this.checkAndRotateFile(filePath);
      
      // Append to file
      await fs.appendFile(filePath, logLine);
      
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  async checkAndRotateFile(filePath) {
    try {
      const stats = await fs.stat(filePath);
      
      if (stats.size > this.maxFileSize) {
        await this.rotateLogFile(filePath);
      }
    } catch (error) {
      // File might not exist yet, ignore
    }
  }

  async rotateLogFile(filePath) {
    const rotationKey = filePath;
    
    // Prevent concurrent rotations of the same file
    if (this.rotationPromises.has(rotationKey)) {
      return this.rotationPromises.get(rotationKey);
    }
    
    const rotationPromise = this.performLogRotation(filePath);
    this.rotationPromises.set(rotationKey, rotationPromise);
    
    try {
      await rotationPromise;
    } finally {
      this.rotationPromises.delete(rotationKey);
    }
  }

  async performLogRotation(filePath) {
    try {
      const dir = path.dirname(filePath);
      const ext = path.extname(filePath);
      const basename = path.basename(filePath, ext);
      
      // Rotate existing files
      for (let i = this.maxFiles - 1; i > 0; i--) {
        const oldFile = path.join(dir, `${basename}.${i}${ext}`);
        const newFile = path.join(dir, `${basename}.${i + 1}${ext}`);
        
        try {
          await fs.access(oldFile);
          if (i === this.maxFiles - 1) {
            // Delete the oldest file
            await fs.unlink(oldFile);
          } else {
            // Rename to next number
            await fs.rename(oldFile, newFile);
          }
        } catch (error) {
          // File doesn't exist, continue
        }
      }
      
      // Move current file to .1
      const rotatedFile = path.join(dir, `${basename}.1${ext}`);
      await fs.rename(filePath, rotatedFile);
      
      // Create new empty file
      await fs.writeFile(filePath, '');
      
      console.log(`📁 Log file rotated: ${filePath}`);
      
    } catch (error) {
      console.error('Failed to rotate log file:', error);
    }
  }

  // Convenience methods
  async error(message, meta = {}) {
    await this.log('error', message, meta);
  }

  async warn(message, meta = {}) {
    await this.log('warn', message, meta);
  }

  async info(message, meta = {}) {
    await this.log('info', message, meta);
  }

  async debug(message, meta = {}) {
    await this.log('debug', message, meta);
  }

  async trace(message, meta = {}) {
    await this.log('trace', message, meta);
  }

  // Request logging middleware
  requestLogger() {
    return (req, res, next) => {
      const start = Date.now();
      
      // Log request start
      this.info('Request started', {
        req,
        method: req.method,
        url: req.url,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });
      
      // Override res.end to log response
      const originalEnd = res.end;
      res.end = (...args) => {
        const duration = Date.now() - start;
        
        this.info('Request completed', {
          req,
          method: req.method,
          url: req.url,
          statusCode: res.statusCode,
          duration,
          performance: {
            responseTime: duration,
            timestamp: new Date().toISOString()
          }
        });
        
        originalEnd.apply(res, args);
      };
      
      next();
    };
  }

  // Error logging middleware
  errorLogger() {
    return (err, req, res, next) => {
      this.error('Request error', {
        error: err,
        req,
        method: req.method,
        url: req.url,
        statusCode: res.statusCode || 500
      });
      
      next(err);
    };
  }

  // Security event logging
  async logSecurityEvent(event, details = {}) {
    await this.log('warn', `Security event: ${event}`, {
      security: true,
      event,
      ...details
    });
  }

  // Performance logging
  async logPerformance(operation, duration, details = {}) {
    await this.log('info', `Performance: ${operation}`, {
      performance: {
        operation,
        duration,
        timestamp: new Date().toISOString(),
        ...details
      }
    });
  }

  // Worker event logging
  async logWorkerEvent(workerId, event, details = {}) {
    await this.log('info', `Worker event: ${event}`, {
      workerId,
      event,
      worker: true,
      ...details
    });
  }

  // Queue event logging
  async logQueueEvent(queueName, event, jobId, details = {}) {
    await this.log('info', `Queue event: ${event}`, {
      queueName,
      jobId,
      event,
      queue: true,
      ...details
    });
  }

  // System event logging
  async logSystemEvent(event, details = {}) {
    await this.log('info', `System event: ${event}`, {
      system: true,
      event,
      ...details
    });
  }

  // Get log statistics
  async getLogStats() {
    try {
      const files = await fs.readdir(this.logDir);
      const logFiles = files.filter(f => f.endsWith('.log'));
      
      const stats = {};
      
      for (const file of logFiles) {
        const filePath = path.join(this.logDir, file);
        const fileStat = await fs.stat(filePath);
        
        stats[file] = {
          size: fileStat.size,
          modified: fileStat.mtime,
          created: fileStat.birthtime
        };
      }
      
      return {
        logDir: this.logDir,
        logLevel: this.logLevel,
        files: stats,
        totalSize: Object.values(stats).reduce((sum, s) => sum + s.size, 0)
      };
    } catch (error) {
      console.error('Failed to get log stats:', error);
      return { error: error.message };
    }
  }

  // Clean up old logs
  async cleanupLogs(olderThanDays = 30) {
    try {
      const files = await fs.readdir(this.logDir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
      
      let deletedCount = 0;
      
      for (const file of files) {
        if (!file.endsWith('.log')) continue;
        
        const filePath = path.join(this.logDir, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime < cutoffDate) {
          await fs.unlink(filePath);
          deletedCount++;
          console.log(`🗑️  Deleted old log file: ${file}`);
        }
      }
      
      return { deletedCount, cutoffDate };
    } catch (error) {
      console.error('Failed to cleanup logs:', error);
      return { error: error.message };
    }
  }
}

// Create singleton instance
const logger = new ProductionLogger();

export default logger;
export { ProductionLogger };