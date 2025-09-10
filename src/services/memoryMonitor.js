import EventEmitter from 'events';
import os from 'os';
import { performance } from 'perf_hooks';

/**
 * MemoryMonitor - Advanced memory monitoring and alerting system
 * Provides detailed memory analytics and proactive memory management
 */
class MemoryMonitor extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            checkInterval: config.checkInterval || 3000, // 3 seconds
            alertThresholds: {
                warning: config.warningThreshold || 0.75, // 75%
                critical: config.criticalThreshold || 0.85, // 85%
                emergency: config.emergencyThreshold || 0.95 // 95%
            },
            historySize: config.historySize || 100, // Keep last 100 readings
            gcThreshold: config.gcThreshold || 0.8, // Trigger GC at 80%
            ...config
        };

        this.isMonitoring = false;
        this.monitorInterval = null;
        this.memoryHistory = [];
        this.alertHistory = [];
        this.lastGCTime = Date.now();
        
        // Current state
        this.currentState = {
            level: 'normal', // normal, warning, critical, emergency
            usage: 0,
            trend: 'stable', // increasing, decreasing, stable
            lastAlert: null
        };

        // Statistics
        this.stats = {
            totalChecks: 0,
            alertsTriggered: 0,
            gcTriggered: 0,
            peakUsage: 0,
            averageUsage: 0,
            uptimeStart: Date.now()
        };
    }

    /**
     * Start memory monitoring
     */
    start() {
        if (this.isMonitoring) {
            console.warn('MemoryMonitor already running');
            return;
        }

        this.isMonitoring = true;
        this.stats.uptimeStart = Date.now();
        
        console.log('Starting MemoryMonitor with config:', {
            checkInterval: this.config.checkInterval,
            thresholds: this.config.alertThresholds
        });

        this.monitorInterval = setInterval(() => {
            this.performMemoryCheck();
        }, this.config.checkInterval);

        // Initial check
        this.performMemoryCheck();
        
        this.emit('monitor-started');
    }

    /**
     * Stop memory monitoring
     */
    stop() {
        if (!this.isMonitoring) return;

        this.isMonitoring = false;
        
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }

        console.log('MemoryMonitor stopped');
        this.emit('monitor-stopped');
    }

    /**
     * Perform a single memory check
     */
    async performMemoryCheck() {
        try {
            const memoryData = await this.collectMemoryData();
            this.updateHistory(memoryData);
            this.analyzeMemoryTrend();
            this.checkAlertConditions(memoryData);
            this.updateStatistics(memoryData);
            
            // Trigger garbage collection if needed
            if (this.shouldTriggerGC(memoryData)) {
                this.triggerGarbageCollection();
            }

            this.emit('memory-data', memoryData);
            
        } catch (error) {
            console.error('Memory check failed:', error);
            this.emit('monitor-error', error);
        }
    }

    /**
     * Collect comprehensive memory data
     * @returns {Object} Memory data object
     */
    async collectMemoryData() {
        const processMemory = process.memoryUsage();
        const systemMemory = {
            total: os.totalmem(),
            free: os.freemem(),
            used: os.totalmem() - os.freemem()
        };

        // Convert to MB for easier handling
        const data = {
            timestamp: Date.now(),
            process: {
                rss: Math.round(processMemory.rss / 1024 / 1024), // MB
                heapUsed: Math.round(processMemory.heapUsed / 1024 / 1024),
                heapTotal: Math.round(processMemory.heapTotal / 1024 / 1024),
                external: Math.round(processMemory.external / 1024 / 1024),
                arrayBuffers: Math.round(processMemory.arrayBuffers / 1024 / 1024)
            },
            system: {
                total: Math.round(systemMemory.total / 1024 / 1024),
                free: Math.round(systemMemory.free / 1024 / 1024),
                used: Math.round(systemMemory.used / 1024 / 1024),
                usagePercent: (systemMemory.used / systemMemory.total)
            },
            loadAverage: os.loadavg(),
            uptime: process.uptime()
        };

        // Calculate primary usage metric (system memory percentage)
        data.primaryUsage = data.system.usagePercent;
        data.primaryUsageMB = data.system.used;

        return data;
    }

    /**
     * Update memory history and maintain size limit
     * @param {Object} memoryData - Current memory data
     */
    updateHistory(memoryData) {
        this.memoryHistory.push(memoryData);
        
        // Maintain history size
        if (this.memoryHistory.length > this.config.historySize) {
            this.memoryHistory.shift();
        }

        this.stats.totalChecks++;
    }

    /**
     * Analyze memory usage trend
     */
    analyzeMemoryTrend() {
        if (this.memoryHistory.length < 5) {
            this.currentState.trend = 'stable';
            return;
        }

        const recent = this.memoryHistory.slice(-5);
        const older = this.memoryHistory.slice(-10, -5);
        
        if (older.length === 0) {
            this.currentState.trend = 'stable';
            return;
        }

        const recentAvg = recent.reduce((sum, data) => sum + data.primaryUsage, 0) / recent.length;
        const olderAvg = older.reduce((sum, data) => sum + data.primaryUsage, 0) / older.length;
        
        const difference = recentAvg - olderAvg;
        
        if (difference > 0.05) { // 5% increase
            this.currentState.trend = 'increasing';
        } else if (difference < -0.05) { // 5% decrease
            this.currentState.trend = 'decreasing';
        } else {
            this.currentState.trend = 'stable';
        }
    }

    /**
     * Check alert conditions and trigger alerts if needed
     * @param {Object} memoryData - Current memory data
     */
    checkAlertConditions(memoryData) {
        const usage = memoryData.primaryUsage;
        const thresholds = this.config.alertThresholds;
        
        let newLevel = 'normal';
        
        if (usage >= thresholds.emergency) {
            newLevel = 'emergency';
        } else if (usage >= thresholds.critical) {
            newLevel = 'critical';
        } else if (usage >= thresholds.warning) {
            newLevel = 'warning';
        }

        // Only trigger alert if level changed or if it's been a while since last alert
        const levelChanged = newLevel !== this.currentState.level;
        const timeSinceLastAlert = Date.now() - (this.currentState.lastAlert || 0);
        const shouldRepeatAlert = timeSinceLastAlert > 60000; // 1 minute

        if (levelChanged || (newLevel !== 'normal' && shouldRepeatAlert)) {
            this.triggerAlert(newLevel, memoryData);
        }

        this.currentState.level = newLevel;
        this.currentState.usage = usage;
    }

    /**
     * Trigger memory alert
     * @param {string} level - Alert level
     * @param {Object} memoryData - Current memory data
     */
    triggerAlert(level, memoryData) {
        const alert = {
            level,
            timestamp: Date.now(),
            usage: memoryData.primaryUsage,
            usageMB: memoryData.primaryUsageMB,
            trend: this.currentState.trend,
            processMemory: memoryData.process,
            systemMemory: memoryData.system,
            message: this.generateAlertMessage(level, memoryData)
        };

        this.alertHistory.push(alert);
        this.currentState.lastAlert = Date.now();
        this.stats.alertsTriggered++;

        // Maintain alert history size
        if (this.alertHistory.length > 50) {
            this.alertHistory.shift();
        }

        console.warn(`MEMORY ALERT [${level.toUpperCase()}]:`, alert.message);
        this.emit('memory-alert', alert);

        // Take automatic actions based on alert level
        this.handleAlertActions(level, memoryData);
    }

    /**
     * Generate alert message
     * @param {string} level - Alert level
     * @param {Object} memoryData - Memory data
     * @returns {string} Alert message
     */
    generateAlertMessage(level, memoryData) {
        const usage = (memoryData.primaryUsage * 100).toFixed(1);
        const usageMB = memoryData.primaryUsageMB;
        const totalMB = memoryData.system.total;
        
        const messages = {
            warning: `Memory usage at ${usage}% (${usageMB}MB/${totalMB}MB) - Monitor closely`,
            critical: `Memory usage at ${usage}% (${usageMB}MB/${totalMB}MB) - Consider reducing load`,
            emergency: `Memory usage at ${usage}% (${usageMB}MB/${totalMB}MB) - IMMEDIATE ACTION REQUIRED`
        };

        return messages[level] || `Memory usage: ${usage}%`;
    }

    /**
     * Handle automatic actions based on alert level
     * @param {string} level - Alert level
     * @param {Object} memoryData - Memory data
     */
    handleAlertActions(level, memoryData) {
        switch (level) {
            case 'warning':
                // Suggest garbage collection
                this.emit('memory-action', { 
                    action: 'suggest-gc', 
                    level, 
                    data: memoryData 
                });
                break;
                
            case 'critical':
                // Force garbage collection and suggest pausing new jobs
                this.triggerGarbageCollection();
                this.emit('memory-action', { 
                    action: 'pause-new-jobs', 
                    level, 
                    data: memoryData 
                });
                break;
                
            case 'emergency':
                // Force GC and emergency job pause
                this.triggerGarbageCollection();
                this.emit('memory-action', { 
                    action: 'emergency-pause', 
                    level, 
                    data: memoryData 
                });
                break;
        }
    }

    /**
     * Check if garbage collection should be triggered
     * @param {Object} memoryData - Memory data
     * @returns {boolean} Should trigger GC
     */
    shouldTriggerGC(memoryData) {
        const timeSinceLastGC = Date.now() - this.lastGCTime;
        const usage = memoryData.primaryUsage;
        
        // Trigger GC if:
        // 1. Usage above GC threshold AND at least 30 seconds since last GC
        // 2. OR usage is critical and at least 10 seconds since last GC
        return (usage >= this.config.gcThreshold && timeSinceLastGC > 30000) ||
               (usage >= this.config.alertThresholds.critical && timeSinceLastGC > 10000);
    }

    /**
     * Trigger garbage collection
     */
    triggerGarbageCollection() {
        try {
            if (global.gc) {
                const beforeGC = process.memoryUsage();
                global.gc();
                const afterGC = process.memoryUsage();
                
                this.lastGCTime = Date.now();
                this.stats.gcTriggered++;
                
                const memoryFreed = (beforeGC.heapUsed - afterGC.heapUsed) / 1024 / 1024;
                
                console.log(`Garbage collection completed. Memory freed: ${memoryFreed.toFixed(2)}MB`);
                this.emit('gc-completed', { 
                    memoryFreed, 
                    before: beforeGC, 
                    after: afterGC 
                });
            } else {
                console.warn('Garbage collection not available. Start with --expose-gc flag.');
            }
        } catch (error) {
            console.error('Garbage collection failed:', error);
        }
    }

    /**
     * Update statistics
     * @param {Object} memoryData - Memory data
     */
    updateStatistics(memoryData) {
        const usage = memoryData.primaryUsage;
        
        // Update peak usage
        if (usage > this.stats.peakUsage) {
            this.stats.peakUsage = usage;
        }

        // Update average usage
        this.stats.averageUsage = (this.stats.averageUsage * (this.stats.totalChecks - 1) + usage) / this.stats.totalChecks;
    }

    /**
     * Get current memory status
     * @returns {Object} Current status
     */
    getStatus() {
        const latestData = this.memoryHistory[this.memoryHistory.length - 1];
        
        return {
            isMonitoring: this.isMonitoring,
            currentState: this.currentState,
            latestReading: latestData,
            stats: {
                ...this.stats,
                uptime: Date.now() - this.stats.uptimeStart,
                historySize: this.memoryHistory.length,
                recentAlerts: this.alertHistory.slice(-5)
            }
        };
    }

    /**
     * Get memory history for analysis
     * @param {number} limit - Number of recent entries to return
     * @returns {Array} Memory history
     */
    getHistory(limit = 50) {
        return this.memoryHistory.slice(-limit);
    }

    /**
     * Get alert history
     * @param {number} limit - Number of recent alerts to return
     * @returns {Array} Alert history
     */
    getAlertHistory(limit = 20) {
        return this.alertHistory.slice(-limit);
    }

    /**
     * Force a memory check (useful for testing)
     * @returns {Object} Memory data
     */
    async forceCheck() {
        const memoryData = await this.collectMemoryData();
        this.updateHistory(memoryData);
        this.analyzeMemoryTrend();
        this.checkAlertConditions(memoryData);
        this.updateStatistics(memoryData);
        
        return memoryData;
    }

    /**
     * Reset statistics and history
     */
    reset() {
        this.memoryHistory = [];
        this.alertHistory = [];
        this.stats = {
            totalChecks: 0,
            alertsTriggered: 0,
            gcTriggered: 0,
            peakUsage: 0,
            averageUsage: 0,
            uptimeStart: Date.now()
        };
        this.currentState = {
            level: 'normal',
            usage: 0,
            trend: 'stable',
            lastAlert: null
        };
        
        console.log('MemoryMonitor reset completed');
        this.emit('monitor-reset');
    }
}

export default MemoryMonitor;