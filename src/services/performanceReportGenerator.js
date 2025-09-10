import { WorkerMetrics, QueueStats, JobMetrics } from '../models/index.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * PerformanceReportGenerator - Automated daily performance report generation
 * 
 * This service generates comprehensive daily performance reports with:
 * - Performance metrics and trends
 * - Optimization recommendations
 * - Capacity planning insights
 * - Error analysis and patterns
 */
class PerformanceReportGenerator {
  constructor(options = {}) {
    this.options = {
      reportDirectory: options.reportDirectory || './reports',
      enableAutoGeneration: options.enableAutoGeneration !== false,
      reportTime: options.reportTime || '06:00', // 6 AM daily
      retentionDays: options.retentionDays || 90,
      includeCharts: options.includeCharts || false,
      ...options
    };
    
    this.isScheduled = false;
    this.scheduledTimeout = null;
    
    this.logger = this.setupLogger();
    
    // Ensure report directory exists
    this.ensureReportDirectory();
    
    // Schedule daily reports if enabled
    if (this.options.enableAutoGeneration) {
      this.scheduleDailyReports();
    }
  }
  
  setupLogger() {
    return {
      info: (msg) => console.log(`[PerformanceReportGenerator] ${msg}`),
      error: (msg) => console.error(`[PerformanceReportGenerator] ${msg}`),
      debug: (msg) => this.options.debug && console.log(`[PerformanceReportGenerator] ${msg}`),
      warn: (msg) => console.warn(`[PerformanceReportGenerator] ${msg}`)
    };
  }
  
  /**
   * Ensure report directory exists
   */
  async ensureReportDirectory() {
    try {
      await fs.mkdir(this.options.reportDirectory, { recursive: true });
    } catch (error) {
      this.logger.error(`Error creating report directory: ${error.message}`);
    }
  }
  
  /**
   * Schedule daily report generation
   */
  scheduleDailyReports() {
    if (this.isScheduled) {
      return;
    }
    
    this.isScheduled = true;
    
    const scheduleNext = () => {
      const now = new Date();
      const [hours, minutes] = this.options.reportTime.split(':').map(Number);
      
      const nextRun = new Date();
      nextRun.setHours(hours, minutes, 0, 0);
      
      // If the time has already passed today, schedule for tomorrow
      if (nextRun <= now) {
        nextRun.setDate(nextRun.getDate() + 1);
      }
      
      const msUntilNext = nextRun.getTime() - now.getTime();
      
      this.scheduledTimeout = setTimeout(async () => {
        try {
          await this.generateDailyReport();
        } catch (error) {
          this.logger.error(`Error generating scheduled daily report: ${error.message}`);
        }
        
        // Schedule the next report
        scheduleNext();
      }, msUntilNext);
      
      this.logger.info(`Next daily report scheduled for ${nextRun.toISOString()}`);
    };
    
    scheduleNext();
  }
  
  /**
   * Stop scheduled report generation
   */
  stopScheduledReports() {
    if (!this.isScheduled) {
      return;
    }
    
    this.isScheduled = false;
    if (this.scheduledTimeout) {
      clearTimeout(this.scheduledTimeout);
      this.scheduledTimeout = null;
    }
    
    this.logger.info('Stopped scheduled daily reports');
  }
  
