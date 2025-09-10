import logService from './logService.js';
import path from 'path';
import os from 'os';

/**
 * Excel Export Service for preserving original data structure
 * This service creates Excel files that maintain the original column names and data
 * from PDF extractions, supporting multiple sheets for different table structures
 */
class ExcelExportService {
  constructor() {
    this.logger = logService;
  }

  /**
   * Generate Excel file with preserved original data structure
   * @param {Object} document - Document with transactions and metadata
   * @param {Object} options - Export options
   * @returns {Promise<Buffer>} Excel file buffer
   */
  async generateExcel(document, options = {}) {
    try {
      // Dynamic import to avoid module loading issues
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.default.Workbook();
      
      // Set workbook properties
      workbook.creator = 'PDF Converter';
      workbook.lastModifiedBy = 'PDF Converter';
      workbook.created = new Date();
      workbook.modified = new Date();
      workbook.lastPrinted = new Date();

      // Get flexible extraction data
      const flexibleData = this.getFlexibleExtractionData(document);
      
      // Create sheets based on original structure
      if (flexibleData.hasOriginalStructure) {
        await this.createOriginalStructureSheets(workbook, document, flexibleData);
      } else {
        // Fallback to normalized structure
        await this.createNormalizedSheet(workbook, document);
      }

      // Add summary sheet with metadata
      await this.createSummarySheet(workbook, document, flexibleData);

      return await workbook.xlsx.writeBuffer();
    } catch (error) {
      this.logger.error('[EXCEL_EXPORT] Error generating Excel file:', error);
      throw new Error(`Failed to generate Excel file: ${error.message}`);
    }
  }

  /**
   * Get flexible extraction data from document
   * @param {Object} document - Document object
   * @returns {Object} Flexible extraction data
   */
  getFlexibleExtractionData(document) {
    try {
      // Try to get flexible data using the document method if available
      if (typeof document.getFlexibleExtractionData === 'function') {
        return {
          ...document.getFlexibleExtractionData(),
          hasOriginalStructure: document.hasOriginalStructure ? document.hasOriginalStructure() : false
        };
      }

      // Fallback: extract from document properties directly
      return {
        original_structure: document.original_structure || null,
        column_mappings: document.column_mappings || null,
        extract_type: document.extract_type || null,
        bank_type: document.bank_type || null,
        format_version: document.format_version || null,
        preservation_metadata: document.preservation_metadata || null,
        hasOriginalStructure: !!(document.original_structure || document.column_mappings)
      };
    } catch (error) {
      this.logger.warn('[EXCEL_EXPORT] Error getting flexible extraction data:', error);
      return {
        original_structure: null,
        column_mappings: null,
        extract_type: null,
        bank_type: null,
        format_version: null,
        preservation_metadata: null,
        hasOriginalStructure: false
      };
    }
  }

  /**
   * Create sheets based on original document structure
   * @param {ExcelJS.Workbook} workbook - Excel workbook
   * @param {Object} document - Document with transactions
   * @param {Object} flexibleData - Flexible extraction data
   */
  async createOriginalStructureSheets(workbook, document, flexibleData) {
    const transactions = this.parseTransactions(document.transactions);
    
    if (!transactions || transactions.length === 0) {
      this.logger.warn('[EXCEL_EXPORT] No transactions found for original structure export');
      return;
    }

    // Group transactions by table structure if multiple structures exist
    const tableGroups = this.groupTransactionsByStructure(transactions, flexibleData);
    
    for (const [groupName, groupTransactions] of Object.entries(tableGroups)) {
      const worksheet = workbook.addWorksheet(groupName);
      await this.populateOriginalStructureSheet(worksheet, groupTransactions, flexibleData, groupName);
    }
  }

  /**
   * Group transactions by their original table structure
   * @param {Array} transactions - Array of transactions
   * @param {Object} flexibleData - Flexible extraction data
   * @returns {Object} Grouped transactions by structure
   */
  groupTransactionsByStructure(transactions, flexibleData) {
    // If we have original transactions with preserved structure, use those
    if (transactions.length > 0 && transactions[0].originalData) {
      // Group by similar column structures
      const groups = {};
      
      transactions.forEach((transaction, index) => {
        const originalData = transaction.originalData || {};
        const columnSignature = Object.keys(originalData).sort().join('|');
        
        if (!groups[columnSignature]) {
          const groupName = this.generateGroupName(originalData, index);
          groups[columnSignature] = {
            name: groupName,
            transactions: []
          };
        }
        
        groups[columnSignature].transactions.push(transaction);
      });

      // Convert to name-keyed object
      const result = {};
      Object.values(groups).forEach(group => {
        result[group.name] = group.transactions;
      });

      return Object.keys(result).length > 0 ? result : { 'Transactions': transactions };
    }

    // Fallback: single group
    return { 'Transactions': transactions };
  }

