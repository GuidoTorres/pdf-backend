import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import config from './config.js';

const connection = new Redis(config.redis.url, {
  maxRetriesPerRequest: null
});

export const pdfProcessingQueue = new Queue('pdf-processing', { connection });

export const createWorker = (processor) => new Worker('pdf-processing', processor, { connection });
