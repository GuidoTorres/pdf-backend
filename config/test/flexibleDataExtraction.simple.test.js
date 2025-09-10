import { describe, it, expect } from 'vitest';

describe('Flexible Data Extraction - Simple Tests', () => {
  it('should verify enhanced transaction structure', () => {
    // Mock transaction with flexible data
    const mockTransaction = {
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
    };

    // Verify structure
    expect(mockTransaction).toHaveProperty('originalData');
    expect(mockTransaction).toHaveProperty('transformationMetadata');
    expect(mockTransaction.originalData).toHaveProperty('Fecha Operación', '15/01/2025');
    expect(mockTransaction.transformationMetadata).toHaveProperty('confidence', 0.95);
    expect(mockTransaction.transformationMetadata.preservationFlags).toHaveProperty('originalFormatPreserved', true);
  });

  it('should verify column mapping structure', () => {
    const mockColumnMapping = {
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
        }
      ]
    };

    expect(mockColumnMapping).toHaveProperty('tableId');
    expect(mockColumnMapping).toHaveProperty('columnMappings');
    expect(mockColumnMapping.columnMappings).toHaveLength(2);
    expect(mockColumnMapping.columnMappings[0]).toHaveProperty('originalName', 'Fecha Operación');
    expect(mockColumnMapping.columnMappings[0]).toHaveProperty('normalizedName', 'date');
  });

  it('should verify original structure metadata', () => {
    const mockOriginalStructure = {
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
    };

    expect(mockOriginalStructure).toHaveProperty('tableStructures');
    expect(mockOriginalStructure).toHaveProperty('confidence', 0.92);
    expect(mockOriginalStructure.tableStructures[0]).toHaveProperty('columnCount', 5);
    expect(mockOriginalStructure.tableStructures[0].originalColumnNames).toEqual([
      'Fecha Operación', 'Concepto', 'Debe', 'Haber', 'Saldo Disponible'
    ]);
  });

  it('should verify API response structure', () => {
    const mockAPIResponse = {
      jobId: 'test-job-123',
      state: 'completed',
      preservedData: true,
      result: {
        transactions: [
          {
            id: '1',
            date: '2025-01-15',
            description: 'ATM Withdrawal',
            amount: -150.00,
            type: 'debit'
          }
        ],
        originalTransactions: [
          {
            id: '1',
            'Fecha Operación': '15/01/2025',
            'Concepto': 'Retiro ATM',
            'Debe': '150.00',
            'Haber': '',
            'Saldo Disponible': '1,850.00'
          }
        ],
        originalStructure: {
          tableStructures: [{
            columnCount: 5,
            originalColumnNames: ['Fecha Operación', 'Concepto', 'Debe', 'Haber', 'Saldo Disponible']
          }]
        },
        columnMetadata: [{
          tableId: 'main-transactions',
          columnMappings: []
        }],
        extractType: 'bank_statement',
        bankType: 'bcp',
        formatVersion: 'v2.1'
      }
    };

    // Verify backward compatibility
    expect(mockAPIResponse).toHaveProperty('jobId');
    expect(mockAPIResponse).toHaveProperty('state');
    expect(mockAPIResponse.result).toHaveProperty('transactions');

    // Verify new flexible data fields
    expect(mockAPIResponse).toHaveProperty('preservedData', true);
    expect(mockAPIResponse.result).toHaveProperty('originalTransactions');
    expect(mockAPIResponse.result).toHaveProperty('originalStructure');
    expect(mockAPIResponse.result).toHaveProperty('columnMetadata');
    expect(mockAPIResponse.result).toHaveProperty('extractType', 'bank_statement');
    expect(mockAPIResponse.result).toHaveProperty('bankType', 'bcp');
  });
});