  /**
   * Generate a meaningful group name from original data structure
   * @param {Object} originalData - Original transaction data
   * @param {number} index - Transaction index for fallback
   * @returns {string} Group name
   */
  generateGroupName(originalData, index) {
    const columns = Object.keys(originalData);
    
    // Look for identifying patterns in column names
    if (columns.some(col => col.toLowerCase().includes('cuenta'))) {
      return 'Cuenta Corriente';
    }
    if (columns.some(col => col.toLowerCase().includes('tarjeta'))) {
      return 'Tarjeta de Crédito';
    }
    if (columns.some(col => col.toLowerCase().includes('ahorro'))) {
      return 'Cuenta de Ahorros';
    }
    
    // Default naming
    return `Tabla ${index + 1}`;
  }

  /**
   * Populate worksheet with original structure data
   * @param {ExcelJS.Worksheet} worksheet - Excel worksheet
   * @param {Array} transactions - Transactions for this sheet
   * @param {Object} flexibleData - Flexible extraction data
   * @param {string} groupName - Name of the transaction group
   */
  async populateOriginalStructureSheet(worksheet, transactions, flexibleData, groupName) {
    if (!transactions || transactions.length === 0) return;

    // Get original column names from first transaction
    const firstTransaction = transactions[0];
    let originalColumns = [];

    if (firstTransaction.originalData) {
      originalColumns = Object.keys(firstTransaction.originalData);
    } else {
      // Fallback: use column mappings to reverse-map normalized columns
      originalColumns = this.getOriginalColumnsFromMappings(flexibleData.column_mappings);
    }

    if (originalColumns.length === 0) {
      // Final fallback: use normalized column names
      originalColumns = ['Fecha', 'Descripción', 'Importe', 'Saldo'];
    }

    // Set up headers
    const headerRow = worksheet.addRow(originalColumns);
    this.styleHeaderRow(headerRow);

    // Add data rows
    transactions.forEach(transaction => {
      const rowData = [];
      
      originalColumns.forEach(columnName => {
        let value = '';
        
        if (transaction.originalData && transaction.originalData[columnName] !== undefined) {
          // Use original data if available
          value = transaction.originalData[columnName];
        } else {
          // Map from normalized data
          value = this.mapNormalizedToOriginalValue(transaction, columnName);
        }
        
        rowData.push(value);
      });
      
      const dataRow = worksheet.addRow(rowData);
      this.styleDataRow(dataRow);
    });

    // Auto-fit columns
    this.autoFitColumns(worksheet);

    // Add metadata comment
    worksheet.getCell('A1').note = {
      texts: [{
        text: `Original structure preserved from ${flexibleData.bank_type || 'unknown'} ${flexibleData.extract_type || 'document'}\nExtracted: ${new Date().toLocaleString()}`
      }]
    };
  }

  /**
   * Get original column names from column mappings
   * @param {Array} columnMappings - Column mapping configuration
   * @returns {Array} Original column names
   */
  getOriginalColumnsFromMappings(columnMappings) {
    if (!Array.isArray(columnMappings)) return [];

    const originalColumns = [];
    
    columnMappings.forEach(tableMapping => {
      if (tableMapping.columnMappings && Array.isArray(tableMapping.columnMappings)) {
        tableMapping.columnMappings.forEach(colMapping => {
          if (colMapping.originalName && !originalColumns.includes(colMapping.originalName)) {
            originalColumns.push(colMapping.originalName);
          }
        });
      }
    });

    return originalColumns;
  }

