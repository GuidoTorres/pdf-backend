/**
 * Transaction Extractor Integration Service
 * 
 * This service provides integration between the Node.js backend and the
 * Python Transaction Extractor Service, handling different input formats
 * and providing consistent error handling.
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import logService from './logService.js';

class TransactionExtractorIntegration {
  constructor() {
    this.pythonPath = 'python3';
    this.extractorPath = path.join(process.cwd(), 'transaction_extractor_service.py');
    this.timeout = 300000; // 5 minutes timeout
  }

  /**
   * Extract transactions from table data
   * @param {Array} tables - Array of table data (from camelot or similar)
   * @param {Object} options - Extraction options
   * @returns {Promise<Object>} Extraction result
   */
  async extractFromTables(tables, options = {}) {
    const startTime = Date.now();
    
    try {
      console.log(`[TransactionExtractorIntegration] Extracting from ${tables.length} tables`);
      
      // Prepare input data
      const inputData = {
        method: 'tables',
        tables: tables,
        debug: options.debug || false,
        config_path: options.configPath || null
      };
      
      // Call Python service
      const result = await this._callPythonService(inputData);
      
      const processingTime = Date.now() - startTime;
      console.log(`[TransactionExtractorIntegration] Table extraction completed in ${processingTime}ms`);
      
      return {
        success: result.success,
        transactions: result.transactions || [],
        method: result.method || 'table_based',
        metadata: {
          ...result.metadata,
          integration_processing_time: processingTime,
          tables_processed: tables.length
        },
        processing_time: result.processing_time || 0,
        error_message: result.error_message,
        provider: 'groq_transaction_extractor'
      };
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`[TransactionExtractorIntegration] Table extraction failed:`, error.message);
      
      logService.log(`[TransactionExtractor] Table extraction failed: ${JSON.stringify({ 
        error: error.message,
        tables_count: tables.length,
        processing_time: processingTime
      })}`);
      
      return {
        success: false,
        transactions: [],
        method: 'table_based',
        metadata: {
          error: error.message,
          integration_processing_time: processingTime,
          tables_processed: tables.length
        },
        processing_time: processingTime,
        error_message: error.message,
        provider: 'groq_transaction_extractor'
      };
    }
  }

  /**
   * Extract transactions from text content
   * @param {string} text - Raw text content
   * @param {Object} options - Extraction options
   * @returns {Promise<Object>} Extraction result
   */
  async extractFromText(text, options = {}) {
    const startTime = Date.now();
    
    try {
      console.log(`[TransactionExtractorIntegration] Extracting from text (${text.length} characters)`);
      
      // Prepare input data
      const inputData = {
        method: 'text',
        text: text,
        debug: options.debug || false,
        config_path: options.configPath || null
      };
      
      // Call Python service
      const result = await this._callPythonService(inputData);
      
      const processingTime = Date.now() - startTime;
      console.log(`[TransactionExtractorIntegration] Text extraction completed in ${processingTime}ms`);
      
      return {
        success: result.success,
        transactions: result.transactions || [],
        method: result.method || 'text_based',
        metadata: {
          ...result.metadata,
          integration_processing_time: processingTime,
          text_length: text.length
        },
        processing_time: result.processing_time || 0,
        error_message: result.error_message,
        provider: 'groq_transaction_extractor'
      };
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`[TransactionExtractorIntegration] Text extraction failed:`, error.message);
      
      logService.log(`[TransactionExtractor] Text extraction failed: ${JSON.stringify({ 
        error: error.message,
        text_length: text.length,
        processing_time: processingTime
      })}`);
      
      return {
        success: false,
        transactions: [],
        method: 'text_based',
        metadata: {
          error: error.message,
          integration_processing_time: processingTime,
          text_length: text.length
        },
        processing_time: processingTime,
        error_message: error.message,
        provider: 'groq_transaction_extractor'
      };
    }
  }

  /**
   * Detect column structure in table data
   * @param {Array} tables - Array of table data
   * @param {Object} options - Detection options
   * @returns {Promise<Object>} Column structure information
   */
  async detectColumnStructure(tables, options = {}) {
    try {
      console.log(`[TransactionExtractorIntegration] Detecting column structure for ${tables.length} tables`);
      
      const inputData = {
        method: 'detect_columns',
        tables: tables,
        debug: options.debug || false
      };
      
      const result = await this._callPythonService(inputData);
      
      return {
        success: true,
        column_structure: result.column_structure || {},
        metadata: result.metadata || {}
      };
      
    } catch (error) {
      console.error(`[TransactionExtractorIntegration] Column detection failed:`, error.message);
      
      return {
        success: false,
        column_structure: {},
        metadata: { error: error.message }
      };
    }
  }

  /**
   * Call the Python Transaction Extractor Service
   * @private
   * @param {Object} inputData - Input data for the service
   * @returns {Promise<Object>} Service response
   */
  async _callPythonService(inputData) {
    return new Promise((resolve, reject) => {
      const pythonProcess = spawn(this.pythonPath, [this.extractorPath, '--json'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: this.timeout
      });

      let stdout = '';
      let stderr = '';
      let resultFound = false;

      // Send input data
      pythonProcess.stdin.write(JSON.stringify(inputData));
      pythonProcess.stdin.end();

      // Collect stdout
      pythonProcess.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        
        // Look for result markers (matching existing pattern)
        if (output.includes('___RESULT_START___')) {
          resultFound = true;
        }
        
        // Log progress updates
        if (output.includes('🤖') || output.includes('✅') || output.includes('❌')) {
          console.log(`[TransactionExtractor] ${output.trim()}`);
        }
      });

      // Collect stderr
      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Handle process completion
      pythonProcess.on('close', (code) => {
        if (code === 0) {
          try {
            // Parse result from stdout
            let result;
            
            if (resultFound) {
              // Extract result between markers
              const startMarker = '___RESULT_START___';
              const endMarker = '___RESULT_END___';
              const startIndex = stdout.indexOf(startMarker);
              const endIndex = stdout.indexOf(endMarker);
              
              if (startIndex !== -1 && endIndex !== -1) {
                const resultJson = stdout.substring(startIndex + startMarker.length, endIndex).trim();
                result = JSON.parse(resultJson);
              } else {
                throw new Error('Result markers not found in output');
              }
            } else {
              // Try to parse entire stdout as JSON
              result = JSON.parse(stdout.trim());
            }
            
            resolve(result);
          } catch (parseError) {
            console.error('[TransactionExtractorIntegration] Failed to parse Python service response:', parseError.message);
            console.error('[TransactionExtractorIntegration] Raw stdout:', stdout);
            console.error('[TransactionExtractorIntegration] Raw stderr:', stderr);
            
            reject(new Error(`Failed to parse service response: ${parseError.message}`));
          }
        } else {
          console.error(`[TransactionExtractorIntegration] Python service exited with code ${code}`);
          console.error(`[TransactionExtractorIntegration] stderr: ${stderr}`);
          
          reject(new Error(`Python service failed with exit code ${code}: ${stderr}`));
        }
      });

      // Handle process errors
      pythonProcess.on('error', (error) => {
        console.error('[TransactionExtractorIntegration] Failed to start Python service:', error.message);
        reject(new Error(`Failed to start Python service: ${error.message}`));
      });

      // Handle timeout
      setTimeout(() => {
        if (!pythonProcess.killed) {
          pythonProcess.kill('SIGTERM');
          reject(new Error('Python service timeout'));
        }
      }, this.timeout);
    });
  }

  /**
   * Check if the Python service is available
   * @returns {Promise<boolean>} True if service is available
   */
  async checkServiceAvailability() {
    try {
      // Check if Python is available
      const pythonCheck = spawn(this.pythonPath, ['--version'], { stdio: 'pipe' });
      
      return new Promise((resolve) => {
        pythonCheck.on('close', (code) => {
          if (code === 0) {
            // Check if the extractor service file exists
            fs.access(this.extractorPath)
              .then(() => resolve(true))
              .catch(() => resolve(false));
          } else {
            resolve(false);
          }
        });
        
        pythonCheck.on('error', () => resolve(false));
      });
      
    } catch (error) {
      console.error('[TransactionExtractorIntegration] Service availability check failed:', error.message);
      return false;
    }
  }

  /**
   * Get service status and configuration
   * @returns {Promise<Object>} Service status information
   */
  async getServiceStatus() {
    try {
      const isAvailable = await this.checkServiceAvailability();
      
      return {
        available: isAvailable,
        python_path: this.pythonPath,
        extractor_path: this.extractorPath,
        timeout: this.timeout,
        groq_api_configured: !!process.env.GROQ_API_KEY
      };
      
    } catch (error) {
      return {
        available: false,
        error: error.message,
        python_path: this.pythonPath,
        extractor_path: this.extractorPath
      };
    }
  }
}

export default new TransactionExtractorIntegration();