  /**
   * Generate daily performance report
   */
  async generateDailyReport(date = null) {
    try {
      const reportDate = date || new Date();
      const yesterday = new Date(reportDate);
      yesterday.setDate(yesterday.getDate() - 1);
      
      this.logger.info(`Generating daily report for ${yesterday.toDateString()}`);
      
      // Collect all metrics for the day
      const reportData = await this.collectDailyMetrics(yesterday);
      
      // Generate report content
      const report = await this.generateReportContent(reportData, yesterday);
      
      // Save report to file
      const filename = `daily-report-${yesterday.toISOString().split('T')[0]}.json`;
      const filepath = path.join(this.options.reportDirectory, filename);
      
      await fs.writeFile(filepath, JSON.stringify(report, null, 2));
      
      // Generate HTML report if requested
      if (this.options.generateHtml) {
        const htmlReport = this.generateHtmlReport(report);
        const htmlFilename = `daily-report-${yesterday.toISOString().split('T')[0]}.html`;
        const htmlFilepath = path.join(this.options.reportDirectory, htmlFilename);
        await fs.writeFile(htmlFilepath, htmlReport);
      }
      
      // Clean up old reports
      await this.cleanupOldReports();
      
      this.logger.info(`Daily report generated: ${filename}`);
      
      return report;
      
    } catch (error) {
      this.logger.error(`Error generating daily report: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Collect all metrics for a specific day
   */
  async collectDailyMetrics(date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    
    const [
      jobMetrics,
      workerMetrics,
      queueMetrics,
      hourlyTrends,
      userPlanStats,
      errorAnalysis,
      workerPerformance
    ] = await Promise.all([
      this.getJobMetricsForPeriod(startOfDay, endOfDay),
      this.getWorkerMetricsForPeriod(startOfDay, endOfDay),
      this.getQueueMetricsForPeriod(startOfDay, endOfDay),
      this.getHourlyTrends(startOfDay, endOfDay),
      this.getUserPlanStatsForPeriod(startOfDay, endOfDay),
      this.getErrorAnalysisForPeriod(startOfDay, endOfDay),
      this.getWorkerPerformanceForPeriod(startOfDay, endOfDay)
    ]);
    
    return {
      date,
      period: { start: startOfDay, end: endOfDay },
      jobs: jobMetrics,
      workers: workerMetrics,
      queues: queueMetrics,
      hourlyTrends,
      userPlans: userPlanStats,
      errors: errorAnalysis,
      workerPerformance
    };
  }
  
  /**
   * Get job metrics for a specific period
   */
  async getJobMetricsForPeriod(startDate, endDate) {
    const jobs = await JobMetrics.findAll({
      where: {
        completed_at: {
          [JobMetrics.sequelize.Op.between]: [startDate, endDate]
        }
      }
    });
    
    const completed = jobs.filter(job => job.status === 'completed');
    const failed = jobs.filter(job => job.status === 'failed');
    
    const processingTimes = completed
      .filter(job => job.processing_time)
      .map(job => job.processing_time);
    
    const waitTimes = jobs
      .filter(job => job.wait_time)
      .map(job => job.wait_time);
    
    const memoryUsages = completed
      .filter(job => job.memory_used_mb)
      .map(job => job.memory_used_mb);
    
    return {
      total: jobs.length,
      completed: completed.length,
      failed: failed.length,
      successRate: jobs.length > 0 ? (completed.length / jobs.length) * 100 : 0,
      avgProcessingTime: processingTimes.length > 0 
        ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length 
        : 0,
      medianProcessingTime: this.calculateMedian(processingTimes),
      avgWaitTime: waitTimes.length > 0 
        ? waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length 
        : 0,
      avgMemoryUsage: memoryUsages.length > 0 
        ? memoryUsages.reduce((a, b) => a + b, 0) / memoryUsages.length 
        : 0,
      totalProcessingTime: processingTimes.reduce((a, b) => a + b, 0),
      minProcessingTime: processingTimes.length > 0 ? Math.min(...processingTimes) : 0,
      maxProcessingTime: processingTimes.length > 0 ? Math.max(...processingTimes) : 0,
      p95ProcessingTime: this.calculatePercentile(processingTimes, 95),
      p99ProcessingTime: this.calculatePercentile(processingTimes, 99)
    };
  }
  
  /**
   * Get worker metrics for a specific period
   */
  async getWorkerMetricsForPeriod(startDate, endDate) {
    const metrics = await WorkerMetrics.findAll({
      where: {
        timestamp: {
          [WorkerMetrics.sequelize.Op.between]: [startDate, endDate]
        }
      }
    });
    
    const uniqueWorkers = new Set(metrics.map(m => m.worker_id));
    const avgMemoryUsage = metrics.length > 0 
      ? metrics.reduce((sum, m) => sum + m.memory_usage_mb, 0) / metrics.length 
      : 0;
    const avgCpuUsage = metrics.length > 0 
      ? metrics.reduce((sum, m) => sum + m.cpu_usage_percent, 0) / metrics.length 
      : 0;
    
    return {
      uniqueWorkers: uniqueWorkers.size,
      totalMetricPoints: metrics.length,
      avgMemoryUsage,
      avgCpuUsage,
      maxMemoryUsage: metrics.length > 0 ? Math.max(...metrics.map(m => m.memory_usage_mb)) : 0,
      maxCpuUsage: metrics.length > 0 ? Math.max(...metrics.map(m => m.cpu_usage_percent)) : 0
    };
  }
  
  /**
   * Get queue metrics for a specific period
   */
  async getQueueMetricsForPeriod(startDate, endDate) {
    const stats = await QueueStats.findAll({
      where: {
        timestamp: {
          [QueueStats.sequelize.Op.between]: [startDate, endDate]
        }
      }
    });
    
    const queueNames = new Set(stats.map(s => s.queue_name));
    const totalCompleted = stats.reduce((sum, s) => sum + s.jobs_completed_hour, 0);
    const totalFailed = stats.reduce((sum, s) => sum + s.jobs_failed_hour, 0);
    const avgThroughput = stats.length > 0 
      ? stats.reduce((sum, s) => sum + s.throughput_per_hour, 0) / stats.length 
      : 0;
    
    return {
      uniqueQueues: queueNames.size,
      totalCompleted,
      totalFailed,
      avgThroughput,
      maxWaitingJobs: stats.length > 0 ? Math.max(...stats.map(s => s.jobs_waiting)) : 0,
      maxActiveJobs: stats.length > 0 ? Math.max(...stats.map(s => s.jobs_active)) : 0
    };
  }
  
  /**
   * Get hourly trends for a specific period
   */
  async getHourlyTrends(startDate, endDate) {
    const jobs = await JobMetrics.findAll({
      where: {
        completed_at: {
          [JobMetrics.sequelize.Op.between]: [startDate, endDate]
        }
      },
      order: [['completed_at', 'ASC']]
    });
    
    // Group by hour
    const hourlyData = new Map();
    
    jobs.forEach(job => {
      const hour = new Date(job.completed_at);
      hour.setMinutes(0, 0, 0);
      const hourKey = hour.toISOString();
      
      if (!hourlyData.has(hourKey)) {
        hourlyData.set(hourKey, {
          hour: hour,
          completed: 0,
          failed: 0,
          processingTimes: [],
          waitTimes: []
        });
      }
      
      const data = hourlyData.get(hourKey);
      
      if (job.status === 'completed') {
        data.completed++;
        if (job.processing_time) {
          data.processingTimes.push(job.processing_time);
        }
      } else if (job.status === 'failed') {
        data.failed++;
      }
      
      if (job.wait_time) {
        data.waitTimes.push(job.wait_time);
      }
    });
    
    // Convert to array and calculate averages
    return Array.from(hourlyData.values()).map(data => ({
      hour: data.hour,
      completed: data.completed,
      failed: data.failed,
      total: data.completed + data.failed,
      successRate: data.completed + data.failed > 0 
        ? (data.completed / (data.completed + data.failed)) * 100 
        : 0,
      avgProcessingTime: data.processingTimes.length > 0 
        ? data.processingTimes.reduce((a, b) => a + b, 0) / data.processingTimes.length 
        : 0,
      avgWaitTime: data.waitTimes.length > 0 
        ? data.waitTimes.reduce((a, b) => a + b, 0) / data.waitTimes.length 
        : 0
    }));
  }
  
  /**
   * Get user plan statistics for a specific period
   */
  async getUserPlanStatsForPeriod(startDate, endDate) {
    const jobs = await JobMetrics.findAll({
      where: {
        completed_at: {
          [JobMetrics.sequelize.Op.between]: [startDate, endDate]
        }
      },
      attributes: [
        'user_plan',
        [JobMetrics.sequelize.fn('COUNT', JobMetrics.sequelize.col('id')), 'total_jobs'],
        [JobMetrics.sequelize.fn('SUM', JobMetrics.sequelize.literal('CASE WHEN status = "completed" THEN 1 ELSE 0 END')), 'completed_jobs'],
        [JobMetrics.sequelize.fn('AVG', JobMetrics.sequelize.col('processing_time')), 'avg_processing_time'],
        [JobMetrics.sequelize.fn('AVG', JobMetrics.sequelize.col('wait_time')), 'avg_wait_time']
      ],
      group: ['user_plan']
    });
    
    return jobs.map(job => ({
      userPlan: job.user_plan,
      totalJobs: parseInt(job.dataValues.total_jobs),
      completedJobs: parseInt(job.dataValues.completed_jobs),
      failedJobs: parseInt(job.dataValues.total_jobs) - parseInt(job.dataValues.completed_jobs),
      successRate: (parseInt(job.dataValues.completed_jobs) / parseInt(job.dataValues.total_jobs)) * 100,
      avgProcessingTime: parseFloat(job.dataValues.avg_processing_time) || 0,
      avgWaitTime: parseFloat(job.dataValues.avg_wait_time) || 0
    }));
  }
  
  /**
   * Get error analysis for a specific period
   */
  async getErrorAnalysisForPeriod(startDate, endDate) {
    const failedJobs = await JobMetrics.findAll({
      where: {
        status: 'failed',
        completed_at: {
          [JobMetrics.sequelize.Op.between]: [startDate, endDate]
        }
      }
    });
    
    const errorTypes = new Map();
    
    failedJobs.forEach(job => {
      const errorType = job.error_type || 'unknown';
      if (!errorTypes.has(errorType)) {
        errorTypes.set(errorType, {
          type: errorType,
          count: 0,
          retries: []
        });
      }
      
      const data = errorTypes.get(errorType);
      data.count++;
      data.retries.push(job.retry_count);
    });
    
    const totalErrors = failedJobs.length;
    
    return {
      totalErrors,
      errorTypes: Array.from(errorTypes.values()).map(error => ({
        type: error.type,
        count: error.count,
        percentage: (error.count / totalErrors) * 100,
        avgRetries: error.retries.reduce((a, b) => a + b, 0) / error.retries.length
      })).sort((a, b) => b.count - a.count)
    };
  }
  
  /**
   * Get worker performance for a specific period
   */
  async getWorkerPerformanceForPeriod(startDate, endDate) {
    const jobs = await JobMetrics.findAll({
      where: {
        completed_at: {
          [JobMetrics.sequelize.Op.between]: [startDate, endDate]
        },
        worker_id: {
          [JobMetrics.sequelize.Op.ne]: null
        }
      },
      attributes: [
        'worker_id',
        [JobMetrics.sequelize.fn('COUNT', JobMetrics.sequelize.col('id')), 'total_jobs'],
        [JobMetrics.sequelize.fn('SUM', JobMetrics.sequelize.literal('CASE WHEN status = "completed" THEN 1 ELSE 0 END')), 'completed_jobs'],
        [JobMetrics.sequelize.fn('AVG', JobMetrics.sequelize.col('processing_time')), 'avg_processing_time'],
        [JobMetrics.sequelize.fn('AVG', JobMetrics.sequelize.col('memory_used_mb')), 'avg_memory_usage']
      ],
      group: ['worker_id']
    });
    
    return jobs.map(job => ({
      workerId: job.worker_id,
      totalJobs: parseInt(job.dataValues.total_jobs),
      completedJobs: parseInt(job.dataValues.completed_jobs),
      failedJobs: parseInt(job.dataValues.total_jobs) - parseInt(job.dataValues.completed_jobs),
      successRate: (parseInt(job.dataValues.completed_jobs) / parseInt(job.dataValues.total_jobs)) * 100,
      avgProcessingTime: parseFloat(job.dataValues.avg_processing_time) || 0,
      avgMemoryUsage: parseFloat(job.dataValues.avg_memory_usage) || 0
    }));
  }
  
  /**
   * Generate comprehensive report content
   */
  async generateReportContent(data, date) {
    const report = {
      metadata: {
        reportType: 'daily_performance',
        generatedAt: new Date(),
        reportDate: date,
        period: data.period,
        version: '1.0'
      },
      
      executive_summary: this.generateExecutiveSummary(data),
      
      performance_metrics: {
        jobs: data.jobs,
        workers: data.workers,
        queues: data.queues,
        system_efficiency: this.calculateSystemEfficiency(data)
      },
      
      trends_analysis: {
        hourly_trends: data.hourlyTrends,
        performance_trends: this.analyzePerformanceTrends(data.hourlyTrends),
        capacity_utilization: this.analyzeCapacityUtilization(data)
      },
      
      user_analysis: {
        user_plan_stats: data.userPlans,
        plan_performance_comparison: this.compareUserPlanPerformance(data.userPlans)
      },
      
      error_analysis: {
        ...data.errors,
        error_trends: this.analyzeErrorTrends(data.hourlyTrends),
        resolution_recommendations: this.generateErrorResolutionRecommendations(data.errors)
      },
      
      worker_analysis: {
        worker_performance: data.workerPerformance,
        worker_efficiency: this.analyzeWorkerEfficiency(data.workerPerformance),
        resource_utilization: this.analyzeResourceUtilization(data.workers)
      },
      
      recommendations: this.generateOptimizationRecommendations(data),
      
      capacity_planning: this.generateCapacityPlanningInsights(data),
      
      raw_data: this.options.includeRawData ? data : null
    };
    
    return report;
  }
  
  /**
   * Generate executive summary
   */
  generateExecutiveSummary(data) {
    const jobs = data.jobs;
    const workers = data.workers;
    
    return {
      total_jobs_processed: jobs.total,
      success_rate: jobs.successRate,
      avg_processing_time: jobs.avgProcessingTime,
      system_availability: this.calculateSystemAvailability(data),
      key_metrics: {
        throughput: jobs.total / 24, // Jobs per hour
        efficiency: jobs.successRate,
        performance: jobs.avgProcessingTime < 30 ? 'excellent' : 
                    jobs.avgProcessingTime < 60 ? 'good' : 
                    jobs.avgProcessingTime < 120 ? 'fair' : 'poor',
        resource_usage: workers.avgMemoryUsage < 1000 ? 'optimal' : 
                       workers.avgMemoryUsage < 1500 ? 'moderate' : 'high'
      },
      alerts_summary: {
        performance_issues: jobs.successRate < 95 ? 1 : 0,
        capacity_issues: jobs.avgWaitTime > 30 ? 1 : 0,
        resource_issues: workers.avgMemoryUsage > 1500 ? 1 : 0
      }
    };
  }
  
  /**
   * Calculate system efficiency metrics
   */
  calculateSystemEfficiency(data) {
    const jobs = data.jobs;
    const workers = data.workers;
    
    return {
      processing_efficiency: jobs.successRate / 100,
      resource_efficiency: workers.avgMemoryUsage > 0 ? 
        Math.min(1, 1000 / workers.avgMemoryUsage) : 1,
      time_efficiency: jobs.avgProcessingTime > 0 ? 
        Math.min(1, 30 / jobs.avgProcessingTime) : 1,
      overall_efficiency: (
        (jobs.successRate / 100) * 0.5 +
        (workers.avgMemoryUsage > 0 ? Math.min(1, 1000 / workers.avgMemoryUsage) : 1) * 0.3 +
        (jobs.avgProcessingTime > 0 ? Math.min(1, 30 / jobs.avgProcessingTime) : 1) * 0.2
      )
    };
  }
  
  /**
   * Analyze performance trends
   */
  analyzePerformanceTrends(hourlyTrends) {
    if (hourlyTrends.length < 2) {
      return { trend: 'insufficient_data' };
    }
    
    const processingTimes = hourlyTrends.map(h => h.avgProcessingTime).filter(t => t > 0);
    const successRates = hourlyTrends.map(h => h.successRate);
    
    return {
      processing_time_trend: this.calculateTrend(processingTimes),
      success_rate_trend: this.calculateTrend(successRates),
      peak_hours: this.identifyPeakHours(hourlyTrends),
      low_activity_hours: this.identifyLowActivityHours(hourlyTrends)
    };
  }
  
  /**
   * Generate optimization recommendations
   */
  generateOptimizationRecommendations(data) {
    const recommendations = [];
    
    // Performance recommendations
    if (data.jobs.successRate < 95) {
      recommendations.push({
        category: 'reliability',
        priority: 'high',
        title: 'Improve Success Rate',
        description: `Current success rate is ${data.jobs.successRate.toFixed(1)}%. Target: 95%+`,
        actions: [
          'Investigate and fix common error patterns',
          'Improve error handling and retry logic',
          'Add more comprehensive input validation'
        ]
      });
    }
    
    if (data.jobs.avgProcessingTime > 60) {
      recommendations.push({
        category: 'performance',
        priority: 'medium',
        title: 'Optimize Processing Time',
        description: `Average processing time is ${data.jobs.avgProcessingTime.toFixed(1)}s. Target: <60s`,
        actions: [
          'Profile and optimize processing algorithms',
          'Implement caching for repeated operations',
          'Consider parallel processing for large files'
        ]
      });
    }
    
    // Capacity recommendations
    if (data.jobs.avgWaitTime > 30) {
      recommendations.push({
        category: 'capacity',
        priority: 'medium',
        title: 'Reduce Wait Times',
        description: `Average wait time is ${data.jobs.avgWaitTime.toFixed(1)}s. Target: <30s`,
        actions: [
          'Increase worker capacity during peak hours',
          'Implement auto-scaling based on queue length',
          'Optimize queue management and prioritization'
        ]
      });
    }
    
    // Resource recommendations
    if (data.workers.avgMemoryUsage > 1500) {
      recommendations.push({
        category: 'resources',
        priority: 'high',
        title: 'Optimize Memory Usage',
        description: `Average memory usage is ${data.workers.avgMemoryUsage.toFixed(0)}MB. Target: <1500MB`,
        actions: [
          'Implement memory cleanup after processing',
          'Optimize data structures and algorithms',
          'Add memory monitoring and limits'
        ]
      });
    }
    
    return recommendations;
  }
  
  /**
   * Generate capacity planning insights
   */
  generateCapacityPlanningInsights(data) {
    const peakHourJobs = Math.max(...data.hourlyTrends.map(h => h.total));
    const avgHourlyJobs = data.jobs.total / 24;
    const currentWorkers = data.workers.uniqueWorkers;
    
    return {
      current_capacity: {
        workers: currentWorkers,
        peak_hourly_jobs: peakHourJobs,
        avg_hourly_jobs: avgHourlyJobs,
        capacity_utilization: currentWorkers > 0 ? (avgHourlyJobs / currentWorkers) : 0
      },
      
      recommendations: {
        optimal_worker_count: Math.ceil(peakHourJobs * 1.2), // 20% buffer
        scaling_triggers: {
          scale_up_threshold: Math.ceil(currentWorkers * 0.8),
          scale_down_threshold: Math.ceil(currentWorkers * 0.3)
        },
        resource_planning: {
          memory_per_worker: data.workers.avgMemoryUsage,
          cpu_per_worker: data.workers.avgCpuUsage,
          estimated_monthly_jobs: data.jobs.total * 30
        }
      }
    };
  }
  
  /**
   * Utility functions
   */
  calculateMedian(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 
      ? (sorted[mid - 1] + sorted[mid]) / 2 
      : sorted[mid];
  }
  
  calculatePercentile(values, percentile) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }
  
  calculateTrend(values) {
    if (values.length < 2) return 'stable';
    
    const first = values.slice(0, Math.floor(values.length / 3));
    const last = values.slice(-Math.floor(values.length / 3));
    
    const firstAvg = first.reduce((a, b) => a + b, 0) / first.length;
    const lastAvg = last.reduce((a, b) => a + b, 0) / last.length;
    
    const change = ((lastAvg - firstAvg) / firstAvg) * 100;
    
    if (Math.abs(change) < 5) return 'stable';
    return change > 0 ? 'increasing' : 'decreasing';
  }
  
  identifyPeakHours(hourlyTrends) {
    const avgJobs = hourlyTrends.reduce((sum, h) => sum + h.total, 0) / hourlyTrends.length;
    return hourlyTrends
      .filter(h => h.total > avgJobs * 1.5)
      .map(h => h.hour.getHours());
  }
  
  identifyLowActivityHours(hourlyTrends) {
    const avgJobs = hourlyTrends.reduce((sum, h) => sum + h.total, 0) / hourlyTrends.length;
    return hourlyTrends
      .filter(h => h.total < avgJobs * 0.5)
      .map(h => h.hour.getHours());
  }
  
  calculateSystemAvailability(data) {
    // Simplified availability calculation based on success rate and processing
    return Math.min(100, data.jobs.successRate * 0.8 + 20);
  }
  
  analyzeCapacityUtilization(data) {
    return {
      worker_utilization: data.workers.uniqueWorkers > 0 ? 
        (data.jobs.total / (data.workers.uniqueWorkers * 24)) * 100 : 0,
      memory_utilization: (data.workers.avgMemoryUsage / 2048) * 100, // Assuming 2GB limit
      queue_efficiency: data.queues.totalCompleted > 0 ? 
        (data.queues.totalCompleted / (data.queues.totalCompleted + data.queues.totalFailed)) * 100 : 0
    };
  }
  
  compareUserPlanPerformance(userPlans) {
    return userPlans.map(plan => ({
      ...plan,
      performance_score: (plan.successRate * 0.6) + 
                        ((60 / Math.max(plan.avgProcessingTime, 1)) * 40 * 0.4)
    })).sort((a, b) => b.performance_score - a.performance_score);
  }
  
  analyzeErrorTrends(hourlyTrends) {
    const errorRates = hourlyTrends.map(h => 
      h.total > 0 ? (h.failed / h.total) * 100 : 0
    );
    
    return {
      trend: this.calculateTrend(errorRates),
      peak_error_hours: hourlyTrends
        .filter(h => h.total > 0 && (h.failed / h.total) > 0.1)
        .map(h => h.hour.getHours()),
      avg_error_rate: errorRates.reduce((a, b) => a + b, 0) / errorRates.length
    };
  }
  
  generateErrorResolutionRecommendations(errors) {
    return errors.errorTypes.slice(0, 3).map(error => ({
      error_type: error.type,
      priority: error.percentage > 30 ? 'high' : 'medium',
      recommendation: this.getErrorRecommendation(error.type),
      impact: `Resolving this would improve success rate by ${error.percentage.toFixed(1)}%`
    }));
  }
  
  getErrorRecommendation(errorType) {
    const recommendations = {
      'timeout': 'Increase processing timeout limits or optimize processing speed',
      'memory': 'Implement memory optimization or increase available memory',
      'validation': 'Improve input validation and error handling',
      'network': 'Add retry logic and improve network error handling',
      'unknown': 'Add better error logging and monitoring to identify root cause'
    };
    
    return recommendations[errorType] || recommendations['unknown'];
  }
  
  analyzeWorkerEfficiency(workerPerformance) {
    const avgSuccessRate = workerPerformance.reduce((sum, w) => sum + w.successRate, 0) / workerPerformance.length;
    const avgProcessingTime = workerPerformance.reduce((sum, w) => sum + w.avgProcessingTime, 0) / workerPerformance.length;
    
    return {
      top_performers: workerPerformance
        .filter(w => w.successRate > avgSuccessRate && w.avgProcessingTime < avgProcessingTime)
        .slice(0, 3),
      underperformers: workerPerformance
        .filter(w => w.successRate < avgSuccessRate || w.avgProcessingTime > avgProcessingTime * 1.5)
        .slice(0, 3),
      efficiency_distribution: {
        high_efficiency: workerPerformance.filter(w => w.successRate > 95 && w.avgProcessingTime < 60).length,
        medium_efficiency: workerPerformance.filter(w => w.successRate > 90 && w.avgProcessingTime < 120).length,
        low_efficiency: workerPerformance.filter(w => w.successRate < 90 || w.avgProcessingTime > 120).length
      }
    };
  }
  
  analyzeResourceUtilization(workers) {
    return {
      memory_efficiency: workers.avgMemoryUsage < 1000 ? 'optimal' : 
                        workers.avgMemoryUsage < 1500 ? 'moderate' : 'high',
      cpu_efficiency: workers.avgCpuUsage < 70 ? 'optimal' : 
                     workers.avgCpuUsage < 85 ? 'moderate' : 'high',
      recommendations: this.getResourceRecommendations(workers)
    };
  }
  
  getResourceRecommendations(workers) {
    const recommendations = [];
    
    if (workers.avgMemoryUsage > 1500) {
      recommendations.push('Consider memory optimization or scaling up instances');
    }
    
    if (workers.avgCpuUsage > 85) {
      recommendations.push('CPU usage is high - consider adding more workers or optimizing algorithms');
    }
    
    if (workers.avgMemoryUsage < 500 && workers.avgCpuUsage < 50) {
      recommendations.push('Resources are underutilized - consider scaling down or increasing workload');
    }
    
    return recommendations;
  }
  
  /**
   * Generate HTML report (basic implementation)
   */
  generateHtmlReport(report) {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Daily Performance Report - ${report.metadata.reportDate.toDateString()}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f5f5f5; padding: 20px; border-radius: 5px; }
        .section { margin: 20px 0; }
        .metric { display: inline-block; margin: 10px; padding: 10px; background: #e9e9e9; border-radius: 3px; }
        .recommendation { background: #fff3cd; padding: 10px; margin: 5px 0; border-radius: 3px; }
        .high-priority { border-left: 4px solid #dc3545; }
        .medium-priority { border-left: 4px solid #ffc107; }
        .low-priority { border-left: 4px solid #28a745; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Daily Performance Report</h1>
        <p>Report Date: ${report.metadata.reportDate.toDateString()}</p>
        <p>Generated: ${report.metadata.generatedAt.toISOString()}</p>
    </div>
    
    <div class="section">
        <h2>Executive Summary</h2>
        <div class="metric">Total Jobs: ${report.executive_summary.total_jobs_processed}</div>
        <div class="metric">Success Rate: ${report.executive_summary.success_rate.toFixed(1)}%</div>
        <div class="metric">Avg Processing Time: ${report.executive_summary.avg_processing_time.toFixed(1)}s</div>
        <div class="metric">System Availability: ${report.executive_summary.system_availability.toFixed(1)}%</div>
    </div>
    
    <div class="section">
        <h2>Recommendations</h2>
        ${report.recommendations.map(rec => `
            <div class="recommendation ${rec.priority}-priority">
                <h4>${rec.title}</h4>
                <p>${rec.description}</p>
                <ul>
                    ${rec.actions.map(action => `<li>${action}</li>`).join('')}
                </ul>
            </div>
        `).join('')}
    </div>
    
    <div class="section">
        <h2>Performance Metrics</h2>
        <p>Detailed metrics available in JSON report.</p>
    </div>
</body>
</html>`;
  }
  
  /**
   * Clean up old reports
   */
  async cleanupOldReports() {
    try {
      const files = await fs.readdir(this.options.reportDirectory);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.options.retentionDays);
      
      for (const file of files) {
        if (file.startsWith('daily-report-')) {
          const filePath = path.join(this.options.reportDirectory, file);
          const stats = await fs.stat(filePath);
          
          if (stats.mtime < cutoffDate) {
            await fs.unlink(filePath);
            this.logger.debug(`Deleted old report: ${file}`);
          }
        }
      }
      
    } catch (error) {
      this.logger.error(`Error cleaning up old reports: ${error.message}`);
    }
  }
  
  /**
   * Get available reports
   */
  async getAvailableReports() {
    try {
      const files = await fs.readdir(this.options.reportDirectory);
      const reports = [];
      
      for (const file of files) {
        if (file.startsWith('daily-report-') && file.endsWith('.json')) {
          const filePath = path.join(this.options.reportDirectory, file);
          const stats = await fs.stat(filePath);
          
          reports.push({
            filename: file,
            date: file.match(/daily-report-(\d{4}-\d{2}-\d{2})\.json/)?.[1],
            size: stats.size,
            created: stats.mtime
          });
        }
      }
      
      return reports.sort((a, b) => b.created - a.created);
      
    } catch (error) {
      this.logger.error(`Error getting available reports: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Load a specific report
   */
  async loadReport(filename) {
    try {
      const filePath = path.join(this.options.reportDirectory, filename);
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content);
      
    } catch (error) {
      this.logger.error(`Error loading report ${filename}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Shutdown the report generator
   */
  async shutdown() {
    this.stopScheduledReports();
    this.logger.info('PerformanceReportGenerator shutdown complete');
  }
}

export default PerformanceReportGenerator;