  /**
   * Map normalized transaction data to original column value
   * @param {Object} transaction - Normalized transaction
   * @param {string} originalColumnName - Original column name
   * @returns {string} Mapped value
   */
  mapNormalizedToOriginalValue(transaction, originalColumnName) {
    const columnLower = originalColumnName.toLowerCase();
    
    // Common mappings based on column name patterns
    if (columnLower.includes('fecha') || columnLower.includes('date')) {
      return transaction.date || transaction.post_date || transaction.value_date || '';
    }
    
    if (columnLower.includes('descripci') || columnLower.includes('concepto') || 
        columnLower.includes('description') || columnLower.includes('detail')) {
      return transaction.description || '';
    }
    
    if (columnLower.includes('importe') || columnLower.includes('monto') || 
        columnLower.includes('amount') || columnLower.includes('debe') || 
        columnLower.includes('haber') || columnLower.includes('debit') || 
        columnLower.includes('credit')) {
      return transaction.amount !== undefined ? transaction.amount.toString() : '';
    }
    
    if (columnLower.includes('saldo') || columnLower.includes('balance')) {
      return transaction.balance !== undefined ? transaction.balance.toString() : '';
    }
    
    if (columnLower.includes('tipo') || columnLower.includes('type')) {
      return transaction.type || '';
    }
    
    if (columnLower.includes('referencia') || columnLower.includes('reference')) {
      return transaction.reference || '';
    }
    
    // Default: return empty string
    return '';
  }

  /**
   * Create normalized sheet as fallback
   * @param {ExcelJS.Workbook} workbook - Excel workbook
   * @param {Object} document - Document with transactions
   */
  async createNormalizedSheet(workbook, document) {
    const worksheet = workbook.addWorksheet('Transactions');
    const transactions = this.parseTransactions(document.transactions);
    
    if (!transactions || transactions.length === 0) {
      worksheet.addRow(['No transactions found']);
      return;
    }

    // Standard headers
    const headers = ['Fecha', 'Descripción', 'Importe', 'Tipo', 'Saldo', 'Categoría'];
    const headerRow = worksheet.addRow(headers);
    this.styleHeaderRow(headerRow);

    // Add data rows
    transactions.forEach(transaction => {
      const rowData = [
        transaction.date || transaction.post_date || transaction.value_date || '',
        transaction.description || '',
        transaction.amount || 0,
        transaction.type || '',
        transaction.balance || 0,
        transaction.category || ''
      ];
      
      const dataRow = worksheet.addRow(rowData);
      this.styleDataRow(dataRow);
    });

    this.autoFitColumns(worksheet);
  }

  /**
   * Create summary sheet with extraction metadata
   * @param {ExcelJS.Workbook} workbook - Excel workbook
   * @param {Object} document - Document with metadata
   * @param {Object} flexibleData - Flexible extraction data
   */
  async createSummarySheet(workbook, document, flexibleData) {
    const worksheet = workbook.addWorksheet('Summary');
    
    // Document information
    worksheet.addRow(['DOCUMENT INFORMATION']);
    worksheet.addRow(['File Name', document.original_file_name || document.fileName || 'Unknown']);
    worksheet.addRow(['Processing Date', new Date(document.created_at || Date.now()).toLocaleString()]);
    worksheet.addRow(['Status', document.status || 'Unknown']);
    worksheet.addRow(['Pages Processed', document.pages_processed || 1]);
    worksheet.addRow(['File Size', this.formatFileSize(document.file_size)]);
    worksheet.addRow([]);

    // Bank and extraction information
    worksheet.addRow(['EXTRACTION INFORMATION']);
    worksheet.addRow(['Bank Type', flexibleData.bank_type || 'Unknown']);
    worksheet.addRow(['Extract Type', flexibleData.extract_type || 'Unknown']);
    worksheet.addRow(['Format Version', flexibleData.format_version || 'Unknown']);
    worksheet.addRow(['Original Structure Preserved', flexibleData.hasOriginalStructure ? 'Yes' : 'No']);
    worksheet.addRow([]);

    // Transaction statistics
    const transactions = this.parseTransactions(document.transactions);
    const stats = this.calculateTransactionStats(transactions);
    
    worksheet.addRow(['TRANSACTION STATISTICS']);
    worksheet.addRow(['Total Transactions', stats.total]);
    worksheet.addRow(['Credit Transactions', stats.credits]);
    worksheet.addRow(['Debit Transactions', stats.debits]);
    worksheet.addRow(['Total Credit Amount', stats.totalCredit]);
    worksheet.addRow(['Total Debit Amount', stats.totalDebit]);
    worksheet.addRow(['Net Amount', stats.netAmount]);
    worksheet.addRow([]);

    // Original structure information
    if (flexibleData.hasOriginalStructure) {
      worksheet.addRow(['ORIGINAL STRUCTURE']);
      
      if (flexibleData.column_mappings) {
        worksheet.addRow(['Column Mappings:']);
        const mappings = Array.isArray(flexibleData.column_mappings) ? 
          flexibleData.column_mappings : [flexibleData.column_mappings];
        
        mappings.forEach((tableMapping, index) => {
          if (tableMapping.columnMappings) {
            worksheet.addRow([`Table ${index + 1}:`]);
            tableMapping.columnMappings.forEach(colMapping => {
              worksheet.addRow(['', colMapping.originalName, '->', colMapping.normalizedName]);
            });
          }
        });
      }
    }

    // Style the summary sheet
    this.styleSummarySheet(worksheet);
  }

