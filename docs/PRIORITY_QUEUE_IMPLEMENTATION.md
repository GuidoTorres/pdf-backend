# Priority Queue System Implementation

## Overview

This document describes the implementation of the priority queue system for scalable PDF processing, fulfilling **Task 1** from the scalable-pdf-processing specification.

## Requirements Fulfilled

✅ **Requirement 2.1**: Premium users get high priority queue  
✅ **Requirement 2.2**: High priority jobs process before normal priority  
✅ **Requirement 2.3**: Unlimited plan users get maximum priority  
✅ **Requirement 2.4**: Free users use normal priority queue  
✅ **Requirement 2.5**: System maintains dedicated workers for premium users under high load

## Architecture

### Queue Structure

The system implements three separate BullMQ queues:

1. **`pdf-processing-premium`** - For premium, pro, enterprise, unlimited users
2. **`pdf-processing-normal`** - For free and basic users
3. **`pdf-processing-large`** - For files >50MB regardless of user plan

### Priority Mapping

```javascript
Priority Levels (lower number = higher priority):
- unlimited/ilimitado: 1 (Maximum priority)
- enterprise: 2 (High priority)
- pro: 3 (High priority)
- basic: 4 (Medium priority)
- free: 5 (Normal priority)
```

### Queue Determination Logic

```javascript
function determineQueue(userPlan, fileSize) {
  if (fileSize > 50MB) return 'large';
  if (['enterprise', 'pro', 'unlimited', 'ilimitado'].includes(userPlan)) return 'premium';
  return 'normal';
}
```

## Implementation Details

### Core Components

#### 1. PriorityQueueManager (`src/services/priorityQueueManager.js`)

**Key Methods:**

- `addJob(jobData, userPlan, fileSize)` - Add job to appropriate queue
- `addJobByUserId(jobData, userId, fileSize)` - Auto-detect user plan
- `getQueueStats()` - Get statistics for all queues
- `getQueueConfiguration()` - Get worker allocation recommendations
- `determineQueue(userPlan, fileSize)` - Determine correct queue
- `calculatePriority(userPlan)` - Calculate job priority

#### 2. Queue Configuration (`src/config/queue.js`)

**Key Functions:**

- `createPriorityWorkers(processor)` - Create workers for all queues
- `createMultipleWorkers(queueName, processor, count)` - Scale specific queue

#### 3. Enhanced Worker (`src/workers/pdfProcessor.js`)

**Features:**

- Supports all priority queues
- Logs queue name and user plan for monitoring
- Handles priority-specific processing

### Usage Examples

#### Adding Jobs to Priority Queues

```javascript
import priorityQueueManager from "./src/services/priorityQueueManager.js";

// Method 1: With known user plan
const job = await priorityQueueManager.addJob(
  {
    tempFilePath: "/tmp/document.pdf",
    originalName: "document.pdf",
    userId: "user123",
    fileSize: 1024000,
  },
  "pro",
  1024000
);

// Method 2: Auto-detect user plan
const job = await priorityQueueManager.addJobByUserId(
  {
    tempFilePath: "/tmp/document.pdf",
    originalName: "document.pdf",
    userId: "user123",
    fileSize: 1024000,
  },
  "user123",
  1024000
);
```

#### Creating Priority Workers

```javascript
import { createPriorityWorkers } from "./src/config/queue.js";

const processJob = async (job) => {
  // Your processing logic here
  return { success: true, transactions: [] };
};

// Create workers for all priority queues
const workers = createPriorityWorkers(processJob);
```

#### Monitoring Queue Statistics

```javascript
const stats = await priorityQueueManager.getQueueStats();
console.log("Queue Statistics:", stats);
// Output:
// {
//   premium: { waiting: 2, active: 1, completed: 10, failed: 0, total: 3 },
//   normal: { waiting: 5, active: 2, completed: 25, failed: 1, total: 7 },
//   large: { waiting: 0, active: 1, completed: 3, failed: 0, total: 1 }
// }
```

## Configuration

### Redis Configuration

The system requires Redis for queue management. Configure in `src/config/config.js`:

```javascript
redis: {
  url: process.env.REDIS_URL || "redis://127.0.0.1:6379";
}
```

