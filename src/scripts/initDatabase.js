import database from '../config/database.js';
import { User, Subscription, Document, SystemLog, PaymentLog, UserSession } from '../models/index.js';

async function initDatabase() {
  try {
    console.log('[INIT_DB] Starting database initialization...');

    // Sync all models (create tables)
    await database.sync({ force: false }); // Set to true to drop and recreate tables

    console.log('[INIT_DB] Database synchronized successfully');

    // Create default admin user (optional)
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (adminEmail && adminPassword) {
      const existingAdmin = await User.findOne({ where: { email: adminEmail } });
      
      if (!existingAdmin) {
        const adminUser = await User.create({
          email: adminEmail,
          password_hash: adminPassword,
          name: 'Admin User',
          email_verified: true
        });

        await Subscription.create({
          user_id: adminUser.id,
          plan: 'enterprise',
          pages_remaining: 999999
        });

        console.log('[INIT_DB] Admin user created successfully');
      } else {
        console.log('[INIT_DB] Admin user already exists');
      }
    }

    console.log('[INIT_DB] Database initialization completed');
    process.exit(0);

  } catch (error) {
    console.error('[INIT_DB] Database initialization failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  initDatabase();
}

export default initDatabase;