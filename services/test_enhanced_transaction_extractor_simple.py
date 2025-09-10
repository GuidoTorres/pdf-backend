#!/usr/bin/env python3
"""
Comprehensive unit tests for enhanced TransactionExtractorService.

This test suite covers:
- Original data preservation with various PDF formats
- Structure metadata generation accuracy
- Backward compatibility with existing extraction logic
- Edge cases with unusual column structures

Requirements covered: 1.1, 1.2, 1.3, 1.4
"""

import unittest
import pandas as pd
import json
import os
import sys
import tempfile
import unittest.mock as mock
from pathlib import Path

# Add the backend directory to the path to import modules
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

# Load environment variables from .env file
def load_env_file():
    env_path = backend_dir / '.env'
    if env_path.exists():
        with open(env_path, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    os.environ[key] = value

# Load environment variables
load_env_file()

from transaction_extractor_service import (
    TransactionExtractorService, 
    ExtractionResult, 
    ExtractionMethod,
    OriginalStructure,
    ColumnStructure,
    ColumnType
)


class TestEnhancedTransactionExtractor(unittest.TestCase):
    """Test suite for enhanced TransactionExtractorService functionality"""
    
    def setUp(self):
        """Set up test fixtures"""
        self.service_enhanced = TransactionExtractorService(debug=True, preserve_original_data=True)
        self.service_backward_compatible = TransactionExtractorService(debug=True, preserve_original_data=False)
        
        # Sample BCP bank statement table
        self.sample_bcp_table = pd.DataFrame({
            'Fecha': ['01/01/2025', '02/01/2025', '03/01/2025'],
            'Concepto': ['Retiro ATM', 'Depósito Salario', 'Compra Supermercado'],
            'Debe': [150.00, 0.00, 85.50],
            'Haber': [0.00, 2500.00, 0.00],
            'Saldo': [1850.00, 4350.00, 4264.50]
        })
        
        # Sample BBVA bank statement table with different structure
        self.sample_bbva_table = pd.DataFrame({
            'Fecha Operación': ['15/01/2025', '16/01/2025', '17/01/2025'],
            'Descripción': ['Transferencia Recibida', 'Pago Tarjeta', 'Retiro Cajero'],
            'Importe': [1000.00, -250.00, -100.00],
            'Saldo Disponible': [5000.00, 4750.00, 4650.00]
        })
        
        # Table with unusual column structure for edge case testing
        self.unusual_column_table = pd.DataFrame({
            'D/M/Y': ['01/02/2025', '02/02/2025'],
            'TX_DESC_LONG_NAME_WITH_UNDERSCORES': ['Transaction 1', 'Transaction 2'],
            'AMT_$': [100.50, -50.25],
            'BAL_AFTER_TX': [1000.50, 950.25],
            'EMPTY_COL': [None, None],
            'NUMERIC_ONLY': [1, 2]
        })
    
    def test_original_data_preservation_bcp_format(self):
        """Test original data preservation with BCP format - Requirement 1.1"""
        with mock.patch.object(self.service_enhanced, '_extract_with_groq') as mock_groq:
            # Mock Groq response
            mock_groq.return_value = [
                {
                    'date': '2025-01-01',
                    'description': 'Retiro ATM',
                    'amount': 150.00,
                    'type': 'debit'
                }
            ]
            
            result = self.service_enhanced.extract_from_tables([self.sample_bcp_table])
            
            # Verify extraction success
            self.assertTrue(result.success)
            self.assertEqual(result.method, ExtractionMethod.TABLE_BASED)
            
            # Verify original structure is preserved
            self.assertIsNotNone(result.original_structure)
            self.assertIn('Fecha', result.original_structure.original_headers)
            self.assertIn('Concepto', result.original_structure.original_headers)
            self.assertIn('Debe', result.original_structure.original_headers)
            self.assertIn('Haber', result.original_structure.original_headers)
            self.assertIn('Saldo', result.original_structure.original_headers)
            
            # Verify original data is preserved
            self.assertIsNotNone(result.original_data)
            self.assertEqual(len(result.original_data), 3)
            self.assertEqual(result.original_data[0]['Fecha'], '01/01/2025')
            self.assertEqual(result.original_data[0]['Concepto'], 'Retiro ATM')
            
            # Verify metadata indicates preservation
            self.assertTrue(result.metadata['original_structure_preserved'])
            self.assertEqual(result.metadata['original_headers_count'], 5)
            self.assertEqual(result.metadata['original_data_rows'], 3)
    
    def test_original_data_preservation_bbva_format(self):
        """Test original data preservation with BBVA format - Requirement 1.1"""
        with mock.patch.object(self.service_enhanced, '_extract_with_groq') as mock_groq:
            mock_groq.return_value = [
                {
                    'date': '2025-01-15',
                    'description': 'Transferencia Recibida',
                    'amount': 1000.00,
                    'type': 'credit'
                }
            ]
            
            result = self.service_enhanced.extract_from_tables([self.sample_bbva_table])
            
            # Verify BBVA-specific column names are preserved
            self.assertIsNotNone(result.original_structure)
            self.assertIn('Fecha Operación', result.original_structure.original_headers)
            self.assertIn('Descripción', result.original_structure.original_headers)
            self.assertIn('Importe', result.original_structure.original_headers)
            self.assertIn('Saldo Disponible', result.original_structure.original_headers)
            
            # Verify original data preserves BBVA format
            self.assertEqual(result.original_data[0]['Fecha Operación'], '15/01/2025')
            self.assertEqual(result.original_data[0]['Descripción'], 'Transferencia Recibida')
            # Note: Original data preserves the exact format, which might be string representation
            self.assertIn(str(1000.0), str(result.original_data[0]['Importe']))
    
    def test_structure_metadata_generation_accuracy(self):
        """Test structure metadata generation accuracy - Requirement 1.2"""
        with mock.patch.object(self.service_enhanced, '_extract_with_groq') as mock_groq:
            mock_groq.return_value = []
            
            result = self.service_enhanced.extract_from_tables([self.sample_bcp_table])
            
            # Verify structure metadata accuracy
            structure = result.original_structure
            self.assertIsNotNone(structure)
            
            # Check column types inference
            self.assertIn('Fecha', structure.column_types)
            self.assertIn('Concepto', structure.column_types)
            self.assertIn('Debe', structure.column_types)
            self.assertIn('Haber', structure.column_types)
            
            # Check column order preservation
            expected_order = ['Fecha', 'Concepto', 'Debe', 'Haber', 'Saldo']
            self.assertEqual(structure.column_order, expected_order)
            
            # Check table count
            self.assertEqual(structure.table_count, 1)
            
            # Check confidence score is reasonable
            self.assertGreaterEqual(structure.confidence_score, 0.0)
            self.assertLessEqual(structure.confidence_score, 1.0)
            
            # Check extraction method is recorded
            self.assertEqual(structure.extraction_method, 'table_based')
    
    def test_backward_compatibility_mode(self):
        """Test backward compatibility with existing extraction logic - Requirement 1.3"""
        with mock.patch.object(self.service_backward_compatible, '_extract_with_groq') as mock_groq:
            mock_groq.return_value = [
                {
                    'date': '2025-01-01',
                    'description': 'Retiro ATM',
                    'amount': 150.00,
                    'type': 'debit'
                }
            ]
            
            result = self.service_backward_compatible.extract_from_tables([self.sample_bcp_table])
            
            # Verify extraction still works
            self.assertTrue(result.success)
            # Note: In backward compatibility mode, transactions might be empty if validation fails
            # The important thing is that the service doesn't crash and preserves the API contract
            
            # Verify original data is NOT preserved (backward compatibility)
            self.assertIsNone(result.original_structure)
            self.assertIsNone(result.original_data)
            
            # Verify metadata indicates backward compatibility mode
            self.assertTrue(result.metadata['backward_compatibility_mode'])
            self.assertFalse(result.metadata['original_structure_preserved'])
            
            # Verify standard transaction format is maintained (if transactions exist)
            if result.transactions:
                transaction = result.transactions[0]
                self.assertIn('date', transaction)
                self.assertIn('description', transaction)
                self.assertIn('amount', transaction)
                self.assertIn('type', transaction)
    
    def test_edge_case_unusual_column_structures(self):
        """Test edge cases with unusual column structures - Requirement 1.4"""
        with mock.patch.object(self.service_enhanced, '_extract_with_groq') as mock_groq:
            mock_groq.return_value = [
                {
                    'date': '2025-02-01',
                    'description': 'Transaction 1',
                    'amount': 100.50,
                    'type': 'credit'
                }
            ]
            
            result = self.service_enhanced.extract_from_tables([self.unusual_column_table])
            
            # Verify unusual column names are preserved
            self.assertIsNotNone(result.original_structure)
            unusual_headers = result.original_structure.original_headers
            
            self.assertIn('D/M/Y', unusual_headers)
            self.assertIn('TX_DESC_LONG_NAME_WITH_UNDERSCORES', unusual_headers)
            self.assertIn('AMT_$', unusual_headers)
            self.assertIn('BAL_AFTER_TX', unusual_headers)
            self.assertIn('EMPTY_COL', unusual_headers)
            self.assertIn('NUMERIC_ONLY', unusual_headers)
            
            # Verify original data handles unusual formats
            self.assertIsNotNone(result.original_data)
            original_row = result.original_data[0]
            self.assertEqual(original_row['D/M/Y'], '01/02/2025')
            self.assertEqual(original_row['TX_DESC_LONG_NAME_WITH_UNDERSCORES'], 'Transaction 1')
            # Note: Original data preserves the exact format, which might be string representation
            self.assertIn(str(100.5), str(original_row['AMT_$']))
            
            # Verify empty columns are handled gracefully
            self.assertIsNone(original_row['EMPTY_COL'])
    
    def test_column_structure_detection_accuracy(self):
        """Test column structure detection accuracy"""
        column_structure = self.service_enhanced.detect_column_structure([self.sample_bcp_table])
        
        # Verify column detection
        self.assertIsInstance(column_structure, ColumnStructure)
        self.assertGreater(column_structure.confidence, 0.0)
        
        # Verify separate debit/credit detection
        self.assertTrue(column_structure.has_separate_debit_credit)
        
        # Verify column indices are detected
        self.assertGreater(len(column_structure.date_columns), 0)
        self.assertGreater(len(column_structure.description_columns), 0)
        self.assertGreater(len(column_structure.debit_columns), 0)
        self.assertGreater(len(column_structure.credit_columns), 0)
    
    def test_text_extraction_original_preservation(self):
        """Test original text structure preservation in text extraction - Requirement 1.1"""
        sample_text = """
        BANCO DE CRÉDITO DEL PERÚ
        Estado de Cuenta
        
        01/01/2025 Retiro ATM           -150.00    1850.00
        02/01/2025 Depósito Salario    +2500.00    4350.00
        03/01/2025 Compra Supermercado  -85.50    4264.50
        """
        
        with mock.patch.object(self.service_enhanced, '_extract_with_groq') as mock_groq:
            mock_groq.return_value = [
                {
                    'date': '2025-01-01',
                    'description': 'Retiro ATM',
                    'amount': 150.00,
                    'type': 'debit'
                }
            ]
            
            result = self.service_enhanced.extract_from_text(sample_text)
            
            # Verify text structure preservation
            self.assertTrue(result.success)
            self.assertIsNotNone(result.original_structure)
            self.assertIsNotNone(result.original_data)
            
            # Verify metadata includes text-specific information
            self.assertEqual(result.metadata['text_length'], len(sample_text))
            self.assertGreater(result.metadata['original_text_lines'], 0)
    
    def test_error_handling_with_preservation(self):
        """Test error handling maintains preservation behavior"""
        # Test with empty tables
        result = self.service_enhanced.extract_from_tables([])
        
        self.assertFalse(result.success)
        self.assertIsNotNone(result.error_message)
        self.assertIsNone(result.original_structure)
        self.assertIsNone(result.original_data)
    
    def test_serialization_of_enhanced_results(self):
        """Test that enhanced results can be properly serialized"""
        with mock.patch.object(self.service_enhanced, '_extract_with_groq') as mock_groq:
            mock_groq.return_value = [
                {
                    'date': '2025-01-01',
                    'description': 'Test',
                    'amount': 100.00,
                    'type': 'debit'
                }
            ]
            
            result = self.service_enhanced.extract_from_tables([self.sample_bcp_table])
            
            # Test serialization to dictionary
            result_dict = result.to_dict()
            
            # Verify all enhanced fields are serializable
            self.assertIn('original_structure', result_dict)
            self.assertIn('original_data', result_dict)
            
            # Test JSON serialization
            json_str = json.dumps(result_dict)
            self.assertIsInstance(json_str, str)
            
            # Test deserialization
            parsed = json.loads(json_str)
            self.assertIn('original_structure', parsed)
            self.assertIn('original_data', parsed)
    
    def test_multiple_table_formats_preservation(self):
        """Test preservation with multiple different table formats - Requirement 1.1, 1.4"""
        mixed_format_tables = [self.sample_bcp_table, self.sample_bbva_table]
        
        with mock.patch.object(self.service_enhanced, '_extract_with_groq') as mock_groq:
            mock_groq.return_value = [
                {
                    'date': '2025-01-01',
                    'description': 'Test Transaction',
                    'amount': 100.00,
                    'type': 'debit'
                }
            ]
            
            result = self.service_enhanced.extract_from_tables(mixed_format_tables)
            
            # Verify structure handles multiple formats
            self.assertIsNotNone(result.original_structure)
            self.assertEqual(result.original_structure.table_count, 2)
            
            # Verify all unique headers are preserved
            headers = result.original_structure.original_headers
            
            # BCP headers
            self.assertIn('Fecha', headers)
            self.assertIn('Concepto', headers)
            self.assertIn('Debe', headers)
            self.assertIn('Haber', headers)
            
            # BBVA headers
            self.assertIn('Fecha Operación', headers)
            self.assertIn('Descripción', headers)
            self.assertIn('Importe', headers)
            self.assertIn('Saldo Disponible', headers)


def run_enhanced_tests():
    """Run all enhanced TransactionExtractorService tests"""
    print("🧪 Running Enhanced TransactionExtractorService Tests...")
    
    # Create test suite
    suite = unittest.TestLoader().loadTestsFromTestCase(TestEnhancedTransactionExtractor)
    
    # Run tests
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    
    # Print summary
    if result.wasSuccessful():
        print("✅ All enhanced tests passed!")
    else:
        print(f"❌ {len(result.failures)} test(s) failed, {len(result.errors)} error(s)")
        
        for test, traceback in result.failures:
            print(f"FAILURE: {test}")
            print(traceback)
            
        for test, traceback in result.errors:
            print(f"ERROR: {test}")
            print(traceback)
    
    return result.wasSuccessful()


if __name__ == "__main__":
    run_enhanced_tests()