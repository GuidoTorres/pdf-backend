import database from './src/config/database.js';

const sequelize = database.getSequelize();

async function checkOriginalTransactions() {
    console.log('🔍 Checking documents for originalTransactions...');
    
    try {
        // Connect to database
        await sequelize.authenticate();
        console.log('✅ Database connected');
        
        // Query recent documents
        const [results] = await sequelize.query(`
            SELECT 
                id,
                job_id,
                original_file_name,
                status,
                JSON_LENGTH(transactions) as transaction_count,
                JSON_LENGTH(original_transactions) as original_count,
                created_at
            FROM documents 
            ORDER BY created_at DESC 
            LIMIT 10
        `);
        
        console.log('📊 Recent documents:');
        results.forEach(doc => {
            console.log(`  - ${doc.original_file_name} [${doc.status}]:`);
            console.log(`    Transactions: ${doc.transaction_count || 0}`);
            console.log(`    OriginalTransactions: ${doc.original_count || 0}`);
            console.log(`    Created: ${doc.created_at}`);
            console.log('');
        });
        
        // Check if any documents have originalTransactions
        const [withOriginalCount] = await sequelize.query(`
            SELECT COUNT(*) as count 
            FROM documents 
            WHERE original_transactions IS NOT NULL 
            AND JSON_LENGTH(original_transactions) > 0
        `);
        
        console.log(`📈 Documents with originalTransactions: ${withOriginalCount[0].count}`);
        
        // Get details of documents with originalTransactions
        if (withOriginalCount[0].count > 0) {
            const [documentsWithOriginal] = await sequelize.query(`
                SELECT 
                    id,
                    job_id,
                    original_file_name,
                    JSON_LENGTH(original_transactions) as original_count,
                    created_at
                FROM documents 
                WHERE original_transactions IS NOT NULL 
                AND JSON_LENGTH(original_transactions) > 0
                ORDER BY created_at DESC
                LIMIT 3
            `);
            
            console.log('✅ Documents with originalTransactions:');
            documentsWithOriginal.forEach(doc => {
                console.log(`  - ${doc.original_file_name}: ${doc.original_count} original records`);
            });
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await sequelize.close();
    }
}

checkOriginalTransactions();