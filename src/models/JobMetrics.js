import { DataTypes } from "sequelize";
import database from "../config/database.js";

const sequelize = database.getSequelize();

const JobMetrics = sequelize.define(
  "JobMetrics",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    job_id: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      index: true,
    },
    document_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: "documents",
        key: "id",
      },
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "id",
      },
    },
    worker_id: {
      type: DataTypes.STRING,
      allowNull: true,
      index: true,
    },
    queue_name: {
      type: DataTypes.STRING,
      allowNull: false,
      index: true,
    },
    priority: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 3,
    },
    user_plan: {
      type: DataTypes.STRING,
      allowNull: false,
      index: true,
    },
    file_size: {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: 'File size in bytes',
    },
    page_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    queued_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    started_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    completed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    wait_time: {
      type: DataTypes.FLOAT,
      allowNull: true,
      comment: 'Time spent waiting in queue (seconds)',
    },
    processing_time: {
      type: DataTypes.FLOAT,
      allowNull: true,
      comment: 'Time spent processing (seconds)',
    },
    total_time: {
      type: DataTypes.FLOAT,
      allowNull: true,
      comment: 'Total time from queue to completion (seconds)',
    },
    memory_used_mb: {
      type: DataTypes.FLOAT,
      allowNull: true,
      comment: 'Peak memory usage during processing (MB)',
    },
    cpu_time_ms: {
      type: DataTypes.FLOAT,
      allowNull: true,
      comment: 'CPU time used (milliseconds)',
    },
    status: {
      type: DataTypes.ENUM('queued', 'processing', 'completed', 'failed', 'cancelled'),
      allowNull: false,
      defaultValue: 'queued',
    },
    retry_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    error_message: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    error_type: {
      type: DataTypes.STRING,
      allowNull: true,
      index: true,
    },
    processing_steps: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Detailed breakdown of processing steps and their timings',
    },
    performance_metrics: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Additional performance metrics and metadata',
    },
    estimated_time: {
      type: DataTypes.FLOAT,
      allowNull: true,
      comment: 'Initial estimated processing time (seconds)',
    },
    accuracy_score: {
      type: DataTypes.FLOAT,
      allowNull: true,
      comment: 'Processing accuracy score (0-1)',
    },
    confidence_score: {
      type: DataTypes.FLOAT,
      allowNull: true,
      comment: 'Processing confidence score (0-1)',
    },
  },
  {
    tableName: "job_metrics",
    indexes: [
      {
        fields: ["job_id"],
      },
      {
        fields: ["user_id", "queued_at"],
      },
      {
        fields: ["worker_id", "started_at"],
      },
      {
        fields: ["queue_name", "queued_at"],
      },
      {
        fields: ["status"],
      },
      {
        fields: ["user_plan"],
      },
      {
        fields: ["error_type"],
      },
      {
        fields: ["completed_at"],
      },
    ],
  }
);

// Instance methods
JobMetrics.prototype.markStarted = async function (workerId) {
  const startedAt = new Date();
  const waitTime = (startedAt - this.queued_at) / 1000; // Convert to seconds
  
  return await this.update({
    status: 'processing',
    worker_id: workerId,
    started_at: startedAt,
    wait_time: waitTime,
  });
};

JobMetrics.prototype.markCompleted = async function (performanceData = {}) {
  const completedAt = new Date();
  const processingTime = this.started_at ? (completedAt - this.started_at) / 1000 : null;
  const totalTime = (completedAt - this.queued_at) / 1000;
  
  return await this.update({
    status: 'completed',
    completed_at: completedAt,
    processing_time: processingTime,
    total_time: totalTime,
    memory_used_mb: performanceData.memoryUsedMb,
    cpu_time_ms: performanceData.cpuTimeMs,
    accuracy_score: performanceData.accuracyScore,
    confidence_score: performanceData.confidenceScore,
    processing_steps: performanceData.processingSteps,
    performance_metrics: performanceData.additionalMetrics,
  });
};

JobMetrics.prototype.markFailed = async function (errorMessage, errorType = null, performanceData = {}) {
  const failedAt = new Date();
  const processingTime = this.started_at ? (failedAt - this.started_at) / 1000 : null;
  const totalTime = (failedAt - this.queued_at) / 1000;
  
  return await this.update({
    status: 'failed',
    completed_at: failedAt,
    processing_time: processingTime,
    total_time: totalTime,
    error_message: errorMessage,
    error_type: errorType,
    memory_used_mb: performanceData.memoryUsedMb,
    cpu_time_ms: performanceData.cpuTimeMs,
    performance_metrics: performanceData.additionalMetrics,
  });
};

