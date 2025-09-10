import databaseService from "./databaseService.js";

class LogService {
  async logApiRequest(data) {
    try {
      await databaseService.logApiRequest(data);
    } catch (error) {
      console.error('Error logging API request:', error);
    }
  }

  async logSecurityEvent(data) {
    try {
      await databaseService.createLog({
        level: 'warning',
        message: `Security event: ${data.event}`,
        user_id: data.userId,
        details: {
          event: data.event,
          ip_address: data.ipAddress,
          ...data.details
        }
      });
    } catch (error) {
      console.error('Error logging security event:', error);
    }
  }

  async logPageUsage(data) {
    try {
      await databaseService.createLog({
        level: 'info',
        message: `Page usage: ${data.pagesUsed} pages used`,
        user_id: data.userId,
        details: {
          pages_used: data.pagesUsed,
          pages_remaining: data.pagesRemaining,
          file_name: data.fileName,
          ...data.details
        }
      });
    } catch (error) {
      console.error('Error logging page usage:', error);
    }
  }

  // Métodos de log generales
  log(message, ...args) {
    console.log(message, ...args);
  }

  info(message, ...args) {
    console.log('[INFO]', message, ...args);
  }

  debug(message, ...args) {
    console.log('[DEBUG]', message, ...args);
  }

  warn(message, ...args) {
    console.warn('[WARN]', message, ...args);
  }

  error(message, ...args) {
    console.error('[ERROR]', message, ...args);
  }
}

export default new LogService();