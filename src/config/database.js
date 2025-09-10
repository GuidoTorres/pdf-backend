import { Sequelize } from 'sequelize';
import config from './config.js';

class Database {
  constructor() {
    this.sequelize = new Sequelize(
      config.database.name,
      config.database.user,
      config.database.password,
      {
        host: config.database.host,
        port: config.database.port,
        dialect: 'mysql',
        logging: config.env === 'development' ? console.log : false,
        pool: {
          max: 20,
          min: 0,
          acquire: 30000,
          idle: 10000
        },
        define: {
          timestamps: true,
          underscored: true,
          freezeTableName: true
        },
        timezone: '+00:00'
      }
    );

    this.testConnection();
  }

  async testConnection() {
    try {
      await this.sequelize.authenticate();
      console.log('[DATABASE] MySQL connection established successfully');
    } catch (err) {
      console.error('[DATABASE] Unable to connect to MySQL:', err);
      process.exit(-1);
    }
  }

  async sync(options = {}) {
    try {
      await this.sequelize.sync(options);
      console.log('[DATABASE] Database synchronized');
    } catch (err) {
      console.error('[DATABASE] Sync error:', err);
      throw err;
    }
  }

  async transaction(callback) {
    const transaction = await this.sequelize.transaction();
    try {
      const result = await callback(transaction);
      await transaction.commit();
      return result;
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }

  async close() {
    await this.sequelize.close();
    console.log('[DATABASE] Connection closed');
  }

  getSequelize() {
    return this.sequelize;
  }
}

export default new Database();