JobMetrics.prototype.incrementRetry = async function () {
  return await this.update({
    retry_count: this.retry_count + 1,
    status: 'queued', // Reset to queued for retry
  });
};

JobMetrics.prototype.updateEstimatedTime = async function (estimatedTime) {
  return await this.update({
    estimated_time: estimatedTime,
  });
};

// Static methods
JobMetrics.getPerformanceStats = async function (hours = 24) {
  const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  const completedJobs = await this.findAll({
    where: {
      status: 'completed',
      completed_at: {
        [sequelize.Sequelize.Op.gte]: startTime,
      },
    },
  });
  
  const failedJobs = await this.findAll({
    where: {
      status: 'failed',
      completed_at: {
        [sequelize.Sequelize.Op.gte]: startTime,
      },
    },
  });
  
  if (completedJobs.length === 0 && failedJobs.length === 0) {
    return {
      totalJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      successRate: 0,
      avgProcessingTime: 0,
      avgWaitTime: 0,
      avgTotalTime: 0,
      avgMemoryUsage: 0,
    };
  }
  
  const processingTimes = completedJobs
    .filter(job => job.processing_time)
    .map(job => job.processing_time);
  
  const waitTimes = [...completedJobs, ...failedJobs]
    .filter(job => job.wait_time)
    .map(job => job.wait_time);
  
  const totalTimes = [...completedJobs, ...failedJobs]
    .filter(job => job.total_time)
    .map(job => job.total_time);
  
  const memoryUsages = completedJobs
    .filter(job => job.memory_used_mb)
    .map(job => job.memory_used_mb);
  
  return {
    totalJobs: completedJobs.length + failedJobs.length,
    completedJobs: completedJobs.length,
    failedJobs: failedJobs.length,
    successRate: ((completedJobs.length / (completedJobs.length + failedJobs.length)) * 100),
    avgProcessingTime: processingTimes.length > 0 
      ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length 
      : 0,
    avgWaitTime: waitTimes.length > 0 
      ? waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length 
      : 0,
    avgTotalTime: totalTimes.length > 0 
      ? totalTimes.reduce((a, b) => a + b, 0) / totalTimes.length 
      : 0,
    avgMemoryUsage: memoryUsages.length > 0 
      ? memoryUsages.reduce((a, b) => a + b, 0) / memoryUsages.length 
      : 0,
    minProcessingTime: processingTimes.length > 0 ? Math.min(...processingTimes) : 0,
    maxProcessingTime: processingTimes.length > 0 ? Math.max(...processingTimes) : 0,
    minWaitTime: waitTimes.length > 0 ? Math.min(...waitTimes) : 0,
    maxWaitTime: waitTimes.length > 0 ? Math.max(...waitTimes) : 0,
  };
};

JobMetrics.getUserPlanStats = async function (hours = 24) {
  const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  const jobs = await this.findAll({
    where: {
      completed_at: {
        [sequelize.Sequelize.Op.gte]: startTime,
      },
    },
    attributes: [
      'user_plan',
      [sequelize.fn('COUNT', sequelize.col('id')), 'total_jobs'],
      [sequelize.fn('SUM', sequelize.literal('CASE WHEN status = "completed" THEN 1 ELSE 0 END')), 'completed_jobs'],
      [sequelize.fn('AVG', sequelize.col('processing_time')), 'avg_processing_time'],
      [sequelize.fn('AVG', sequelize.col('wait_time')), 'avg_wait_time'],
      [sequelize.fn('AVG', sequelize.col('memory_used_mb')), 'avg_memory_usage'],
    ],
    group: ['user_plan'],
  });
  
  return jobs.map(job => ({
    userPlan: job.user_plan,
    totalJobs: parseInt(job.dataValues.total_jobs),
    completedJobs: parseInt(job.dataValues.completed_jobs),
    failedJobs: parseInt(job.dataValues.total_jobs) - parseInt(job.dataValues.completed_jobs),
    successRate: (parseInt(job.dataValues.completed_jobs) / parseInt(job.dataValues.total_jobs)) * 100,
    avgProcessingTime: parseFloat(job.dataValues.avg_processing_time) || 0,
    avgWaitTime: parseFloat(job.dataValues.avg_wait_time) || 0,
    avgMemoryUsage: parseFloat(job.dataValues.avg_memory_usage) || 0,
  }));
};

