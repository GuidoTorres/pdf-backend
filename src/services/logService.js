import winston from "winston";
import databaseService from "./databaseService.js";

const isProduction = process.env.NODE_ENV === "production";

const consoleFormat = isProduction
  ? winston.format.json()
  : winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ level, message, timestamp, ...meta }) => {
        const metaString = Object.keys(meta).length
          ? ` ${JSON.stringify(meta)}`
          : "";
        return `[${timestamp}] ${level}: ${message}${metaString}`;
      })
    );

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat()
  ),
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
  ],
});

const jobMetricsBuffer = [];
const JOB_METRICS_BUFFER_SIZE = 200;

class LogService {
  async logApiRequest(data) {
    try {
      await databaseService.logApiRequest(data);
    } catch (error) {
      logger.error("Error logging API request", { error: error.message });
    }
  }

  async logSecurityEvent(data) {
    try {
      await databaseService.createLog({
        level: "warning",
        message: `Security event: ${data.event}`,
        user_id: data.userId,
        details: {
          event: data.event,
          ip_address: data.ipAddress,
          ...data.details,
        },
      });
    } catch (error) {
      logger.error("Error logging security event", { error: error.message });
    }
  }

  async logPageUsage(data) {
    try {
      await databaseService.createLog({
        level: "info",
        message: `Page usage: ${data.pagesUsed} pages used`,
        user_id: data.userId,
        details: {
          pages_used: data.pagesUsed,
          pages_remaining: data.pagesRemaining,
          file_name: data.fileName,
          ...data.details,
        },
      });
    } catch (error) {
      logger.error("Error logging page usage", { error: error.message });
    }
  }

  log(message, meta = {}) {
    this.info(message, meta);
  }

  info(message, meta = {}) {
    logger.info(message, meta);
    if (message === '[JOB_PROCESSOR] Timings') {
      const entry = {
        ...meta,
        jobId: meta.jobId,
        timings: meta.timings,
        loggedAt: new Date().toISOString(),
      };
      jobMetricsBuffer.push(entry);
      if (jobMetricsBuffer.length > JOB_METRICS_BUFFER_SIZE) {
        jobMetricsBuffer.shift();
      }
    }
  }

  debug(message, meta = {}) {
    logger.debug(message, meta);
  }

  warn(message, meta = {}) {
    logger.warn(message, meta);
  }

  error(message, meta = {}) {
    logger.error(message, meta);
  }
}

const logService = new LogService();

export const getRecentJobMetrics = () => jobMetricsBuffer.slice().reverse();

export default logService;
export { logger };
