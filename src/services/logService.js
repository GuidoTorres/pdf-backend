import supabaseService from "./supabaseService.js";

class LogService {
  async logApiRequest(data) {
    try {
      await supabaseService.createLog({
        type: 'api_request',
        user_id: data.userId,
        endpoint: data.endpoint,
        method: data.method,
        status: data.status,
        error: data.error,
        details: data.details
      });
    } catch (error) {
      console.error('Error logging API request:', error);
    }
  }

  async logSecurityEvent(data) {
    try {
      await supabaseService.createLog({
        type: 'security',
        user_id: data.userId,
        event: data.event,
        ip_address: data.ipAddress,
        details: data.details
      });
    } catch (error) {
      console.error('Error logging security event:', error);
    }
  }

  async logPageUsage(data) {
    try {
      await supabaseService.createLog({
        type: 'page_usage',
        user_id: data.userId,
        pages_used: data.pagesUsed,
        pages_remaining: data.pagesRemaining,
        file_name: data.fileName,
        details: data.details
      });
    } catch (error) {
      console.error('Error logging page usage:', error);
    }
  }

  // Métodos de log generales
  log(message, ...args) {
    console.log(message, ...args);
  }

  error(message, ...args) {
    console.error(message, ...args);
  }
}

export default new LogService();