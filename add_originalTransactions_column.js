import database from './src/config/database.js';

const sequelize = database.getSequelize();

async function addOriginalTransactionsColumn() {
    console.log('🔧 Adding originalTransactions column to documents table...');
    
    try {
        await sequelize.authenticate();
        console.log('✅ Database connected');
        
        // Check if column already exists
        const [columns] = await sequelize.query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = 'stamentai' 
            AND TABLE_NAME = 'documents' 
            AND COLUMN_NAME = 'originalTransactions'
        `);
        
        if (columns.length > 0) {
            console.log('✅ Column originalTransactions already exists');
        } else {
            // Add the column
            await sequelize.query(`
                ALTER TABLE documents 
                ADD COLUMN originalTransactions JSON NULL 
                COMMENT 'Original transactions data from PDF processing'
            `);
            console.log('✅ Column originalTransactions added successfully');
        }
        
        // Verify the column was added
        const [verify] = await sequelize.query(`
            SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_COMMENT
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = 'stamentai' 
            AND TABLE_NAME = 'documents' 
            AND COLUMN_NAME = 'originalTransactions'
        `);
        
        if (verify.length > 0) {
            console.log('📋 Column details:', verify[0]);
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await sequelize.close();
    }
}

addOriginalTransactionsColumn();