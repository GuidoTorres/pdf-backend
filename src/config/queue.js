import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import config from './config.js';
import priorityQueueManager from '../services/priorityQueueManager.js';

const connection = new Redis(config.redis.url, {
  maxRetriesPerRequest: null
});

// Legacy queue for backward compatibility
export const pdfProcessingQueue = new Queue('pdf-processing', { connection });

// New priority queue manager
export { priorityQueueManager };

// Create worker for specific queue
export const createWorker = (queueName, processor) => {
  // If no queue name specified, use legacy queue
  if (!queueName) {
    return new Worker('pdf-processing', processor, { connection });
  }
  
  // Create worker for specific priority queue
  return new Worker(queueName, processor, { connection });
};

// Create workers for all priority queues
export const createPriorityWorkers = (processor) => {
  const queues = priorityQueueManager.getQueues();
  const workers = {};
  
  for (const [queueName, queue] of Object.entries(queues)) {
    workers[queueName] = new Worker(queue.name, processor, { 
      connection,
      concurrency: queueName === 'premium' ? 3 : 2 // More concurrency for premium queue
    });
  }
  
  return workers;
};

// Create multiple workers for a specific queue (for scaling)
export const createMultipleWorkers = (queueName, processor, count = 1) => {
  const workers = [];
  
  for (let i = 0; i < count; i++) {
    const worker = new Worker(queueName, processor, { 
      connection,
      concurrency: queueName === 'pdf-processing-premium' ? 3 : 2
    });
    workers.push(worker);
  }
  
  return workers;
};
