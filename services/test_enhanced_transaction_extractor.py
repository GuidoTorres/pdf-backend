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
from typing import List, Dict, Any

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
        
        # Sample Interbank statement with unique column names
        self.sample_interbank_table = pd.DataFrame({
            'Fec. Valor': ['20/01/2025', '21/01/2025'],
            'Detalle Operación': ['Depósito Efectivo', 'Compra POS'],
            'Cargos': [0.00, 75.00],
            'Abonos': [500.00, 0.00],
            'Saldo Final': [5500.00, 5425.00]
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
        
        # Multiple tables with different formats
        self.mixed_format_tables = [self.sample_bcp_table, self.sample_bbva_table]
    
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
            
            result = service_enhanced.extract_from_tables([sample_bcp_table])
            
            # Verify extraction success
            assert result.success
            assert result.method == ExtractionMethod.TABLE_BASED
            
            # Verify original structure is preserved
            assert result.original_structure is not None
            assert 'Fecha' in result.original_structure.original_headers
            assert 'Concepto' in result.original_structure.original_headers
            assert 'Debe' in result.original_structure.original_headers
            assert 'Haber' in result.original_structure.original_headers
            assert 'Saldo' in result.original_structure.original_headers
            
            # Verify original data is preserved
            assert result.original_data is not None
            assert len(result.original_data) == 3
            assert result.original_data[0]['Fecha'] == '01/01/2025'
            assert result.original_data[0]['Concepto'] == 'Retiro ATM'
            
            # Verify metadata indicates preservation
            assert result.metadata['original_structure_preserved'] is True
            assert result.metadata['original_headers_count'] == 5
            assert result.metadata['original_data_rows'] == 3
    
    def test_original_data_preservation_bbva_format(self, service_enhanced, sample_bbva_table):
        """Test original data preservation with BBVA format - Requirement 1.1"""
        with mock.patch.object(service_enhanced, '_extract_with_groq') as mock_groq:
            mock_groq.return_value = [
                {
                    'date': '2025-01-15',
                    'description': 'Transferencia Recibida',
                    'amount': 1000.00,
                    'type': 'credit'
                }
            ]
            
            result = service_enhanced.extract_from_tables([sample_bbva_table])
            
            # Verify BBVA-specific column names are preserved
            assert result.original_structure is not None
            assert 'Fecha Operación' in result.original_structure.original_headers
            assert 'Descripción' in result.original_structure.original_headers
            assert 'Importe' in result.original_structure.original_headers
            assert 'Saldo Disponible' in result.original_structure.original_headers
            
            # Verify original data preserves BBVA format
            assert result.original_data[0]['Fecha Operación'] == '15/01/2025'
            assert result.original_data[0]['Descripción'] == 'Transferencia Recibida'
            assert result.original_data[0]['Importe'] == 1000.00
    
    def test_structure_metadata_generation_accuracy(self, service_enhanced, sample_bcp_table):
        """Test structure metadata generation accuracy - Requirement 1.2"""
        with mock.patch.object(service_enhanced, '_extract_with_groq') as mock_groq:
            mock_groq.return_value = []
            
            result = service_enhanced.extract_from_tables([sample_bcp_table])
            
            # Verify structure metadata accuracy
            structure = result.original_structure
            assert structure is not None
            
            # Check column types inference
            assert 'Fecha' in structure.column_types
            assert 'Concepto' in structure.column_types
            assert 'Debe' in structure.column_types
            assert 'Haber' in structure.column_types
            
            # Check column order preservation
            expected_order = ['Fecha', 'Concepto', 'Debe', 'Haber', 'Saldo']
            assert structure.column_order == expected_order
            
            # Check table count
            assert structure.table_count == 1
            
            # Check confidence score is reasonable
            assert 0.0 <= structure.confidence_score <= 1.0
            
            # Check extraction method is recorded
            assert structure.extraction_method == 'table_based'
    
    def test_backward_compatibility_mode(self, service_backward_compatible, sample_bcp_table):
        """Test backward compatibility with existing extraction logic - Requirement 1.3"""
        with mock.patch.object(service_backward_compatible, '_extract_with_groq') as mock_groq:
            mock_groq.return_value = [
                {
                    'date': '2025-01-01',
                    'description': 'Retiro ATM',
                    'amount': 150.00,
                    'type': 'debit'
                }
            ]
            
            result = service_backward_compatible.extract_from_tables([sample_bcp_table])
            
            # Verify extraction still works
            assert result.success
            assert len(result.transactions) > 0
            
            # Verify original data is NOT preserved (backward compatibility)
            assert result.original_structure is None
            assert result.original_data is None
            
            # Verify metadata indicates backward compatibility mode
            assert result.metadata['backward_compatibility_mode'] is True
            assert result.metadata['original_structure_preserved'] is False
            
            # Verify standard transaction format is maintained
            transaction = result.transactions[0]
            assert 'date' in transaction
            assert 'description' in transaction
            assert 'amount' in transaction
            assert 'type' in transaction
    
    def test_edge_case_unusual_column_structures(self, service_enhanced, unusual_column_table):
        """Test edge cases with unusual column structures - Requirement 1.4"""
        with mock.patch.object(service_enhanced, '_extract_with_groq') as mock_groq:
            mock_groq.return_value = [
                {
                    'date': '2025-02-01',
                    'description': 'Transaction 1',
                    'amount': 100.50,
                    'type': 'credit'
                }
            ]
            
            result = service_enhanced.extract_from_tables([unusual_column_table])
            
            # Verify unusual column names are preserved
            assert result.original_structure is not None
            unusual_headers = result.original_structure.original_headers
            
            assert 'D/M/Y' in unusual_headers
            assert 'TX_DESC_LONG_NAME_WITH_UNDERSCORES' in unusual_headers
            assert 'AMT_$' in unusual_headers
            assert 'BAL_AFTER_TX' in unusual_headers
            assert 'EMPTY_COL' in unusual_headers
            assert 'NUMERIC_ONLY' in unusual_headers
            
            # Verify original data handles unusual formats
            assert result.original_data is not None
            original_row = result.original_data[0]
            assert original_row['D/M/Y'] == '01/02/2025'
            assert original_row['TX_DESC_LONG_NAME_WITH_UNDERSCORES'] == 'Transaction 1'
            assert original_row['AMT_$'] == 100.50
            
            # Verify empty columns are handled gracefully
            assert original_row['EMPTY_COL'] is None
    
    def test_multiple_table_formats_preservation(self, service_enhanced, mixed_format_tables):
        """Test preservation with multiple different table formats - Requirement 1.1, 1.4"""
        with mock.patch.object(service_enhanced, '_extract_with_groq') as mock_groq:
            mock_groq.return_value = [
                {
                    'date': '2025-01-01',
                    'description': 'Test Transaction',
                    'amount': 100.00,
                    'type': 'debit'
                }
            ]
            
            result = service_enhanced.extract_from_tables(mixed_format_tables)
            
            # Verify structure handles multiple formats
            assert result.original_structure is not None
            assert result.original_structure.table_count == 2
            
            # Verify all unique headers are preserved
            headers = result.original_structure.original_headers
            
            # BCP headers
            assert 'Fecha' in headers
            assert 'Concepto' in headers
            assert 'Debe' in headers
            assert 'Haber' in headers
            
            # BBVA headers
            assert 'Fecha Operación' in headers
            assert 'Descripción' in headers
            assert 'Importe' in headers
            assert 'Saldo Disponible' in headers
    
    def test_column_structure_detection_accuracy(self, service_enhanced, sample_bcp_table):
        """Test column structure detection accuracy"""
        column_structure = service_enhanced.detect_column_structure([sample_bcp_table])
        
        # Verify column detection
        assert isinstance(column_structure, ColumnStructure)
        assert column_structure.confidence > 0.0
        
        # Verify separate debit/credit detection
        assert column_structure.has_separate_debit_credit is True
        
        # Verify column indices are detected
        assert len(column_structure.date_columns) > 0
        assert len(column_structure.description_columns) > 0
        assert len(column_structure.debit_columns) > 0
        assert len(column_structure.credit_columns) > 0
    
    def test_text_extraction_original_preservation(self, service_enhanced):
        """Test original text structure preservation in text extraction - Requirement 1.1"""
        sample_text = """
        BANCO DE CRÉDITO DEL PERÚ
        Estado de Cuenta
        
        01/01/2025 Retiro ATM           -150.00    1850.00
        02/01/2025 Depósito Salario    +2500.00    4350.00
        03/01/2025 Compra Supermercado  -85.50    4264.50
        """
        
        with mock.patch.object(service_enhanced, '_extract_with_groq') as mock_groq:
            mock_groq.return_value = [
                {
                    'date': '2025-01-01',
                    'description': 'Retiro ATM',
                    'amount': 150.00,
                    'type': 'debit'
                }
            ]
            
            result = service_enhanced.extract_from_text(sample_text)
            
            # Verify text structure preservation
            assert result.success
            assert result.original_structure is not None
            assert result.original_data is not None
            
            # Verify metadata includes text-specific information
            assert result.metadata['text_length'] == len(sample_text)
            assert result.metadata['original_text_lines'] > 0
    
    def test_error_handling_with_preservation(self, service_enhanced):
        """Test error handling maintains preservation behavior"""
        # Test with empty tables
        result = service_enhanced.extract_from_tables([])
        
        assert result.success is False
        assert result.error_message is not None
        assert result.original_structure is None
        assert result.original_data is None
    
    def test_serialization_of_enhanced_results(self, service_enhanced, sample_bcp_table):
        """Test that enhanced results can be properly serialized"""
        with mock.patch.object(service_enhanced, '_extract_with_groq') as mock_groq:
            mock_groq.return_value = [
                {
                    'date': '2025-01-01',
                    'description': 'Test',
                    'amount': 100.00,
                    'type': 'debit'
                }
            ]
            
            result = service_enhanced.extract_from_tables([sample_bcp_table])
            
            # Test serialization to dictionary
            result_dict = result.to_dict()
            
            # Verify all enhanced fields are serializable
            assert 'original_structure' in result_dict
            assert 'original_data' in result_dict
            
            # Test JSON serialization
            json_str = json.dumps(result_dict)
            assert isinstance(json_str, str)
            
            # Test deserialization
            parsed = json.loads(json_str)
            assert 'original_structure' in parsed
            assert 'original_data' in parsed
    
    def test_performance_with_large_tables(self, service_enhanced):
        """Test performance with larger table structures"""
        # Create a larger table for performance testing
        large_table = pd.DataFrame({
            'Fecha': [f'0{i}/01/2025' for i in range(1, 100)],
            'Descripción': [f'Transaction {i}' for i in range(1, 100)],
            'Debe': [float(i * 10) if i % 2 == 0 else 0.0 for i in range(1, 100)],
            'Haber': [0.0 if i % 2 == 0 else float(i * 10) for i in range(1, 100)],
            'Saldo': [float(1000 + i * 10) for i in range(1, 100)]
        })
        
        with mock.patch.object(service_enhanced, '_extract_with_groq') as mock_groq:
            mock_groq.return_value = []
            
            result = service_enhanced.extract_from_tables([large_table])
            
            # Verify large table handling
            assert result.success
            assert result.original_structure is not None
            assert result.original_data is not None
            assert len(result.original_data) == 99
            
            # Verify performance is reasonable (processing time recorded)
            assert result.processing_time > 0
    
    def test_configuration_override_behavior(self):
        """Test configuration file override behavior for preservation settings"""
        config = {
            'preserve_original_data': False,
            'backward_compatibility_mode': True,
            'groq_model': 'meta-llama/llama-4-scout-17b-16e-instruct',
            'column_keywords': {
                'date': ['fecha', 'date'],
                'description': ['concepto', 'description'],
                'debit': ['debe', 'debit'],
                'credit': ['haber', 'credit'],
                'amount': ['importe', 'amount'],
                'balance': ['saldo', 'balance']
            },
            # Add validation service config
            'amount_patterns': [r'\d+\.\d{2}', r'\d+,\d{2}'],
            'date_patterns': [r'\d{1,2}[/-]\d{1,2}[/-]\d{2,4}'],
            'description_patterns': [r'[a-zA-Z\s]+'],
            'balance_tolerance': 0.01,
            'min_description_length': 3,
            'max_description_length': 200,
            'suspicious_amount_threshold': 1000000
        }
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(config, f)
            config_path = f.name
        
        try:
            # Create service with config override
            service = TransactionExtractorService(
                config_path=config_path,
                preserve_original_data=True  # Should be overridden by config
            )
            
            # Verify config overrode the parameter
            assert service.preserve_original_data is False
            
        finally:
            os.unlink(config_path)


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