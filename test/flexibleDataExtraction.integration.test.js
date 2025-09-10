import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import databaseService from '../src/services/databaseService.js';
import { updateDocumentWithEnhancedData } from '../src/controllers/documentController.js';

describe('Flexible Data Extraction API Integration Tests', () => {
  let testUser;
  let testDocument;
  let authToken;

  beforeEach(async () => {
    // Create test user
    testUser = await databaseService.createUser({
      email: 'test@example.com',
      password: 'testpassword',
      plan: 'pro'
    });

    // Create auth token (mock implementation)
    authToken = 'test-auth-token';

    // Create test document with flexible extraction data
    testDocument = await databaseService.createDocument({
      user_id: testUser.id,
      job_id: 'test-job-123',
      original_file_name: 'test-extract.pdf',
      status: 'completed',
      progress: 100,
      step: 'Completed',
      transactions: JSON.stringify([
        {
          id: '1',
          date: '2025-01-15',
          description: 'ATM Withdrawal',
          amount: -150.00,
          type: 'debit',
          originalData: {
            'Fecha Operación': '15/01/2025',
            'Concepto': 'Retiro ATM',
            'Debe': '150.00',
            'Haber': '',
            'Saldo Disponible': '1,850.00'
          },
          transformationMetadata: {
            sourceColumns: ['Fecha Operación', 'Concepto', 'Debe', 'Saldo Disponible'],
            transformationRules: ['date_normalization', 'amount_sign_detection'],
            confidence: 0.95,
            preservationFlags: {
              originalFormatPreserved: true,
              dataTypesPreserved: true,
              allColumnsIncluded: true
            }
          }
        },
        {
          id: '2',
          date: '2025-01-16',
          description: 'Deposit',
          amount: 500.00,
          type: 'credit',
          originalData: {
            'Fecha Operación': '16/01/2025',
            'Concepto': 'Depósito',
            'Debe': '',
            'Haber': '500.00',
            'Saldo Disponible': '2,350.00'
          },
          transformationMetadata: {
            sourceColumns: ['Fecha Operación', 'Concepto', 'Haber', 'Saldo Disponible'],
            transformationRules: ['date_normalization', 'amount_sign_detection'],
            confidence: 0.98,
            preservationFlags: {
              originalFormatPreserved: true,
              dataTypesPreserved: true,
              allColumnsIncluded: true
            }
          }
        }
      ]),
      metadata: JSON.stringify({
        pageCount: 1,
        processingTime: 2.5,
        extractionMethod: 'flexible'
      }),
      original_structure: {
        tableStructures: [{
          columnCount: 5,
          originalColumnNames: ['Fecha Operación', 'Concepto', 'Debe', 'Haber', 'Saldo Disponible'],
          normalizedColumnNames: ['date', 'description', 'debit', 'credit', 'balance'],
          columnTypes: ['date', 'text', 'currency', 'currency', 'currency'],
          dataPatterns: ['dd/mm/yyyy', 'text', 'decimal', 'decimal', 'decimal'],
          uniqueIdentifiers: { tableId: 'main-transactions' }
        }],
        confidence: 0.92,
        originalHeaders: ['Fecha Operación', 'Concepto', 'Debe', 'Haber', 'Saldo Disponible']
      },
      column_mappings: [{
        tableId: 'main-transactions',
        columnMappings: [
          {
            originalName: 'Fecha Operación',
            normalizedName: 'date',
            standardType: 'date',
            preserveOriginal: true
          },
          {
            originalName: 'Concepto',
            normalizedName: 'description',
            standardType: 'text',
            preserveOriginal: true
          },
          {
            originalName: 'Debe',
            normalizedName: 'debit',
            standardType: 'currency',
            preserveOriginal: true
          },
          {
            originalName: 'Haber',
            normalizedName: 'credit',
            standardType: 'currency',
            preserveOriginal: true
          },
          {
            originalName: 'Saldo Disponible',
            normalizedName: 'balance',
            standardType: 'currency',
            preserveOriginal: true
          }
        ]
      }],
      extract_type: 'bank_statement',
      bank_type: 'bcp',
      format_version: 'v2.1',
      preservation_metadata: {
        extractionTimestamp: new Date().toISOString(),
        originalColumnCount: 5,
        detectedTables: 1,
        confidenceScore: 0.92,
        preservationStrategy: 'full_structure'
      }
    });
  });

  afterEach(async () => {
    // Cleanup test data
    if (testDocument) {
      await databaseService.deleteDocument(testDocument.job_id);
    }
    if (testUser) {
      await databaseService.deleteUser(testUser.id);
    }
  });

  describe('GET /api/documents/:jobId/status', () => {
    it('should return enhanced API response with flexible data structure', async () => {
      const response = await request(app)
        .get(`/api/documents/${testDocument.job_id}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Verify basic response structure
      expect(response.body).toHaveProperty('jobId', testDocument.job_id);
      expect(response.body).toHaveProperty('state', 'completed');
      expect(response.body).toHaveProperty('preservedData', true);

      // Verify result contains both normalized and original transactions
      expect(response.body.result).toHaveProperty('transactions');
      expect(response.body.result).toHaveProperty('originalTransactions');
      expect(response.body.result.transactions).toHaveLength(2);
      expect(response.body.result.originalTransactions).toHaveLength(2);

      // Verify original structure metadata
      expect(response.body.result).toHaveProperty('originalStructure');
      expect(response.body.result.originalStructure).toHaveProperty('tableStructures');
      expect(response.body.result.originalStructure.tableStructures[0]).toHaveProperty('originalColumnNames');
      expect(response.body.result.originalStructure.tableStructures[0].originalColumnNames).toEqual([
        'Fecha Operación', 'Concepto', 'Debe', 'Haber', 'Saldo Disponible'
      ]);

      // Verify column metadata
      expect(response.body.result).toHaveProperty('columnMetadata');
      expect(response.body.result.columnMetadata).toHaveLength(1);
      expect(response.body.result.columnMetadata[0]).toHaveProperty('columnMappings');
      expect(response.body.result.columnMetadata[0].columnMappings).toHaveLength(5);

      // Verify extract classification
      expect(response.body.result).toHaveProperty('extractType', 'bank_statement');
      expect(response.body.result).toHaveProperty('bankType', 'bcp');
      expect(response.body.result).toHaveProperty('formatVersion', 'v2.1');

      // Verify preservation metadata
      expect(response.body.result).toHaveProperty('preservationMetadata');
      expect(response.body.result.preservationMetadata).toHaveProperty('originalColumnCount', 5);
      expect(response.body.result.preservationMetadata).toHaveProperty('detectedTables', 1);
    });

    it('should return original transactions with preserved structure', async () => {
      const response = await request(app)
        .get(`/api/documents/${testDocument.job_id}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const originalTransactions = response.body.result.originalTransactions;
      
      // Verify first original transaction
      expect(originalTransactions[0]).toHaveProperty('Fecha Operación', '15/01/2025');
      expect(originalTransactions[0]).toHaveProperty('Concepto', 'Retiro ATM');
      expect(originalTransactions[0]).toHaveProperty('Debe', '150.00');
      expect(originalTransactions[0]).toHaveProperty('Haber', '');
      expect(originalTransactions[0]).toHaveProperty('Saldo Disponible', '1,850.00');

      // Verify transformation metadata
      expect(originalTransactions[0]).toHaveProperty('_transformationMetadata');
      expect(originalTransactions[0]._transformationMetadata).toHaveProperty('confidence', 0.95);
      expect(originalTransactions[0]._transformationMetadata.preservationFlags).toHaveProperty('originalFormatPreserved', true);

      // Verify second original transaction
      expect(originalTransactions[1]).toHaveProperty('Fecha Operación', '16/01/2025');
      expect(originalTransactions[1]).toHaveProperty('Concepto', 'Depósito');
      expect(originalTransactions[1]).toHaveProperty('Debe', '');
      expect(originalTransactions[1]).toHaveProperty('Haber', '500.00');
      expect(originalTransactions[1]).toHaveProperty('Saldo Disponible', '2,350.00');
    });

    it('should maintain backward compatibility with existing API consumers', async () => {
      const response = await request(app)
        .get(`/api/documents/${testDocument.job_id}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Verify existing fields are still present
      expect(response.body).toHaveProperty('jobId');
      expect(response.body).toHaveProperty('state');
      expect(response.body).toHaveProperty('progress');
      expect(response.body).toHaveProperty('result');
      expect(response.body.result).toHaveProperty('transactions');
      expect(response.body.result).toHaveProperty('meta');

      // Verify normalized transactions still have expected structure
      const transactions = response.body.result.transactions;
      expect(transactions[0]).toHaveProperty('id');
      expect(transactions[0]).toHaveProperty('date');
      expect(transactions[0]).toHaveProperty('description');
      expect(transactions[0]).toHaveProperty('amount');
      expect(transactions[0]).toHaveProperty('type');
    });

    it('should handle documents without original structure gracefully', async () => {
      // Create document without flexible extraction data
      const legacyDocument = await databaseService.createDocument({
        user_id: testUser.id,
        job_id: 'legacy-job-456',
        original_file_name: 'legacy-extract.pdf',
        status: 'completed',
        progress: 100,
        step: 'Completed',
        transactions: JSON.stringify([
          {
            id: '1',
            date: '2025-01-15',
            description: 'ATM Withdrawal',
            amount: -150.00,
            type: 'debit'
          }
        ]),
        metadata: JSON.stringify({
          pageCount: 1,
          processingTime: 2.5
        })
      });

      const response = await request(app)
        .get(`/api/documents/${legacyDocument.job_id}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Verify preservedData flag is false
      expect(response.body).toHaveProperty('preservedData', false);

      // Verify originalTransactions is null
      expect(response.body.result).toHaveProperty('originalTransactions', null);

      // Verify flexible extraction fields are null
      expect(response.body.result).toHaveProperty('originalStructure', null);
      expect(response.body.result).toHaveProperty('columnMetadata', null);
      expect(response.body.result).toHaveProperty('extractType', null);
      expect(response.body.result).toHaveProperty('bankType', null);

      // Verify normalized transactions still work
      expect(response.body.result).toHaveProperty('transactions');
      expect(response.body.result.transactions).toHaveLength(1);

      // Cleanup
      await databaseService.deleteDocument(legacyDocument.job_id);
    });
  });

  describe('GET /api/documents/history', () => {
    it('should return enhanced history with flexible data structure', async () => {
      const response = await request(app)
        .get('/api/documents/history')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveLength(1);

      const document = response.body.data[0];
      
      // Verify enhanced fields are present
      expect(document).toHaveProperty('transactions');
      expect(document).toHaveProperty('originalTransactions');
      expect(document).toHaveProperty('originalStructure');
      expect(document).toHaveProperty('columnMetadata');
      expect(document).toHaveProperty('extractType', 'bank_statement');
      expect(document).toHaveProperty('bankType', 'bcp');
      expect(document).toHaveProperty('preservedData', true);
    });
  });

  describe('updateDocumentWithEnhancedData function', () => {
    it('should update document with flexible extraction data', async () => {
      const enhancedData = {
        transactions: [
          {
            id: '1',
            date: '2025-01-17',
            description: 'Test Transaction',
            amount: 100.00,
            type: 'credit'
          }
        ],
        metadata: {
          pageCount: 1,
          processingTime: 1.5
        },
        amountSignData: {
          original_credit: 100.00,
          sign_detection_method: 'columns'
        },
        flexibleExtractionData: {
          original_structure: {
            tableStructures: [{
              columnCount: 3,
              originalColumnNames: ['Date', 'Description', 'Amount']
            }]
          },
          column_mappings: [{
            tableId: 'test-table',
            columnMappings: [
              { originalName: 'Date', normalizedName: 'date' },
              { originalName: 'Description', normalizedName: 'description' },
              { originalName: 'Amount', normalizedName: 'amount' }
            ]
          }],
          extract_type: 'credit_card_statement',
          bank_type: 'bbva',
          format_version: 'v1.0',
          preservation_metadata: {
            extractionTimestamp: new Date().toISOString(),
            originalColumnCount: 3
          }
        }
      };

      const result = await updateDocumentWithEnhancedData(testDocument.job_id, enhancedData);
      expect(result).toBe(true);

      // Verify document was updated
      const updatedDocument = await databaseService.getDocument(testDocument.job_id);
      expect(updatedDocument.extract_type).toBe('credit_card_statement');
      expect(updatedDocument.bank_type).toBe('bbva');
      expect(updatedDocument.format_version).toBe('v1.0');
      expect(updatedDocument.original_structure).toBeDefined();
      expect(updatedDocument.column_mappings).toBeDefined();
      expect(updatedDocument.preservation_metadata).toBeDefined();
    });
  });
});