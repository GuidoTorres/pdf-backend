import { describe, it, expect } from 'vitest';

describe('ExcelExportService - Simple Test', () => {
  it('should be able to import the service', async () => {
    try {
      const excelExportService = await import('../../../src/services/excelExportService.js');
      expect(excelExportService.default).toBeDefined();
      expect(typeof excelExportService.default.generateExcel).toBe('function');
    } catch (error) {
      console.error('Import error:', error);
      throw error;
    }
  });

  it('should be able to import ExcelJS', async () => {
    try {
      const ExcelJS = await import('exceljs');
      expect(ExcelJS.default).toBeDefined();
      expect(typeof ExcelJS.default.Workbook).toBe('function');
    } catch (error) {
      console.error('ExcelJS import error:', error);
      throw error;
    }
  });
});