# Load and Performance Tests

This directory contains comprehensive load and performance tests for the scalable PDF processing system. These tests verify that the system can handle high concurrent loads, maintain proper priority processing, scale automatically, and manage memory efficiently.

## Test Categories

### 1. Concurrent Processing Tests (`concurrent-processing.test.js`)

Tests the system's ability to handle multiple simultaneous PDF processing requests.

**Key Test Scenarios:**

- 50+ concurrent PDF uploads without failure
- Response time maintenance under extreme load (100+ concurrent requests)
- Mixed file size processing efficiency
- System resource management during high load
- Sustained load performance over time
- Burst traffic pattern handling

**Performance Targets:**

- Success rate: >90% for 50+ concurrent uploads
- Response time: <30 seconds for concurrent processing
- Throughput: >2 jobs/second sustained
- Memory usage: <2GB during processing

### 2. Priority Queue Tests (`priority-queue.test.js`)

Validates the priority-based job processing system ensures premium users get faster service.

**Key Test Scenarios:**

- Premium users process before normal users under load
- Large files route to dedicated queue regardless of user plan
- Priority order maintenance during high concurrent load
- Rapid priority changes handling
- Queue statistics accuracy under load
- Fairness prevention of normal user starvation

**Priority Levels:**

1. **Unlimited users** (Priority 1) - Highest priority
2. **Premium users** (Priority 2) - High priority
3. **Normal users** (Priority 3) - Standard priority
4. **Large files** (Priority 4) - Dedicated processing

### 3. Auto-Scaling Tests (`auto-scaling.test.js`)

Tests the dynamic worker scaling system that adjusts capacity based on load.

**Key Test Scenarios:**

- Scale up workers when queue load exceeds threshold
- Respect maximum worker limits during aggressive scaling
- Proportional scaling across different queue types
- Scale down workers when load decreases
- Respect minimum worker limits
- Protection of active workers from scale down
- Rapid load fluctuation handling without thrashing
- Sustained variable load efficiency
- Scaling performance within time limits
- System stability during rapid scaling events

**Scaling Configuration:**

- **Min Workers:** 3-5 workers
- **Max Workers:** 10-15 workers
- **Scale Up Threshold:** 8-10 jobs in queue
- **Scale Down Threshold:** 1-2 jobs in queue

### 4. Memory Management Tests (`memory-management.test.js`)

Ensures the system efficiently manages memory and prevents resource exhaustion.

**Key Test Scenarios:**

- Memory limit enforcement during high load
- Job pausing when memory thresholds exceeded
- Memory-intensive large file processing
- Temporary file cleanup after processing
- Orphaned file cleanup
- Disk space exhaustion prevention
- Resource pool concurrency limiting
- Resource contention handling

**Memory Limits:**

- **System Memory Limit:** 2GB
- **Memory Threshold:** 85% (pause new jobs)
- **Critical Threshold:** 95% (reject jobs)
- **Job Memory Limit:** 200MB per job
- **Max Concurrent Jobs:** 10-15

## Running Load Tests

### Prerequisites

1. **Node.js** version 18+ with ES modules support
2. **Vitest** testing framework installed
3. **System Resources:** At least 4GB RAM recommended
4. **Redis** server running (for queue management)
5. **MySQL** database available (for metrics storage)

### Running All Load Tests

```bash
# Run comprehensive load test suite
npm run test:load

# Run with verbose output
npm run test:load -- --verbose
```

### Running Individual Test Categories

```bash
# Concurrent processing tests
npm run test:load:concurrent

# Priority queue tests
npm run test:load:priority

# Auto-scaling tests
npm run test:load:scaling

# Memory management tests
npm run test:load:memory
```

### Running Specific Tests

```bash
# Run specific test file with vitest
npx vitest run test/load/concurrent-processing.test.js

# Run with specific timeout
npx vitest run test/load/auto-scaling.test.js --testTimeout=120000

# Run with reporter
npx vitest run test/load/memory-management.test.js --reporter=verbose
```

## Test Configuration

### Vitest Configuration

The load tests use extended timeouts and specific configuration:

```javascript
// vitest.config.js
export default defineConfig({
  test: {
    testTimeout: 120000, // 2 minutes per test
    hookTimeout: 30000, // 30 seconds for setup/teardown
    teardownTimeout: 15000, // 15 seconds for cleanup
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true, // Accurate performance metrics
      },
    },
  },
});
```

### Load Test Thresholds

