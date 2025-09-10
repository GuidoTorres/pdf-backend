import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import databaseService from './src/services/databaseService.js';
import logService from './src/services/logService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pythonScriptPath = path.resolve(__dirname, './services/unified_pdf_processor.py');

// Test user ID (from the logs we saw)
const testUserId = '37cbe336-ba49-48a6-8342-0f08b403a4c7';
const testJobId = 'test-original-transactions-' + Date.now();
const pdfPath = path.resolve(__dirname, './pdf/extracto1.pdf');

async function testCompleteFlow() {
    console.log('🧪 Testing complete originalTransactions flow...');
    console.log(`📄 PDF: ${pdfPath}`);
    console.log(`👤 User: ${testUserId}`);
    console.log(`🏷️  Job: ${testJobId}`);

    try {
        // Step 1: Create document record (like jobProcessor does)
        console.log('\n📝 Step 1: Creating document record...');
        await databaseService.createDocument({
            job_id: testJobId,
            user_id: testUserId,
            original_file_name: 'extracto1.pdf',
            status: 'processing'
        });
        console.log('✅ Document record created');

        // Step 2: Process with Python (like jobProcessor does)
        console.log('\n🐍 Step 2: Processing with UnifiedPdfProcessor...');
        const result = await processWithUnifiedProcessor(pdfPath, testJobId);
        
        console.log('✅ Python processing completed');
        console.log(`📊 Results: ${result.transactions?.length || 0} transactions, ${result.originalTransactions?.length || 0} originalTransactions`);
        
        if (result.originalTransactions && result.originalTransactions.length > 0) {
            console.log(`📄 Sample original transaction: ${JSON.stringify(result.originalTransactions[0])}`);
        }

        // Step 3: Save results to database (testing our fixes)
        console.log('\n💾 Step 3: Saving results to database...');
        const updateData = {
            status: 'completed',
            progress: 100,
            transactions: result.transactions || [],
            metadata: result.meta || result.metadata || {},
            originalTransactions: result.originalTransactions || null  // THIS IS OUR FIX
        };
        
        await databaseService.updateDocument(testJobId, updateData);
        console.log('✅ Results saved to database');

        // Step 4: Verify database contains originalTransactions
        console.log('\n🔍 Step 4: Verifying database record...');
        const document = await databaseService.getDocumentByJobId(testJobId);
        
        if (document) {
            console.log(`📊 Database verification:`);
            console.log(`  - Status: ${document.status}`);
            console.log(`  - Transactions: ${document.transactions?.length || 0}`);
            console.log(`  - OriginalTransactions: ${document.originalTransactions?.length || 0}`);
            
            if (document.originalTransactions && document.originalTransactions.length > 0) {
                console.log('✅ SUCCESS! OriginalTransactions found in database');
                console.log(`📄 Sample original transaction from DB: ${JSON.stringify(document.originalTransactions[0])}`);
            } else {
                console.log('❌ FAILED! No originalTransactions found in database');
            }
        }

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
    }
}

function processWithUnifiedProcessor(pdfPath, jobId) {
    return new Promise((resolve, reject) => {
        console.log(`🐍 Starting UnifiedPdfProcessor for job ${jobId}...`);
        
        const env = {
            ...process.env,
            GROQ_API_KEY: process.env.GROQ_API_KEY,
        };
        
        const pythonProcess = spawn('python3', [pythonScriptPath, pdfPath, '--debug'], {
            env: env
        });
        
        let stdoutBuffer = '';
        let errorOutput = '';

        pythonProcess.stdout.on('data', (data) => {
            stdoutBuffer += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        pythonProcess.on('close', (code) => {
            if (code === 0) {
                console.log(`✅ Python processor completed successfully`);
                
                const resultStartMarker = '___RESULT_START___';
                const resultEndMarker = '___RESULT_END___';
                
                const startIndex = stdoutBuffer.indexOf(resultStartMarker);
                const endIndex = stdoutBuffer.indexOf(resultEndMarker);
                
                if (startIndex !== -1 && endIndex !== -1) {
                    const jsonStr = stdoutBuffer.substring(
                        startIndex + resultStartMarker.length,
                        endIndex
                    ).trim();
                    
                    try {
                        const result = JSON.parse(jsonStr);
                        resolve(result);
                    } catch (parseErr) {
                        reject(new Error(`Failed to parse result JSON: ${parseErr.message}`));
                    }
                } else {
                    reject(new Error('No result markers found in output'));
                }
            } else {
                reject(new Error(errorOutput || `Processor failed with exit code ${code}`));
            }
        });

        pythonProcess.on('error', (err) => {
            reject(new Error(`Failed to start processor: ${err.message}`));
        });
    });
}

testCompleteFlow();