### Queue Options

Each queue is configured with:

- **Retry Policy**: 3 attempts with exponential backoff
- **Job Cleanup**: Keep 10 completed, 5 failed jobs
- **Concurrency**: Premium queue gets higher concurrency (3 vs 2)

## Testing

### Requirements Testing

Run the requirements test suite:

```bash
node test_priority_queue_requirements.js
```

This tests all requirements (2.1-2.5) and verifies:

- Queue assignment logic
- Priority calculation
- Worker allocation recommendations
- Job addition functionality

### Integration Testing

Run the integration test suite:

```bash
node test_priority_queue_integration.js
```

This tests end-to-end functionality including:

- Priority processing order
- Queue statistics
- Large file handling
- Queue configuration

## Monitoring and Metrics

### Queue Statistics

The system provides real-time statistics for monitoring:

```javascript
const config = await priorityQueueManager.getQueueConfiguration();
// Returns:
// {
//   isHighLoad: boolean,
//   totalWaiting: number,
//   recommendedWorkers: { premium: 2, normal: 1, large: 1 },
//   queuePriorities: { premium: 1, normal: 2, large: 3 }
// }
```

### Worker Allocation

Under high load (>10 jobs waiting), the system recommends:

- **Premium Queue**: Minimum 2 workers
- **Normal Queue**: 1 worker per 5 waiting jobs
- **Large Queue**: 1 worker per 2 waiting jobs

## Integration with Existing System

### Document Controller Integration

The priority queue system is integrated into the document processing flow:

```javascript
// In documentController.js
const job = await priorityQueueManager.addJob(jobData, userPlan, fileSize);

// Response includes queue information
res.status(202).json({
  jobId: job.id,
  queueInfo: {
    queueName: job.data.queueName,
    priority: job.data.priority,
    position: queueStats[queueName]?.waiting || 0,
    estimatedWaitTime: calculateEstimatedWaitTime(
      queueStats,
      queueName,
      userPlan
    ),
  },
});
```

### Worker Integration

Workers are automatically created for all priority queues:

```javascript
// In pdfProcessor.js
const priorityWorkers = createPriorityWorkers(processJob);

// Each worker logs queue-specific information
worker.on("active", (job) => {
  console.log(
    `[PDF-WORKER] [${queueName}] [${job.id}] ACTIVE: plan: ${userPlan}, priority: ${priority}`
  );
});
```

## Performance Characteristics

### Queue Processing Order

1. **Premium Queue**: Processes unlimited (priority 1) → enterprise (priority 2) → pro (priority 3)
2. **Normal Queue**: Processes basic (priority 4) → free (priority 5)
3. **Large Queue**: Processes by submission order (FIFO)

### Scalability Features

- **Dynamic Worker Allocation**: Recommends worker scaling based on queue load
- **Queue Separation**: Prevents premium users from being blocked by free user load
- **Large File Isolation**: Prevents large files from blocking smaller documents

## Error Handling

### Retry Policy

- **Attempts**: 3 retries with exponential backoff
- **Backoff**: 2 seconds base delay (5 seconds for large files)
- **Cleanup**: Automatic removal of old completed/failed jobs

### Fallback Mechanisms

- **User Plan Detection**: Falls back to 'free' plan if user plan cannot be determined
- **Queue Availability**: Graceful error handling if specific queue is unavailable
- **Worker Failure**: Jobs are automatically reassigned to available workers

## Future Enhancements

The priority queue system is designed to support future enhancements:

1. **Dynamic Scaling**: Integration with cluster manager for automatic worker scaling
2. **Load Balancing**: Intelligent job distribution across multiple workers
3. **Real-time Monitoring**: WebSocket integration for live queue status updates
4. **Advanced Metrics**: Detailed performance analytics and alerting

## Conclusion

The priority queue system successfully implements all requirements for Task 1, providing:

- ✅ Separate queues for different user types
- ✅ Automatic queue determination based on user plan and file size
- ✅ Priority-based processing with unlimited users getting maximum priority
- ✅ Scalable worker allocation recommendations
- ✅ Comprehensive testing and monitoring capabilities

The system is production-ready and integrates seamlessly with the existing PDF processing infrastructure.
