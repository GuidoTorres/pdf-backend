import { priorityQueueManager } from '../config/queue.js';
import logService from '../services/logService.js';

/**
 * Get queue statistics for monitoring dashboard
 */
async function getQueueStats(req, res) {
  try {
    const stats = await priorityQueueManager.getQueueStats();
    
    // Calculate total statistics
    const totalStats = {
      totalWaiting: 0,
      totalActive: 0,
      totalJobs: 0
    };

    for (const queueStats of Object.values(stats)) {
      totalStats.totalWaiting += queueStats.waiting;
      totalStats.totalActive += queueStats.active;
      totalStats.totalJobs += queueStats.total;
    }

    // Add timestamp
    const response = {
      timestamp: new Date().toISOString(),
      queues: stats,
      totals: totalStats,
      queueNames: Object.keys(stats)
    };

    logService.log('[QUEUE_CONTROLLER] Queue stats requested', {
      totalWaiting: totalStats.totalWaiting,
      totalActive: totalStats.totalActive
    });

    res.json(response);

  } catch (error) {
    logService.error('[QUEUE_CONTROLLER] Error getting queue stats:', error);
    res.status(500).json({ 
      error: 'Error retrieving queue statistics',
      message: error.message 
    });
  }
}

/**
 * Get detailed queue information including job details
 */
async function getQueueDetails(req, res) {
  const { queueName } = req.params;

  try {
    const queues = priorityQueueManager.getQueues();
    
    if (!queues[queueName]) {
      return res.status(404).json({ 
        error: 'Queue not found',
        availableQueues: Object.keys(queues)
      });
    }

    const queue = queues[queueName];
    
    // Get job details
    const waiting = await queue.getWaiting(0, 10); // Get first 10 waiting jobs
    const active = await queue.getActive(0, 10);   // Get first 10 active jobs
    const completed = await queue.getCompleted(0, 5); // Get last 5 completed jobs
    const failed = await queue.getFailed(0, 5);    // Get last 5 failed jobs

    const response = {
      queueName,
      timestamp: new Date().toISOString(),
      counts: {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length
      },
      jobs: {
        waiting: waiting.map(job => ({
          id: job.id,
          data: {
            originalName: job.data.originalName,
            userPlan: job.data.userPlan,
            priority: job.data.priority,
            createdAt: job.data.createdAt
          },
          opts: {
            priority: job.opts.priority
          }
        })),
        active: active.map(job => ({
          id: job.id,
          data: {
            originalName: job.data.originalName,
            userPlan: job.data.userPlan,
            priority: job.data.priority
          },
          progress: job.progress
        }))
      }
    };

    logService.log('[QUEUE_CONTROLLER] Queue details requested', {
      queueName,
      waiting: waiting.length,
      active: active.length
    });

    res.json(response);

  } catch (error) {
    logService.error('[QUEUE_CONTROLLER] Error getting queue details:', error);
    res.status(500).json({ 
      error: 'Error retrieving queue details',
      message: error.message 
    });
  }
}

/**
 * Get system health status
 */
async function getSystemHealth(req, res) {
  try {
    const stats = await priorityQueueManager.getQueueStats();
    
    // Calculate health metrics
    let totalWaiting = 0;
    let totalActive = 0;
    const queueHealth = {};

    for (const [queueName, queueStats] of Object.entries(stats)) {
      totalWaiting += queueStats.waiting;
      totalActive += queueStats.active;
      
      // Determine queue health status
      let status = 'healthy';
      if (queueStats.waiting > 20) {
        status = 'overloaded';
      } else if (queueStats.waiting > 10) {
        status = 'busy';
      }

      queueHealth[queueName] = {
        status,
        waiting: queueStats.waiting,
        active: queueStats.active,
        load: queueStats.waiting + queueStats.active
      };
    }

    // Overall system status
    let systemStatus = 'healthy';
    if (totalWaiting > 50) {
      systemStatus = 'critical';
    } else if (totalWaiting > 25) {
      systemStatus = 'warning';
    }

    const response = {
      timestamp: new Date().toISOString(),
      systemStatus,
      totalJobs: {
        waiting: totalWaiting,
        active: totalActive,
        total: totalWaiting + totalActive
      },
      queues: queueHealth,
      recommendations: generateRecommendations(queueHealth, totalWaiting)
    };

    res.json(response);

  } catch (error) {
    logService.error('[QUEUE_CONTROLLER] Error getting system health:', error);
    res.status(500).json({ 
      error: 'Error retrieving system health',
      message: error.message 
    });
  }
}

/**
 * Generate system recommendations based on queue health
 */
function generateRecommendations(queueHealth, totalWaiting) {
  const recommendations = [];

  if (totalWaiting > 50) {
    recommendations.push({
      type: 'critical',
      message: 'System is heavily overloaded. Consider scaling up workers immediately.',
      action: 'scale_up_workers'
    });
  } else if (totalWaiting > 25) {
    recommendations.push({
      type: 'warning',
      message: 'System is experiencing high load. Monitor closely.',
      action: 'monitor_closely'
    });
  }

  // Check individual queue health
  for (const [queueName, health] of Object.entries(queueHealth)) {
    if (health.status === 'overloaded') {
      recommendations.push({
        type: 'warning',
        message: `Queue ${queueName} is overloaded with ${health.waiting} waiting jobs.`,
        action: 'prioritize_queue',
        queue: queueName
      });
    }
  }

  if (recommendations.length === 0) {
    recommendations.push({
      type: 'info',
      message: 'System is operating normally.',
      action: 'none'
    });
  }

  return recommendations;
}

export {
  getQueueStats,
  getQueueDetails,
  getSystemHealth
};

export default {
  getQueueStats,
  getQueueDetails,
  getSystemHealth
};