JobMetrics.getErrorAnalysis = async function (hours = 24) {
  const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  const errorStats = await this.findAll({
    where: {
      status: 'failed',
      completed_at: {
        [sequelize.Sequelize.Op.gte]: startTime,
      },
    },
    attributes: [
      'error_type',
      [sequelize.fn('COUNT', sequelize.col('id')), 'error_count'],
      [sequelize.fn('AVG', sequelize.col('retry_count')), 'avg_retries'],
    ],
    group: ['error_type'],
  });
  
  const totalErrors = errorStats.reduce((sum, stat) => sum + parseInt(stat.dataValues.error_count), 0);
  
  return {
    totalErrors,
    errorTypes: errorStats.map(stat => ({
      errorType: stat.error_type || 'unknown',
      count: parseInt(stat.dataValues.error_count),
      percentage: (parseInt(stat.dataValues.error_count) / totalErrors) * 100,
      avgRetries: parseFloat(stat.dataValues.avg_retries) || 0,
    })),
  };
};

JobMetrics.getWorkerPerformance = async function (hours = 24) {
  const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  const workerStats = await this.findAll({
    where: {
      completed_at: {
        [sequelize.Sequelize.Op.gte]: startTime,
      },
      worker_id: {
        [sequelize.Sequelize.Op.ne]: null,
      },
    },
    attributes: [
      'worker_id',
      [sequelize.fn('COUNT', sequelize.col('id')), 'total_jobs'],
      [sequelize.fn('SUM', sequelize.literal('CASE WHEN status = "completed" THEN 1 ELSE 0 END')), 'completed_jobs'],
      [sequelize.fn('AVG', sequelize.col('processing_time')), 'avg_processing_time'],
      [sequelize.fn('AVG', sequelize.col('memory_used_mb')), 'avg_memory_usage'],
      [sequelize.fn('MIN', sequelize.col('processing_time')), 'min_processing_time'],
      [sequelize.fn('MAX', sequelize.col('processing_time')), 'max_processing_time'],
    ],
    group: ['worker_id'],
  });
  
  return workerStats.map(stat => ({
    workerId: stat.worker_id,
    totalJobs: parseInt(stat.dataValues.total_jobs),
    completedJobs: parseInt(stat.dataValues.completed_jobs),
    failedJobs: parseInt(stat.dataValues.total_jobs) - parseInt(stat.dataValues.completed_jobs),
    successRate: (parseInt(stat.dataValues.completed_jobs) / parseInt(stat.dataValues.total_jobs)) * 100,
    avgProcessingTime: parseFloat(stat.dataValues.avg_processing_time) || 0,
    avgMemoryUsage: parseFloat(stat.dataValues.avg_memory_usage) || 0,
    minProcessingTime: parseFloat(stat.dataValues.min_processing_time) || 0,
    maxProcessingTime: parseFloat(stat.dataValues.max_processing_time) || 0,
  }));
};

JobMetrics.getHourlyTrends = async function (hours = 24) {
  const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  const hourlyStats = await this.findAll({
    where: {
      completed_at: {
        [sequelize.Sequelize.Op.gte]: startTime,
      },
    },
    attributes: [
      [sequelize.fn('DATE_FORMAT', sequelize.col('completed_at'), '%Y-%m-%d %H:00:00'), 'hour'],
      [sequelize.fn('COUNT', sequelize.col('id')), 'total_jobs'],
      [sequelize.fn('SUM', sequelize.literal('CASE WHEN status = "completed" THEN 1 ELSE 0 END')), 'completed_jobs'],
      [sequelize.fn('AVG', sequelize.col('processing_time')), 'avg_processing_time'],
      [sequelize.fn('AVG', sequelize.col('wait_time')), 'avg_wait_time'],
    ],
    group: [sequelize.fn('DATE_FORMAT', sequelize.col('completed_at'), '%Y-%m-%d %H:00:00')],
    order: [[sequelize.fn('DATE_FORMAT', sequelize.col('completed_at'), '%Y-%m-%d %H:00:00'), 'ASC']],
  });
  
  return hourlyStats.map(stat => ({
    hour: stat.dataValues.hour,
    totalJobs: parseInt(stat.dataValues.total_jobs),
    completedJobs: parseInt(stat.dataValues.completed_jobs),
    failedJobs: parseInt(stat.dataValues.total_jobs) - parseInt(stat.dataValues.completed_jobs),
    successRate: (parseInt(stat.dataValues.completed_jobs) / parseInt(stat.dataValues.total_jobs)) * 100,
    avgProcessingTime: parseFloat(stat.dataValues.avg_processing_time) || 0,
    avgWaitTime: parseFloat(stat.dataValues.avg_wait_time) || 0,
  }));
};

export default JobMetrics;