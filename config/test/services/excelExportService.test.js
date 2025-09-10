import { describe, it, expect, beforeEach, vi } from 'vitest';
import excelExportService from '../../../src/services/excelExportService.js';
import ExcelJS from 'exceljs';

describe('ExcelExportService', () => {
  let mockDocument;
  let mockFlexibleData;

  beforeEach(() => {
    // Mock document with flexible extraction data
    mockDocument = {
      id: 'test-doc-1',
      job_id: 'test-job-1',
      original_file_name: 'test_statement.pdf',
      status: 'completed',
      created_at: '2025-01-15T10:00:00Z',
      pages_processed: 3,
      file_size: 1024000,
      transactions: JSON.stringify([
        {
          id: 'tx1',
          date: '2025-01-10',
          description: 'Retiro ATM',
          amount: -150.00,
          type: 'debit',
          balance: 1850.00,
          originalData: {
            'Fecha Operación': '10/01/2025',
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
          id: 'tx2',
          date: '2025-01-12',
          description: 'Depósito transferencia',
          amount: 500.00,
          type: 'credit',
          balance: 2350.00,
          originalData: {
            'Fecha Operación': '12/01/2025',
            'Concepto': 'Depósito transferencia',
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
      original_structure: JSON.stringify({
        tableStructures: [{
          columnCount: 5,
          originalColumnNames: ['Fecha Operación', 'Concepto', 'Debe', 'Haber', 'Saldo Disponible'],
          normalizedColumnNames: ['date', 'description', 'debit', 'credit', 'balance'],
          columnTypes: ['date', 'text', 'currency', 'currency', 'currency']
        }]
      }),
      column_mappings: JSON.stringify([{
        tableId: 'table1',
        columnMappings: [
          { originalName: 'Fecha Operación', normalizedName: 'date', standardType: 'date' },
          { originalName: 'Concepto', normalizedName: 'description', standardType: 'text' },
          { originalName: 'Debe', normalizedName: 'debit', standardType: 'currency' },
          { originalName: 'Haber', normalizedName: 'credit', standardType: 'currency' },
          { originalName: 'Saldo Disponible', normalizedName: 'balance', standardType: 'currency' }
        ]
      }]),
      extract_type: 'bank_statement',
      bank_type: 'bcp',
      format_version: '2024.1',
      preservation_metadata: JSON.stringify({
        extractionTimestamp: '2025-01-15T10:00:00Z',
        originalColumnCount: 5,
        detectedTables: 1,
        confidenceScore: 0.95
      }),
      // Mock methods
      getFlexibleExtractionData: function() {
        return {
          original_structure: JSON.parse(this.original_structure),
          column_mappings: JSON.parse(this.column_mappings),
          extract_type: this.extract_type,
          bank_type: this.bank_type,
          format_version: this.format_version,
          preservation_metadata: JSON.parse(this.preservation_metadata)
        };
      },
      hasOriginalStructure: function() {
        return !!(this.original_structure && this.column_mappings);
      }
    };

    mockFlexibleData = {
      original_structure: JSON.parse(mockDocument.original_structure),
      column_mappings: JSON.parse(mockDocument.column_mappings),
      extract_type: 'bank_statement',
      bank_type: 'bcp',
      format_version: '2024.1',
      preservation_metadata: JSON.parse(mockDocument.preservation_metadata),
      hasOriginalStructure: true
    };
  });

  describe('generateExcel', () => {
    it('should generate Excel file with original structure preserved', async () => {
      const buffer = await excelExportService.generateExcel(mockDocument);
      
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
      
      // Verify it's a valid Excel file by reading it back
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      
      // Should have at least 2 worksheets (transactions + summary)
      expect(workbook.worksheets.length).toBeGreaterThanOrEqual(2);
      
      // Check if transactions sheet exists
      const transactionSheet = workbook.worksheets.find(ws => 
        ws.name === 'Transactions' || ws.name === 'Tabla 1'
      );
      expect(transactionSheet).toBeDefined();
      
      // Check if summary sheet exists
      const summarySheet = workbook.getWorksheet('Summary');
      expect(summarySheet).toBeDefined();
    });

    it('should preserve original column names in Excel headers', async () => {
      const buffer = await excelExportService.generateExcel(mockDocument);
      
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      
      const transactionSheet = workbook.worksheets[0];
      const headerRow = transactionSheet.getRow(1);
      
      // Check that original column names are preserved
      const headerValues = [];
      headerRow.eachCell((cell) => {
        headerValues.push(cell.value);
      });
      
      expect(headerValues).toContain('Fecha Operación');
      expect(headerValues).toContain('Concepto');
      expect(headerValues).toContain('Debe');
      expect(headerValues).toContain('Haber');
      expect(headerValues).toContain('Saldo Disponible');
    });

    it('should include transaction data with original values', async () => {
      const buffer = await excelExportService.generateExcel(mockDocument);
      
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      
      const transactionSheet = workbook.worksheets[0];
      
      // Check first transaction row (row 2, since row 1 is headers)
      const firstDataRow = transactionSheet.getRow(2);
      const rowValues = [];
      firstDataRow.eachCell((cell) => {
        rowValues.push(cell.value);
      });
      
      // Should contain original data values
      expect(rowValues).toContain('10/01/2025'); // Original date format
      expect(rowValues).toContain('Retiro ATM'); // Original description
      expect(rowValues).toContain('150.00'); // Original amount format
    });

    it('should create summary sheet with metadata', async () => {
      const buffer = await excelExportService.generateExcel(mockDocument);
      
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      
      const summarySheet = workbook.getWorksheet('Summary');
      expect(summarySheet).toBeDefined();
      
      // Check for key metadata sections
      let foundDocumentInfo = false;
      let foundExtractionInfo = false;
      let foundTransactionStats = false;
      
      summarySheet.eachRow((row) => {
        const firstCellValue = row.getCell(1).value;
        if (typeof firstCellValue === 'string') {
          if (firstCellValue.includes('DOCUMENT INFORMATION')) {
            foundDocumentInfo = true;
          }
          if (firstCellValue.includes('EXTRACTION INFORMATION')) {
            foundExtractionInfo = true;
          }
          if (firstCellValue.includes('TRANSACTION STATISTICS')) {
            foundTransactionStats = true;
          }
        }
      });
      
      expect(foundDocumentInfo).toBe(true);
      expect(foundExtractionInfo).toBe(true);
      expect(foundTransactionStats).toBe(true);
    });

    it('should handle documents without original structure (fallback)', async () => {
      // Create document without original structure
      const documentWithoutStructure = {
        ...mockDocument,
        original_structure: null,
        column_mappings: null,
        getFlexibleExtractionData: function() {
          return {
            original_structure: null,
            column_mappings: null,
            extract_type: null,
            bank_type: null,
            format_version: null,
            preservation_metadata: null
          };
        },
        hasOriginalStructure: function() {
          return false;
        }
      };

      const buffer = await excelExportService.generateExcel(documentWithoutStructure);
      
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
      
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      
      // Should still create worksheets
      expect(workbook.worksheets.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle empty transactions gracefully', async () => {
      const documentWithoutTransactions = {
        ...mockDocument,
        transactions: JSON.stringify([])
      };

      const buffer = await excelExportService.generateExcel(documentWithoutTransactions);
      
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
      
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      
      // Should still create summary sheet
      const summarySheet = workbook.getWorksheet('Summary');
      expect(summarySheet).toBeDefined();
    });
  });

  describe('getFlexibleExtractionData', () => {
    it('should extract flexible data from document with method', () => {
      const result = excelExportService.getFlexibleExtractionData(mockDocument);
      
      expect(result.hasOriginalStructure).toBe(true);
      expect(result.bank_type).toBe('bcp');
      expect(result.extract_type).toBe('bank_statement');
      expect(result.original_structure).toBeDefined();
      expect(result.column_mappings).toBeDefined();
    });

    it('should handle document without flexible data methods', () => {
      const simpleDocument = {
        original_structure: mockDocument.original_structure,
        column_mappings: mockDocument.column_mappings,
        extract_type: 'bank_statement',
        bank_type: 'bcp'
      };

      const result = excelExportService.getFlexibleExtractionData(simpleDocument);
      
      expect(result.hasOriginalStructure).toBe(true);
      expect(result.bank_type).toBe('bcp');
      expect(result.extract_type).toBe('bank_statement');
    });

    it('should handle document with no flexible data', () => {
      const emptyDocument = {};

      const result = excelExportService.getFlexibleExtractionData(emptyDocument);
      
      expect(result.hasOriginalStructure).toBe(false);
      expect(result.bank_type).toBeNull();
      expect(result.extract_type).toBeNull();
      expect(result.original_structure).toBeNull();
    });
  });

  describe('calculateTransactionStats', () => {
    it('should calculate correct transaction statistics', () => {
      const transactions = [
        { amount: 100 },
        { amount: -50 },
        { amount: 200 },
        { amount: -25 }
      ];

      const stats = excelExportService.calculateTransactionStats(transactions);
      
      expect(stats.total).toBe(4);
      expect(stats.credits).toBe(2);
      expect(stats.debits).toBe(2);
      expect(stats.totalCredit).toBe(300);
      expect(stats.totalDebit).toBe(75);
      expect(stats.netAmount).toBe(225);
    });

    it('should handle empty transactions array', () => {
      const stats = excelExportService.calculateTransactionStats([]);
      
      expect(stats.total).toBe(0);
      expect(stats.credits).toBe(0);
      expect(stats.debits).toBe(0);
      expect(stats.totalCredit).toBe(0);
      expect(stats.totalDebit).toBe(0);
      expect(stats.netAmount).toBe(0);
    });

    it('should handle invalid input gracefully', () => {
      const stats = excelExportService.calculateTransactionStats(null);
      
      expect(stats.total).toBe(0);
      expect(stats.credits).toBe(0);
      expect(stats.debits).toBe(0);
    });
  });

  describe('mapNormalizedToOriginalValue', () => {
    it('should map date fields correctly', () => {
      const transaction = { date: '2025-01-15', post_date: '2025-01-14' };
      
      const result = excelExportService.mapNormalizedToOriginalValue(transaction, 'Fecha Operación');
      expect(result).toBe('2025-01-15');
      
      const result2 = excelExportService.mapNormalizedToOriginalValue(transaction, 'Date');
      expect(result2).toBe('2025-01-15');
    });

    it('should map description fields correctly', () => {
      const transaction = { description: 'Test transaction' };
      
      const result = excelExportService.mapNormalizedToOriginalValue(transaction, 'Concepto');
      expect(result).toBe('Test transaction');
      
      const result2 = excelExportService.mapNormalizedToOriginalValue(transaction, 'Description');
      expect(result2).toBe('Test transaction');
    });

    it('should map amount fields correctly', () => {
      const transaction = { amount: 150.50 };
      
      const result = excelExportService.mapNormalizedToOriginalValue(transaction, 'Importe');
      expect(result).toBe('150.5');
      
      const result2 = excelExportService.mapNormalizedToOriginalValue(transaction, 'Amount');
      expect(result2).toBe('150.5');
    });

    it('should return empty string for unknown fields', () => {
      const transaction = { amount: 150.50 };
      
      const result = excelExportService.mapNormalizedToOriginalValue(transaction, 'Unknown Field');
      expect(result).toBe('');
    });
  });
});