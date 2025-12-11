import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import documentRoutes from '../../src/routes/documentRoutes.js';
import databaseService from '../../src/services/databaseService.js';
import excelExportService from '../../src/services/excelExportService.js';
import ExcelJS from 'exceljs';

// Mock dependencies
vi.mock('../../src/services/databaseService.js');
vi.mock('../../src/services/excelExportService.js');
vi.mock('../../src/services/queueService.js', () => ({
  default: {
    getJob: vi.fn(),
    removeJob: vi.fn()
  }
}));
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

describe('Document Routes - Excel Export', () => {
  let app;
  let mockDocument;
  let mockExcelBuffer;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/documents', documentRoutes);

    // Mock document data
    mockDocument = {
      id: 'doc-123',
      job_id: 'job-123',
      user_id: 'test-user-123',
      original_file_name: 'test_statement.pdf',
      status: 'completed',
      created_at: '2025-01-15T10:00:00Z',
      transactions: JSON.stringify([
        {
          id: 'tx1',
          date: '2025-01-10',
          description: 'Test transaction',
          amount: -100.00,
          type: 'debit',
          originalData: {
            'Fecha': '10/01/2025',
            'Concepto': 'Test transaction',
            'Importe': '-100.00'
          }
        }
      ]),
      original_structure: JSON.stringify({ tableCount: 1 }),
      column_mappings: JSON.stringify([{ tableId: 'table1' }]),
      getFlexibleExtractionData: vi.fn().mockReturnValue({
        original_structure: { tableCount: 1 },
        column_mappings: [{ tableId: 'table1' }],
        extract_type: 'bank_statement',
        bank_type: 'bcp'
      }),
      hasOriginalStructure: vi.fn().mockReturnValue(true)
    };

    // Create a mock Excel buffer
    mockExcelBuffer = Buffer.from('mock excel content');

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/documents/:id/export/excel', () => {
    it('should successfully export document to Excel', async () => {
      // Setup mocks
      databaseService.getDocumentById.mockResolvedValue(mockDocument);
      excelExportService.generateExcel.mockResolvedValue(mockExcelBuffer);

      const response = await request(app)
        .get('/api/documents/doc-123/export/excel')
        .expect(200);

      // Verify response headers
      expect(response.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(response.headers['content-disposition']).toMatch(/attachment; filename="test_statement_export_\d{4}-\d{2}-\d{2}\.xlsx"/);
      expect(response.headers['content-length']).toBe(mockExcelBuffer.length.toString());

      // Verify response body
      expect(response.body).toEqual(mockExcelBuffer);

      // Verify service calls
      expect(databaseService.getDocumentById).toHaveBeenCalledWith('doc-123');
      expect(excelExportService.generateExcel).toHaveBeenCalledWith(mockDocument, {
        preserveOriginalStructure: true,
        includeMetadata: true,
        includeSummary: true
      });
    });

    it('should return 404 when document not found', async () => {
      databaseService.getDocumentById.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/documents/nonexistent/export/excel')
        .expect(404);

      expect(response.body).toEqual({
        error: 'Document not found',
        message: 'The requested document does not exist or you do not have access to it.'
      });

      expect(excelExportService.generateExcel).not.toHaveBeenCalled();
    });

    it('should return 403 when user does not own document', async () => {
      const unauthorizedDocument = {
        ...mockDocument,
        user_id: 'different-user-456'
      };
      
      databaseService.getDocumentById.mockResolvedValue(unauthorizedDocument);

      const response = await request(app)
        .get('/api/documents/doc-123/export/excel')
        .expect(403);

      expect(response.body).toEqual({
        error: 'Access denied',
        message: 'You do not have permission to export this document.'
      });

      expect(excelExportService.generateExcel).not.toHaveBeenCalled();
    });

    it('should return 400 when document is not completed', async () => {
      const processingDocument = {
        ...mockDocument,
        status: 'processing'
      };
      
      databaseService.getDocumentById.mockResolvedValue(processingDocument);

      const response = await request(app)
        .get('/api/documents/doc-123/export/excel')
        .expect(400);

      expect(response.body).toEqual({
        error: 'Document not ready',
        message: 'Document must be completed before it can be exported.',
        status: 'processing'
      });

      expect(excelExportService.generateExcel).not.toHaveBeenCalled();
    });

    it('should return 400 when document has no transactions', async () => {
      const emptyDocument = {
        ...mockDocument,
        transactions: JSON.stringify([])
      };
      
      databaseService.getDocumentById.mockResolvedValue(emptyDocument);

      const response = await request(app)
        .get('/api/documents/doc-123/export/excel')
        .expect(400);

      expect(response.body).toEqual({
        error: 'No data to export',
        message: 'This document contains no transaction data to export.'
      });

      expect(excelExportService.generateExcel).not.toHaveBeenCalled();
    });

    it('should return 400 when transactions is null', async () => {
      const nullTransactionsDocument = {
        ...mockDocument,
        transactions: null
      };
      
      databaseService.getDocumentById.mockResolvedValue(nullTransactionsDocument);

      const response = await request(app)
        .get('/api/documents/doc-123/export/excel')
        .expect(400);

      expect(response.body).toEqual({
        error: 'No data to export',
        message: 'This document contains no transaction data to export.'
      });

      expect(excelExportService.generateExcel).not.toHaveBeenCalled();
    });

    it('should handle malformed transactions JSON gracefully', async () => {
      const malformedDocument = {
        ...mockDocument,
        transactions: 'invalid json'
      };
      
      databaseService.getDocumentById.mockResolvedValue(malformedDocument);

      const response = await request(app)
        .get('/api/documents/doc-123/export/excel')
        .expect(400);

      expect(response.body).toEqual({
        error: 'No data to export',
        message: 'This document contains no transaction data to export.'
      });

      expect(excelExportService.generateExcel).not.toHaveBeenCalled();
    });

    it('should return 500 when Excel generation fails', async () => {
      databaseService.getDocumentById.mockResolvedValue(mockDocument);
      excelExportService.generateExcel.mockRejectedValue(new Error('Excel generation failed'));

      const response = await request(app)
        .get('/api/documents/doc-123/export/excel')
        .expect(500);

      expect(response.body).toEqual({
        error: 'Export failed',
        message: 'An error occurred while generating the Excel file. Please try again later.',
        details: undefined // Should not expose internal error in production
      });

      expect(excelExportService.generateExcel).toHaveBeenCalled();
    });

    it('should return 500 when database query fails', async () => {
      databaseService.getDocumentById.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .get('/api/documents/doc-123/export/excel')
        .expect(500);

      expect(response.body).toEqual({
        error: 'Export failed',
        message: 'An error occurred while generating the Excel file. Please try again later.',
        details: undefined
      });

      expect(excelExportService.generateExcel).not.toHaveBeenCalled();
    });

    it('should generate correct filename with timestamp', async () => {
      databaseService.getDocumentById.mockResolvedValue(mockDocument);
      excelExportService.generateExcel.mockResolvedValue(mockExcelBuffer);

      const response = await request(app)
        .get('/api/documents/doc-123/export/excel')
        .expect(200);

      const contentDisposition = response.headers['content-disposition'];
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      
      expect(contentDisposition).toMatch(new RegExp(`attachment; filename="test_statement_export_${today}\\.xlsx"`));
    });

    it('should handle document without original filename', async () => {
      const documentWithoutName = {
        ...mockDocument,
        original_file_name: null
      };
      
      databaseService.getDocumentById.mockResolvedValue(documentWithoutName);
      excelExportService.generateExcel.mockResolvedValue(mockExcelBuffer);

      const response = await request(app)
        .get('/api/documents/doc-123/export/excel')
        .expect(200);

      const contentDisposition = response.headers['content-disposition'];
      const today = new Date().toISOString().split('T')[0];
      
      expect(contentDisposition).toMatch(new RegExp(`attachment; filename="document_export_${today}\\.xlsx"`));
    });

    it('should handle transactions as array (not stringified)', async () => {
      const documentWithArrayTransactions = {
        ...mockDocument,
        transactions: [
          {
            id: 'tx1',
            date: '2025-01-10',
            description: 'Test transaction',
            amount: -100.00
          }
        ]
      };
      
      databaseService.getDocumentById.mockResolvedValue(documentWithArrayTransactions);
      excelExportService.generateExcel.mockResolvedValue(mockExcelBuffer);

      const response = await request(app)
        .get('/api/documents/doc-123/export/excel')
        .expect(200);

      expect(excelExportService.generateExcel).toHaveBeenCalledWith(documentWithArrayTransactions, {
        preserveOriginalStructure: true,
        includeMetadata: true,
        includeSummary: true
      });
    });
  });

  describe('Excel Export Integration', () => {
    it('should generate valid Excel file that can be read back', async () => {
      // Use real Excel service for this integration test
      vi.unmock('../../src/services/excelExportService.js');
      const realExcelService = await import('../../src/services/excelExportService.js');
      
      databaseService.getDocumentById.mockResolvedValue(mockDocument);

      const response = await request(app)
        .get('/api/documents/doc-123/export/excel')
        .expect(200);

      // Verify we can read the Excel file
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(response.body);

      expect(workbook.worksheets.length).toBeGreaterThan(0);
      
      // Check for expected worksheets
      const worksheetNames = workbook.worksheets.map(ws => ws.name);
      expect(worksheetNames).toContain('Summary');
    });
  });
});