  /**
   * Parse transactions from various formats
   * @param {string|Array} transactions - Transactions data
   * @returns {Array} Parsed transactions array
   */
  parseTransactions(transactions) {
    if (!transactions) return [];
    
    if (typeof transactions === 'string') {
      try {
        return JSON.parse(transactions);
      } catch (error) {
        this.logger.error('[EXCEL_EXPORT] Error parsing transactions JSON:', error);
        return [];
      }
    }
    
    if (Array.isArray(transactions)) {
      return transactions;
    }
    
    return [];
  }

  /**
   * Calculate transaction statistics
   * @param {Array} transactions - Array of transactions
   * @returns {Object} Statistics object
   */
  calculateTransactionStats(transactions) {
    if (!Array.isArray(transactions)) {
      return {
        total: 0,
        credits: 0,
        debits: 0,
        totalCredit: 0,
        totalDebit: 0,
        netAmount: 0
      };
    }

    const stats = {
      total: transactions.length,
      credits: 0,
      debits: 0,
      totalCredit: 0,
      totalDebit: 0,
      netAmount: 0
    };

    transactions.forEach(transaction => {
      const amount = parseFloat(transaction.amount) || 0;
      
      if (amount > 0) {
        stats.credits++;
        stats.totalCredit += amount;
      } else if (amount < 0) {
        stats.debits++;
        stats.totalDebit += Math.abs(amount);
      }
      
      stats.netAmount += amount;
    });

    return stats;
  }

  /**
   * Format file size for display
   * @param {number} bytes - File size in bytes
   * @returns {string} Formatted file size
   */
  formatFileSize(bytes) {
    if (!bytes) return 'Unknown';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  /**
   * Style header row
   * @param {ExcelJS.Row} row - Excel row
   */
  styleHeaderRow(row) {
    row.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: '366092' }
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
  }

  /**
   * Style data row
   * @param {ExcelJS.Row} row - Excel row
   */
  styleDataRow(row) {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });
  }

  /**
   * Style summary sheet
   * @param {ExcelJS.Worksheet} worksheet - Excel worksheet
   */
  styleSummarySheet(worksheet) {
    // Style section headers
    worksheet.eachRow((row, rowNumber) => {
      const firstCell = row.getCell(1);
      const cellValue = firstCell.value;
      
      if (typeof cellValue === 'string' && cellValue.toUpperCase() === cellValue && cellValue.length > 5) {
        // This is likely a section header
        firstCell.font = { bold: true, size: 12 };
        firstCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'E7E6E6' }
        };
      }
    });
  }

  /**
   * Auto-fit columns to content
   * @param {ExcelJS.Worksheet} worksheet - Excel worksheet
   */
  autoFitColumns(worksheet) {
    worksheet.columns.forEach(column => {
      let maxLength = 0;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const columnLength = cell.value ? cell.value.toString().length : 10;
        if (columnLength > maxLength) {
          maxLength = columnLength;
        }
      });
      column.width = Math.min(Math.max(maxLength + 2, 10), 50);
    });
  }

  /**
   * Save Excel file to temporary location
   * @param {Buffer} buffer - Excel file buffer
   * @param {string} filename - Desired filename
   * @returns {Promise<string>} Path to saved file
   */
  async saveToTempFile(buffer, filename) {
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, filename);
    
    const fs = await import('fs/promises');
    await fs.writeFile(tempFilePath, buffer);
    
    return tempFilePath;
  }
}

export default new ExcelExportService();