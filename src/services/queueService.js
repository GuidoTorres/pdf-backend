import { pdfProcessingQueue, priorityQueueManager } from '../config/queue.js';
import logService from './logService.js';

async function getFromPriorityQueues(jobId) {
  try {
    const job = await priorityQueueManager.getJob(jobId);
    if (job) {
      logService.log('[QUEUE_SERVICE] Job found in priority queues', { jobId, queue: job.queueName });
    }
    return job;
  } catch (error) {
    logService.warn('[QUEUE_SERVICE] Error retrieving job from priority queues', {
      jobId,
      error: error.message
    });
    return null;
  }
}

async function getFromLegacyQueue(jobId) {
  if (!pdfProcessingQueue) {
    return null;
  }

  try {
    const job = await pdfProcessingQueue.getJob(jobId);
    if (job) {
      logService.log('[QUEUE_SERVICE] Job found in legacy queue', { jobId });
    }
    return job;
  } catch (error) {
    logService.warn('[QUEUE_SERVICE] Error retrieving job from legacy queue', {
      jobId,
      error: error.message
    });
    return null;
  }
}

export async function getJob(jobId) {
  if (!jobId) return null;

  const priorityJob = await getFromPriorityQueues(jobId);
  if (priorityJob) {
    return priorityJob;
  }

  return await getFromLegacyQueue(jobId);
}

export async function removeJob(jobId) {
  const job = await getJob(jobId);

  if (!job) {
    return { removed: false, job: null };
  }

  try {
    await job.remove();
    logService.log('[QUEUE_SERVICE] Job removed from queue', {
      jobId,
      queueName: job.queueName || job.queue?.name
    });
    return { removed: true, job };
  } catch (error) {
    logService.error('[QUEUE_SERVICE] Failed to remove job from queue', {
      jobId,
      error: error.message
    });
    return { removed: false, job };
  }
}

export default {
  getJob,
  removeJob
};
