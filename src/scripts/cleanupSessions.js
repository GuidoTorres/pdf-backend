import { UserSession } from '../models/index.js';
import database from '../config/database.js';

async function cleanupExpiredSessions() {
  try {
    console.log('[CLEANUP] Starting session cleanup...');
    
    const deletedCount = await UserSession.cleanupExpiredSessions();
    
    console.log(`[CLEANUP] Cleaned up ${deletedCount} expired sessions`);
    
    // También limpiar logs antiguos (opcional)
    const { SystemLog } = await import('../models/index.js');
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    const deletedLogs = await SystemLog.destroy({
      where: {
        created_at: {
          [SystemLog.sequelize.Sequelize.Op.lt]: thirtyDaysAgo
        }
      }
    });
    
    console.log(`[CLEANUP] Cleaned up ${deletedLogs} old log entries`);
    
    process.exit(0);
  } catch (error) {
    console.error('[CLEANUP] Error during cleanup:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  cleanupExpiredSessions();
}

export default cleanupExpiredSessions;