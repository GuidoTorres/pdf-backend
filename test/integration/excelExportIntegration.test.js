import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import ExcelJS from 'exceljs';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Import services and routes
import documentRoutes from '../../src/routes/documentRoutes.js';
import excelExportService from '../../src/services/excelExportService.js';
import databaseService from '../../src/services/databaseService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

describe('Excel Export Integration Tests', () => {
  let app;
  let testOutputDir;

  beforeEach(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/documents', documentRoutes);

    // Create test output directory
    testOutputDir = path.join(__dirname, 'test-output');
    try {
      await fs.mkdir(testOutputDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }

    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up test files
    try {
      const files = await fs.readdir(testOutputDir);
      for (const file of files) {
        await fs.unlink(path.join(testOutputDir, file));
      }
    } catch (error) {
      // Ignore cleanup errors
    }
    
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

      databaseService.getDocumentById.mockResolvedValue(bcpDocument);

      const response = await request(app)
        .get('/api/documents/bcp-doc/export/excel')
        .expect(200);

      // Verify Excel file structure
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(response.body);

      // Should have transaction sheet with BCP column names
      const transactionSheet = workbook.worksheets[0];
      const headerRow = transactionSheet.getRow(1);
      const headers = [];
      headerRow.eachCell(cell => headers.push(cell.value));

      expect(headers).toContain('Fecha');
      expect(headers).toContain('Concepto');
      expect(headers).toContain('Debe');
      expect(headers).toContain('Haber');
      expect(headers).toContain('Saldo');

      // Verify data preservation
      const dataRow = transactionSheet.getRow(2);
      const values = [];
      dataRow.eachCell(cell => values.push(cell.value));

      expect(values).toContain('10/01/2025');
      expect(values).toContain('Retiro ATM');
      expect(values).toContain('150.00');

      // Save for manual inspection
      const filePath = path.join(testOutputDir, 'bcp_export_test.xlsx');
      await fs.writeFile(filePath, response.body);
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

      databaseService.getDocumentById.mockResolvedValue(bbvaDocument);

      const response = await request(app)
        .get('/api/documents/bbva-doc/export/excel')
        .expect(200);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(response.body);

      const transactionSheet = workbook.worksheets[0];
      const headerRow = transactionSheet.getRow(1);
      const headers = [];
      headerRow.eachCell(cell => headers.push(cell.value));

      expect(headers).toContain('Fecha Operación');
      expect(headers).toContain('Descripción');
      expect(headers).toContain('Importe');
      expect(headers).toContain('Saldo Disponible');

      // Save for manual inspection
      const filePath = path.join(testOutputDir, 'bbva_export_test.xlsx');
      await fs.writeFile(filePath, response.body);
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
        column_mappings: [
          {
            tableId: 'table1',
            columnMappings: [
              { originalName: 'Fecha', normalizedName: 'date', standardType: 'date' },
              { originalName: 'Concepto', normalizedName: 'description', standardType: 'text' }
            ]
          },
          {
            tableId: 'table2',
            columnMappings: [
              { originalName: 'Date', normalizedName: 'date', standardType: 'date' },
              { originalName: 'Description', normalizedName: 'description', standardType: 'text' }
            ]
          }
        ],
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

      databaseService.getDocumentById.mockResolvedValue(multiTableDocument);

      const response = await request(app)
        .get('/api/documents/multi-table-doc/export/excel')
        .expect(200);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(response.body);

      // Should have multiple sheets for different structures
      expect(workbook.worksheets.length).toBeGreaterThanOrEqual(2);

      // Check for summary sheet
      const summarySheet = workbook.getWorksheet('Summary');
      expect(summarySheet).toBeDefined();

      // Save for manual inspection
      const filePath = path.join(testOutputDir, 'multi_table_export_test.xlsx');
      await fs.writeFile(filePath, response.body);
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

      databaseService.getDocumentById.mockResolvedValue(testDocument);

      const response = await request(app)
        .get('/api/documents/integrity-test-doc/export/excel')
        .expect(200);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(response.body);

      const transactionSheet = workbook.worksheets[0];

      // Verify each transaction's original data is preserved exactly
      const tx1Row = transactionSheet.getRow(2);
      const tx2Row = transactionSheet.getRow(3);

      // Check that original formatting is preserved
      let tx1Values = [];
      let tx2Values = [];
      
      tx1Row.eachCell(cell => tx1Values.push(cell.value));
      tx2Row.eachCell(cell => tx2Values.push(cell.value));

      // Verify original data preservation
      expect(tx1Values).toContain('10/01/2025');
      expect(tx1Values).toContain('Test Transaction 1 - ATM Withdrawal');
      expect(tx1Values).toContain('-$150.75');
      expect(tx1Values).toContain('$1,849.25');

      expect(tx2Values).toContain('12/01/2025');
      expect(tx2Values).toContain('Test Transaction 2 - Deposit');
      expect(tx2Values).toContain('+$500.00');
      expect(tx2Values).toContain('$2,349.25');

      // Save for manual inspection
      const filePath = path.join(testOutputDir, 'integrity_verification_test.xlsx');
      await fs.writeFile(filePath, response.body);
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

      databaseService.getDocumentById.mockResolvedValue(specialCharsDocument);

      const response = await request(app)
        .get('/api/documents/special-chars-doc/export/excel')
        .expect(200);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(response.body);

      const transactionSheet = workbook.worksheets[0];
      const dataRow = transactionSheet.getRow(2);
      const values = [];
      dataRow.eachCell(cell => values.push(cell.value));

      // Verify special characters are preserved
      expect(values.some(val => val && val.includes('Café & Té S.A.'))).toBe(true);
      expect(values.some(val => val && val.includes('REF#12345-ABC/2025'))).toBe(true);
      expect(values.some(val => val && val.includes('S/. 100.00'))).toBe(true);
      expect(values.some(val => val && val.includes('Comisión: 2.5% + IGV'))).toBe(true);

      // Save for manual inspection
      const filePath = path.join(testOutputDir, 'special_chars_test.xlsx');
      await fs.writeFile(filePath, response.body);
    });
  });

  describe('Download Functionality and File Integrity - Requirement 3.3', () => {
    it('should provide correct download headers and valid Excel file', async () => {
      const downloadDocument = createMockDocument({
        original_file_name: 'bank_statement_january_2025.pdf'
      });

      databaseService.getDocumentById.mockResolvedValue(downloadDocument);

      const response = await request(app)
        .get('/api/documents/download-test-doc/export/excel')
        .expect(200);

      // Verify download headers
      expect(response.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(response.headers['content-disposition']).toMatch(/attachment; filename="bank_statement_january_2025_export_\d{4}-\d{2}-\d{2}\.xlsx"/);
      expect(response.headers['content-length']).toBeDefined();

      // Verify file integrity by reading it back
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(response.body);

      expect(workbook.worksheets.length).toBeGreaterThan(0);

      // Verify file can be saved and read again
      const filePath = path.join(testOutputDir, 'download_integrity_test.xlsx');
      await fs.writeFile(filePath, response.body);

      // Read the saved file to verify integrity
      const savedWorkbook = new ExcelJS.Workbook();
      await savedWorkbook.xlsx.readFile(filePath);

      expect(savedWorkbook.worksheets.length).toBe(workbook.worksheets.length);
    });

    it('should handle large files without corruption', async () => {
      // Create document with many transactions
      const largeTransactions = [];
      for (let i = 1; i <= 1000; i++) {
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

      databaseService.getDocumentById.mockResolvedValue(largeDocument);

      const response = await request(app)
        .get('/api/documents/large-file-doc/export/excel')
        .expect(200);

      // Verify large file integrity
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(response.body);

      const transactionSheet = workbook.worksheets[0];
      expect(transactionSheet.rowCount).toBeGreaterThan(1000); // Headers + 1000 transactions

      // Save large file for manual inspection
      const filePath = path.join(testOutputDir, 'large_file_test.xlsx');
      await fs.writeFile(filePath, response.body);

      // Verify file size is reasonable (not corrupted)
      const stats = await fs.stat(filePath);
      expect(stats.size).toBeGreaterThan(50000); // Should be substantial for 1000 transactions
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

      databaseService.getDocumentById.mockResolvedValue(documentWithoutOriginalData);

      const response = await request(app)
        .get('/api/documents/no-original-data-doc/export/excel')
        .expect(200);

      // Should still generate Excel file
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(response.body);

      expect(workbook.worksheets.length).toBeGreaterThan(0);

      // Save for manual inspection
      const filePath = path.join(testOutputDir, 'no_original_data_test.xlsx');
      await fs.writeFile(filePath, response.body);
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

      databaseService.getDocumentById.mockResolvedValue(documentWithCorruptedStructure);

      const response = await request(app)
        .get('/api/documents/corrupted-structure-doc/export/excel')
        .expect(200);

      // Should still generate Excel file with fallback structure
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(response.body);

      expect(workbook.worksheets.length).toBeGreaterThan(0);

      // Save for manual inspection
      const filePath = path.join(testOutputDir, 'corrupted_structure_test.xlsx');
      await fs.writeFile(filePath, response.body);
    });

    it('should handle Excel generation service errors', async () => {
      const testDocument = createMockDocument({});

      databaseService.getDocumentById.mockResolvedValue(testDocument);

      // Mock Excel service to throw error
      const originalGenerateExcel = excelExportService.generateExcel;
      excelExportService.generateExcel = vi.fn().mockRejectedValue(new Error('Excel generation failed'));

      const response = await request(app)
        .get('/api/documents/excel-error-doc/export/excel')
        .expect(500);

      expect(response.body).toEqual({
        error: 'Export failed',
        message: 'An error occurred while generating the Excel file. Please try again later.',
        details: undefined
      });

      // Restore original function
      excelExportService.generateExcel = originalGenerateExcel;
    });

    it('should handle database connection errors during export', async () => {
      databaseService.getDocumentById.mockRejectedValue(new Error('Database connection timeout'));

      const response = await request(app)
        .get('/api/documents/db-error-doc/export/excel')
        .expect(500);

      expect(response.body).toEqual({
        error: 'Export failed',
        message: 'An error occurred while generating the Excel file. Please try again later.',
        details: undefined
      });
    });
  });

  describe('Performance and Scalability Tests', () => {
    it('should handle export within reasonable time limits', async () => {
      const performanceDocument = createMockDocument({
        transactions: Array.from({ length: 500 }, (_, i) => ({
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

      databaseService.getDocumentById.mockResolvedValue(performanceDocument);

      const startTime = Date.now();
      
      const response = await request(app)
        .get('/api/documents/performance-doc/export/excel')
        .expect(200);

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      // Should complete within 10 seconds for 500 transactions
      expect(processingTime).toBeLessThan(10000);

      // Verify file was generated correctly
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(response.body);

      expect(workbook.worksheets.length).toBeGreaterThan(0);

      // Save for manual inspection
      const filePath = path.join(testOutputDir, 'performance_test.xlsx');
      await fs.writeFile(filePath, response.body);

      console.log(`Performance test completed in ${processingTime}ms for 500 transactions`);
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