```javascript
const PERFORMANCE_THRESHOLDS = {
  concurrent: {
    minSuccessRate: 90, // 90% success rate
    maxResponseTime: 30000, // 30 seconds
    minThroughput: 2.0, // 2 jobs/second
  },
  priority: {
    priorityAccuracy: 95, // 95% correct priority order
    maxWaitTime: 15000, // 15 seconds max wait
  },
  scaling: {
    maxScaleTime: 10000, // 10 seconds to scale
    minEfficiency: 80, // 80% scaling efficiency
  },
  memory: {
    maxMemoryUsage: 2048, // 2GB limit
    minCleanupRate: 85, // 85% temp file cleanup
  },
};
```

## Test Reports

### Automated Reporting

Load tests generate comprehensive reports:

```bash
# Report location
./load-test-report.json

# Report contents
{
  "timestamp": "2025-02-09T...",
  "duration": 45230,
  "summary": {
    "totalTests": 48,
    "passedTests": 46,
    "failedTests": 2,
    "successRate": 95.8
  },
  "categories": {
    "concurrent-processing": { "status": "passed", ... },
    "priority-queue": { "status": "passed", ... },
    "auto-scaling": { "status": "passed", ... },
    "memory-management": { "status": "failed", ... }
  }
}
```

### Performance Metrics

Key metrics tracked during load tests:

- **Throughput:** Jobs processed per second
- **Response Time:** P50, P95, P99 percentiles
- **Success Rate:** Percentage of successful operations
- **Memory Usage:** Peak and average memory consumption
- **Scaling Efficiency:** Time to scale up/down workers
- **Queue Performance:** Wait times and processing order
- **Resource Utilization:** CPU, memory, disk usage

## Troubleshooting

### Common Issues

1. **Timeout Errors**

   ```bash
   # Increase test timeout
   npx vitest run --testTimeout=180000
   ```

2. **Memory Issues**

   ```bash
   # Increase Node.js memory limit
   node --max-old-space-size=4096 run-load-tests.js
   ```

3. **Redis Connection Errors**

   ```bash
   # Start Redis server
   redis-server

   # Check Redis connection
   redis-cli ping
   ```

4. **Database Connection Issues**
   ```bash
   # Check MySQL connection
   npm run db:test
   ```

### Performance Tuning

For optimal load test performance:

1. **System Resources**

   - Minimum 4GB RAM
   - SSD storage recommended
   - Close unnecessary applications

2. **Test Environment**

   - Run tests on dedicated test environment
   - Avoid running on production systems
   - Ensure stable network connection

3. **Configuration Tuning**
   - Adjust worker limits based on system capacity
   - Tune memory thresholds for available RAM
   - Configure appropriate timeouts

## Integration with CI/CD

### GitHub Actions Example

```yaml
name: Load Tests
on: [push, pull_request]

jobs:
  load-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: "18"

      - name: Install dependencies
        run: npm ci

      - name: Start Redis
        run: redis-server --daemonize yes

      - name: Run load tests
        run: npm run test:load
        timeout-minutes: 15

      - name: Upload test report
        uses: actions/upload-artifact@v3
        with:
          name: load-test-report
          path: load-test-report.json
```

### Performance Monitoring

Integrate with monitoring tools:

- **Metrics Collection:** Export test metrics to monitoring systems
- **Alerting:** Set up alerts for performance regressions
- **Trending:** Track performance metrics over time
- **Benchmarking:** Compare results across versions

## Best Practices

### Writing Load Tests

1. **Realistic Scenarios:** Model actual user behavior patterns
2. **Gradual Load:** Ramp up load gradually to identify breaking points
3. **Resource Cleanup:** Always clean up test resources
4. **Deterministic Results:** Use consistent test data and timing
5. **Comprehensive Coverage:** Test all critical system components

### Test Maintenance

1. **Regular Updates:** Keep tests updated with system changes
2. **Threshold Tuning:** Adjust performance thresholds as system improves
3. **Environment Consistency:** Maintain consistent test environments
4. **Documentation:** Keep test documentation current

### Performance Analysis

1. **Baseline Establishment:** Establish performance baselines
2. **Regression Detection:** Monitor for performance regressions
3. **Bottleneck Identification:** Use tests to identify system bottlenecks
4. **Capacity Planning:** Use results for capacity planning

## Requirements Verification

These load tests verify the following requirements from the specification:

- **Requirement 1.1, 1.2:** Parallel processing of multiple PDFs
- **Requirement 2.1, 2.2:** Priority-based processing for different user types
- **Requirement 3.1, 3.2, 3.5:** Memory optimization and resource management
- **Requirement 5.1-5.5:** Auto-scaling and load balancing
- **Requirement 6.1-6.3:** Failure recovery and system resilience
- **Requirement 7.1-7.2:** Performance monitoring and metrics

The comprehensive test suite ensures the system meets all scalability and performance requirements for production deployment.
