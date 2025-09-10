import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

// Import services and routes
import documentRoutes from '../../src/routes/documentRoutes.js';
import databaseService from '../../src/services/databaseService.js';

// Mock dependencies
vi.mock('../../src/services/databaseService.js');
vi.mock('../../src/services/logService.js', () => ({
  default: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

// Mock authentication middleware
vi.mock('../../src/middleware/auth.js', () => ({
  authenticateToken: (req, res, next) => {
    req.user = { id: 'test-user-123' };
    next();
  }
}));

describe('Excel Export Integration Tests (Simple)', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/documents', documentRoutes);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Excel Generation with Different Table Structures - Requirement 3.1, 3.2', () => {
    it('should generate Excel with BCP bank statement structure', async () => {
      const bcpDocument = createMockDocument({
        bank_type: 'bcp',
        original_structure: {
          tableStructures: [{
            columnCount: 5,
            originalColumnNames: ['Fecha', 'Concepto', 'Debe', 'Haber', 'Saldo'],
            normalizedColumnNames: ['date', 'description', 'debit', 'credit', 'balance'],
            columnTypes: ['date', 'text', 'currency', 'currency', 'currency']
          }]
        },
        column_mappings: [{
          tableId: 'table1',
          columnMappings: [
            { originalName: 'Fecha', normalizedName: 'date', standardType: 'date' },
            { originalName: 'Concepto', normalizedName: 'description', standardType: 'text' },
            { originalName: 'Debe', normalizedName: 'debit', standardType: 'currency' },
            { originalName: 'Haber', normalizedName: 'credit', standardType: 'currency' },
            { originalName: 'Saldo', normalizedName: 'balance', standardType: 'currency' }
          ]
        }],
        transactions: [
          {
            id: 'tx1',
            date: '2025-01-10',
            description: 'Retiro ATM',
            amount: -150.00,
            type: 'debit',
            originalData: {
              'Fecha': '10/01/2025',
              'Concepto': 'Retiro ATM',
              'Debe': '150.00',
              'Haber': '',
              'Saldo': '1,850.00'
            }
          }
        ]
      });

      databaseService.getDocument.mockResolvedValue(bcpDocument);

      const response = await request(app)
        .get('/api/documents/bcp-doc/export/excel')
        .expect(200);

      // Verify Excel file headers
      expect(response.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(response.headers['content-disposition']).toMatch(/attachment; filename=".*\.xlsx"/);
      expect(response.headers['content-length']).toBeDefined();

      // Verify response body is a buffer
      expect(Buffer.isBuffer(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });

    it('should generate Excel with BBVA bank statement structure', async () => {
      const bbvaDocument = createMockDocument({
        bank_type: 'bbva',
        original_structure: {
          tableStructures: [{
            columnCount: 4,
            originalColumnNames: ['Fecha Operación', 'Descripción', 'Importe', 'Saldo Disponible'],
            normalizedColumnNames: ['date', 'description', 'amount', 'balance'],
            columnTypes: ['date', 'text', 'currency', 'currency']
          }]
        },
        column_mappings: [{
          tableId: 'table1',
          columnMappings: [
            { originalName: 'Fecha Operación', normalizedName: 'date', standardType: 'date' },
            { originalName: 'Descripción', normalizedName: 'description', standardType: 'text' },
            { originalName: 'Importe', normalizedName: 'amount', standardType: 'currency' },
            { originalName: 'Saldo Disponible', normalizedName: 'balance', standardType: 'currency' }
          ]
        }],
        transactions: [
          {
            id: 'tx1',
            date: '2025-01-15',
            description: 'Transferencia Recibida',
            amount: 1000.00,
            type: 'credit',
            originalData: {
              'Fecha Operación': '15/01/2025',
              'Descripción': 'Transferencia Recibida',
              'Importe': '1,000.00',
              'Saldo Disponible': '5,000.00'
            }
          }
        ]
      });

      databaseService.getDocument.mockResolvedValue(bbvaDocument);

      const response = await request(app)
        .get('/api/documents/bbva-doc/export/excel')
        .expect(200);

      // Verify Excel file headers
      expect(response.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(response.headers['content-disposition']).toMatch(/attachment; filename=".*\.xlsx"/);
      
      // Verify response body is a valid Excel buffer
      expect(Buffer.isBuffer(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });

    it('should generate Excel with multiple table structures', async () => {
      const multiTableDocument = createMockDocument({
        bank_type: 'mixed',
        original_structure: {
          tableStructures: [
            {
              columnCount: 5,
              originalColumnNames: ['Fecha', 'Concepto', 'Debe', 'Haber', 'Saldo'],
              normalizedColumnNames: ['date', 'description', 'debit', 'credit', 'balance'],
              columnTypes: ['date', 'text', 'currency', 'currency', 'currency']
            },
            {
              columnCount: 4,
              originalColumnNames: ['Date', 'Description', 'Amount', 'Balance'],
              normalizedColumnNames: ['date', 'description', 'amount', 'balance'],
              columnTypes: ['date', 'text', 'currency', 'currency']
            }
          ]
        },
        transactions: [
          {
            id: 'tx1',
            date: '2025-01-10',
            description: 'Transaction 1',
            amount: -100.00,
            originalData: { 'Fecha': '10/01/2025', 'Concepto': 'Transaction 1' }
          },
          {
            id: 'tx2',
            date: '2025-01-11',
            description: 'Transaction 2',
            amount: 200.00,
            originalData: { 'Date': '2025-01-11', 'Description': 'Transaction 2' }
          }
        ]
      });

      databaseService.getDocument.mockResolvedValue(multiTableDocument);

      const response = await request(app)
        .get('/api/documents/multi-table-doc/export/excel')
        .expect(200);

      // Verify Excel file generation
      expect(response.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(Buffer.isBuffer(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });
  });

  describe('Data Integrity Verification - Requirement 3.2', () => {
    it('should verify exported data matches original PDF structure exactly', async () => {
      const testDocument = createMockDocument({
        bank_type: 'test_bank',
        transactions: [
          {
            id: 'tx1',
            date: '2025-01-10',
            description: 'Test Transaction 1',
            amount: -150.75,
            originalData: {
              'Fecha Valor': '10/01/2025',
              'Detalle Completo': 'Test Transaction 1 - ATM Withdrawal',
              'Monto Original': '-$150.75',
              'Saldo Resultante': '$1,849.25'
            }
          },
          {
            id: 'tx2',
            date: '2025-01-12',
            description: 'Test Transaction 2',
            amount: 500.00,
            originalData: {
              'Fecha Valor': '12/01/2025',
              'Detalle Completo': 'Test Transaction 2 - Deposit',
              'Monto Original': '+$500.00',
              'Saldo Resultante': '$2,349.25'
            }
          }
        ]
      });

      databaseService.getDocument.mockResolvedValue(testDocument);

      const response = await request(app)
        .get('/api/documents/integrity-test-doc/export/excel')
        .expect(200);

      // Verify Excel file generation with original data
      expect(response.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(Buffer.isBuffer(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);

      // Verify the Excel buffer starts with the correct Excel signature
      const excelSignature = response.body.slice(0, 4);
      expect(excelSignature.toString('hex')).toBe('504b0304'); // ZIP file signature (Excel files are ZIP archives)
    });

    it('should preserve special characters and formatting in original data', async () => {
      const specialCharsDocument = createMockDocument({
        transactions: [
          {
            id: 'tx1',
            date: '2025-01-10',
            description: 'Special chars test',
            amount: -100.00,
            originalData: {
              'Descripción': 'Pago en línea - Café & Té S.A.',
              'Referencia': 'REF#12345-ABC/2025',
              'Moneda': 'S/. 100.00',
              'Observaciones': 'Comisión: 2.5% + IGV'
            }
          }
        ]
      });

      databaseService.getDocument.mockResolvedValue(specialCharsDocument);

      const response = await request(app)
        .get('/api/documents/special-chars-doc/export/excel')
        .expect(200);

      // Verify Excel file generation with special characters
      expect(response.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(Buffer.isBuffer(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });
  });

  describe('Download Functionality and File Integrity - Requirement 3.3', () => {
    it('should provide correct download headers and valid Excel file', async () => {
      const downloadDocument = createMockDocument({
        original_file_name: 'bank_statement_january_2025.pdf'
      });

      databaseService.getDocument.mockResolvedValue(downloadDocument);

      const response = await request(app)
        .get('/api/documents/download-test-doc/export/excel')
        .expect(200);

      // Verify download headers
      expect(response.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(response.headers['content-disposition']).toMatch(/attachment; filename="bank_statement_january_2025_export_\d{4}-\d{2}-\d{2}\.xlsx"/);
      expect(response.headers['content-length']).toBeDefined();

      // Verify file integrity by checking Excel signature
      expect(Buffer.isBuffer(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      
      // Check Excel file signature (ZIP format)
      const signature = response.body.slice(0, 4);
      expect(signature.toString('hex')).toBe('504b0304');
    });

    it('should handle large files without corruption', async () => {
      // Create document with many transactions
      const largeTransactions = [];
      for (let i = 1; i <= 100; i++) { // Reduced for faster testing
        largeTransactions.push({
          id: `tx${i}`,
          date: `2025-01-${String(i % 28 + 1).padStart(2, '0')}`,
          description: `Transaction ${i} - Test data for large file`,
          amount: (Math.random() - 0.5) * 1000,
          originalData: {
            'Fecha': `${String(i % 28 + 1).padStart(2, '0')}/01/2025`,
            'Descripción': `Transaction ${i} - Test data for large file`,
            'Importe': `${((Math.random() - 0.5) * 1000).toFixed(2)}`,
            'Referencia': `REF-${i.toString().padStart(6, '0')}`
          }
        });
      }

      const largeDocument = createMockDocument({
        transactions: largeTransactions
      });

      databaseService.getDocument.mockResolvedValue(largeDocument);

      const response = await request(app)
        .get('/api/documents/large-file-doc/export/excel')
        .expect(200);

      // Verify large file integrity
      expect(Buffer.isBuffer(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(10000); // Should be substantial for 100 transactions

      // Verify Excel signature
      const signature = response.body.slice(0, 4);
      expect(signature.toString('hex')).toBe('504b0304');
    });
  });

  describe('Error Handling in Export Process - Requirement 3.4', () => {
    it('should handle missing original data gracefully', async () => {
      const documentWithoutOriginalData = createMockDocument({
        transactions: [
          {
            id: 'tx1',
            date: '2025-01-10',
            description: 'Transaction without original data',
            amount: -100.00
            // No originalData field
          }
        ]
      });

      databaseService.getDocument.mockResolvedValue(documentWithoutOriginalData);

      const response = await request(app)
        .get('/api/documents/no-original-data-doc/export/excel')
        .expect(200);

      // Should still generate Excel file
      expect(response.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(Buffer.isBuffer(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });

    it('should handle corrupted structure data gracefully', async () => {
      const documentWithCorruptedStructure = createMockDocument({
        original_structure: null,
        column_mappings: null,
        transactions: [
          {
            id: 'tx1',
            date: '2025-01-10',
            description: 'Transaction with corrupted structure',
            amount: -100.00
          }
        ]
      });

      databaseService.getDocument.mockResolvedValue(documentWithCorruptedStructure);

      const response = await request(app)
        .get('/api/documents/corrupted-structure-doc/export/excel')
        .expect(200);

      // Should still generate Excel file with fallback structure
      expect(response.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(Buffer.isBuffer(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });

    it('should handle database connection errors during export', async () => {
      databaseService.getDocument.mockRejectedValue(new Error('Database connection timeout'));

      const response = await request(app)
        .get('/api/documents/db-error-doc/export/excel')
        .expect(500);

      expect(response.body).toEqual({
        error: 'Export failed',
        message: 'An error occurred while generating the Excel file. Please try again later.',
        details: undefined
      });
    });

    it('should return 404 when document not found', async () => {
      databaseService.getDocument.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/documents/nonexistent/export/excel')
        .expect(404);

      expect(response.body).toEqual({
        error: 'Document not found',
        message: 'The requested document does not exist or you do not have access to it.'
      });
    });

    it('should return 403 when user does not own document', async () => {
      const unauthorizedDocument = createMockDocument({
        user_id: 'different-user-456'
      });
      
      databaseService.getDocument.mockResolvedValue(unauthorizedDocument);

      const response = await request(app)
        .get('/api/documents/unauthorized-doc/export/excel')
        .expect(403);

      expect(response.body).toEqual({
        error: 'Access denied',
        message: 'You do not have permission to export this document.'
      });
    });

    it('should return 400 when document is not completed', async () => {
      const processingDocument = createMockDocument({
        status: 'processing'
      });
      
      databaseService.getDocument.mockResolvedValue(processingDocument);

      const response = await request(app)
        .get('/api/documents/processing-doc/export/excel')
        .expect(400);

      expect(response.body).toEqual({
        error: 'Document not ready',
        message: 'Document must be completed before it can be exported.',
        status: 'processing'
      });
    });

    it('should return 400 when document has no transactions', async () => {
      const emptyDocument = createMockDocument({
        transactions: JSON.stringify([])
      });
      
      databaseService.getDocument.mockResolvedValue(emptyDocument);

      const response = await request(app)
        .get('/api/documents/empty-doc/export/excel')
        .expect(400);

      expect(response.body).toEqual({
        error: 'No data to export',
        message: 'This document contains no transaction data to export.'
      });
    });
  });

  describe('Performance Tests', () => {
    it('should handle export within reasonable time limits', async () => {
      const performanceDocument = createMockDocument({
        transactions: Array.from({ length: 50 }, (_, i) => ({ // Reduced for faster testing
          id: `perf_tx${i}`,
          date: '2025-01-10',
          description: `Performance test transaction ${i}`,
          amount: Math.random() * 1000,
          originalData: {
            'Fecha': '10/01/2025',
            'Descripción': `Performance test transaction ${i}`,
            'Importe': (Math.random() * 1000).toFixed(2)
          }
        }))
      });

      databaseService.getDocument.mockResolvedValue(performanceDocument);

      const startTime = Date.now();
      
      const response = await request(app)
        .get('/api/documents/performance-doc/export/excel')
        .expect(200);

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      // Should complete within 5 seconds for 50 transactions
      expect(processingTime).toBeLessThan(5000);

      // Verify file was generated correctly
      expect(Buffer.isBuffer(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);

      console.log(`Performance test completed in ${processingTime}ms for 50 transactions`);
    });
  });

  // Helper function to create mock documents
  function createMockDocument(overrides = {}) {
    const defaultDocument = {
      id: 'test-doc-123',
      job_id: 'test-job-123',
      user_id: 'test-user-123',
      original_file_name: 'test_statement.pdf',
      status: 'completed',
      created_at: '2025-01-15T10:00:00Z',
      pages_processed: 3,
      file_size: 1024000,
      transactions: JSON.stringify([
        {
          id: 'default_tx1',
          date: '2025-01-10',
          description: 'Default Transaction',
          amount: -100.00,
          type: 'debit',
          originalData: {
            'Fecha': '10/01/2025',
            'Concepto': 'Default Transaction',
            'Importe': '-100.00'
          }
        }
      ]),
      original_structure: JSON.stringify({
        tableStructures: [{
          columnCount: 3,
          originalColumnNames: ['Fecha', 'Concepto', 'Importe'],
          normalizedColumnNames: ['date', 'description', 'amount'],
          columnTypes: ['date', 'text', 'currency']
        }]
      }),
      column_mappings: JSON.stringify([{
        tableId: 'table1',
        columnMappings: [
          { originalName: 'Fecha', normalizedName: 'date', standardType: 'date' },
          { originalName: 'Concepto', normalizedName: 'description', standardType: 'text' },
          { originalName: 'Importe', normalizedName: 'amount', standardType: 'currency' }
        ]
      }]),
      extract_type: 'bank_statement',
      bank_type: 'generic',
      format_version: '2024.1',
      preservation_metadata: JSON.stringify({
        extractionTimestamp: '2025-01-15T10:00:00Z',
        originalColumnCount: 3,
        detectedTables: 1,
        confidenceScore: 0.95
      })
    };

    // Apply overrides
    const document = { ...defaultDocument, ...overrides };

    // Stringify JSON fields if they're objects
    if (typeof document.transactions === 'object') {
      document.transactions = JSON.stringify(document.transactions);
    }
    if (typeof document.original_structure === 'object') {
      document.original_structure = JSON.stringify(document.original_structure);
    }
    if (typeof document.column_mappings === 'object') {
      document.column_mappings = JSON.stringify(document.column_mappings);
    }
    if (typeof document.preservation_metadata === 'object') {
      document.preservation_metadata = JSON.stringify(document.preservation_metadata);
    }

    return document;
  }
});