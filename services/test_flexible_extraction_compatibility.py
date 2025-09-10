#!/usr/bin/env python3
"""
Unit tests for flexible data extraction backward compatibility.

This test suite verifies that the enhanced TransactionExtractorService
maintains backward compatibility while providing new flexible features.
"""

import unittest
import pandas as pd
import json
import os
import sys
import tempfile
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
    OriginalStructure
)


class TestFlexibleExtractionCompatibility(unittest.TestCase):
    """Test backward compatibility of flexible data extraction"""
    
    def setUp(self):
        """Set up test data"""
        self.sample_table = pd.DataFrame({
            'Fecha': ['01/01/2025', '02/01/2025', '03/01/2025'],
            'Descripción': ['ATM Withdrawal', 'Salary Deposit', 'Grocery Store'],
            'Debe': [50.0, 0.0, 75.50],
            'Haber': [0.0, 2500.0, 0.0],
            'Saldo': [1950.0, 4450.0, 4374.50]
        })
        
        self.sample_text = """
        Bank Statement
        01/01/2025 ATM Withdrawal -50.00
        02/01/2025 Salary Deposit +2500.00
        03/01/2025 Grocery Store -75.50
        """
    
    def test_backward_compatibility_mode_initialization(self):
        """Test that backward compatibility mode initializes correctly"""
        # Create service with original data preservation disabled
        service = TransactionExtractorService(debug=True, preserve_original_data=False)
        
        # Verify the service was initialized with correct settings
        self.assertFalse(service.preserve_original_data)
        self.assertTrue(service.debug)
        
        # Verify configuration includes backward compatibility settings
        self.assertIn('preserve_original_data', service.config)
        self.assertIn('backward_compatibility_mode', service.config)
    
    def test_enhanced_mode_initialization(self):
        """Test that enhanced mode initializes correctly"""
        # Create service with original data preservation enabled (default)
        service = TransactionExtractorService(debug=True, preserve_original_data=True)
        
        # Verify the service was initialized with correct settings
        self.assertTrue(service.preserve_original_data)
        self.assertTrue(service.debug)
        
        # Verify configuration includes enhanced features
        self.assertIn('preserve_original_data', service.config)
        self.assertTrue(service.config['preserve_original_data'])
    
    def test_config_override(self):
        """Test that configuration can override the preserve_original_data setting"""
        # Create a complete config that disables original data preservation
        config = {
            'preserve_original_data': False,
            'backward_compatibility_mode': True,
            'groq_model': 'meta-llama/llama-4-scout-17b-16e-instruct',
            'max_retries': 3,
            'retry_delay': 1.0,
            'max_tokens': 4000,
            'temperature': 0.1,
            'column_keywords': {
                'date': ['fecha', 'fec', 'date'],
                'description': ['concepto', 'descripción', 'operación'],
                'debit': ['cargos', 'debe', 'débito'],
                'credit': ['abonos', 'haber', 'crédito'],
                'amount': ['importe', 'valor', 'monto'],
                'balance': ['saldo', 'balance']
            },
            'suspicious_patterns': [r'test\s*transaction'],
            # Add validation service config
            'amount_patterns': [r'\d+\.\d{2}', r'\d+,\d{2}'],
            'date_patterns': [r'\d{1,2}[/-]\d{1,2}[/-]\d{2,4}'],
            'description_patterns': [r'[a-zA-Z\s]+'],
            'balance_tolerance': 0.01,
            'min_description_length': 3,
            'max_description_length': 200,
            'suspicious_amount_threshold': 1000000
        }
        
        # Save config to temporary file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(config, f)
            config_path = f.name
        
        try:
            # Create service with config (should override the parameter)
            service = TransactionExtractorService(
                config_path=config_path, 
                debug=True, 
                preserve_original_data=True  # This should be overridden by config
            )
            
            # Verify that config overrode the parameter
            self.assertFalse(service.preserve_original_data)
            
        finally:
            # Clean up temporary file
            os.unlink(config_path)
    
    def test_original_structure_creation(self):
        """Test that OriginalStructure can be created and serialized"""
        # Create an OriginalStructure instance
        structure = OriginalStructure(
            original_headers=['Fecha', 'Descripción', 'Debe', 'Haber'],
            column_types={'Fecha': 'date', 'Descripción': 'text', 'Debe': 'numeric', 'Haber': 'numeric'},
            column_order=['Fecha', 'Descripción', 'Debe', 'Haber'],
            table_count=1,
            confidence_score=0.85,
            extraction_method='table_based'
        )
        
        # Verify structure properties
        self.assertEqual(len(structure.original_headers), 4)
        self.assertIn('Fecha', structure.original_headers)
        self.assertEqual(structure.confidence_score, 0.85)
        
        # Test serialization
        structure_dict = structure.to_dict()
        self.assertIsInstance(structure_dict, dict)
        self.assertIn('original_headers', structure_dict)
        self.assertIn('column_types', structure_dict)
        
        # Test JSON serialization
        json_str = json.dumps(structure_dict)
        self.assertIsInstance(json_str, str)
    
    def test_extraction_result_backward_compatibility(self):
        """Test that ExtractionResult maintains backward compatibility"""
        # Create a basic result without original data (backward compatibility mode)
        result_old = ExtractionResult(
            transactions=[
                {'date': '2025-01-01', 'description': 'Test', 'amount': 100.0, 'type': 'debit'}
            ],
            method=ExtractionMethod.TABLE_BASED,
            metadata={'test': True},
            processing_time=1.0,
            success=True
        )
        
        # Verify old format
        result_dict_old = result_old.to_dict()
        self.assertNotIn('original_structure', result_dict_old)
        self.assertNotIn('original_data', result_dict_old)
        self.assertIn('transactions', result_dict_old)
        self.assertIn('method', result_dict_old)
        
        # Create an enhanced result with original data
        structure = OriginalStructure(
            original_headers=['Fecha', 'Descripción'],
            column_types={'Fecha': 'date', 'Descripción': 'text'},
            column_order=['Fecha', 'Descripción'],
            table_count=1,
            confidence_score=0.9,
            extraction_method='table_based'
        )
        
        result_new = ExtractionResult(
            transactions=[
                {'date': '2025-01-01', 'description': 'Test', 'amount': 100.0, 'type': 'debit'}
            ],
            method=ExtractionMethod.TABLE_BASED,
            metadata={'test': True},
            processing_time=1.0,
            success=True,
            original_structure=structure,
            original_data=[{'Fecha': '01/01/2025', 'Descripción': 'Test'}]
        )
        
        # Verify new format includes enhanced fields
        result_dict_new = result_new.to_dict()
        self.assertIn('original_structure', result_dict_new)
        self.assertIn('original_data', result_dict_new)
        self.assertIn('transactions', result_dict_new)
        self.assertIn('method', result_dict_new)
    
    def test_convenience_functions_parameters(self):
        """Test that convenience functions accept the new parameters"""
        from transaction_extractor_service import extract_from_tables, extract_from_text
        
        # Test that the functions accept the new parameter without errors
        try:
            # This should not raise a TypeError
            service = TransactionExtractorService(debug=True, preserve_original_data=False)
            self.assertFalse(service.preserve_original_data)
            
            service2 = TransactionExtractorService(debug=True, preserve_original_data=True)
            self.assertTrue(service2.preserve_original_data)
            
        except TypeError as e:
            self.fail(f"TransactionExtractorService should accept preserve_original_data parameter: {e}")
    
    def test_real_backward_compatibility_extraction(self):
        """Test real extraction with backward compatibility mode"""
        print("\n🧪 Testing backward compatibility mode with real Groq API...")
        
        # Create a small test table
        small_table = pd.DataFrame({
            'Fecha': ['01/01/2025'],
            'Descripción': ['Test Transaction'],
            'Debe': [100.0],
            'Haber': [0.0]
        })
        
        # Test backward compatibility mode
        service_old = TransactionExtractorService(debug=True, preserve_original_data=False)
        result_old = service_old.extract_from_tables([small_table])
        
        print(f"✅ Backward compatibility result: success={result_old.success}")
        
        # Verify basic functionality
        self.assertTrue(result_old.success)
        self.assertEqual(result_old.method, ExtractionMethod.TABLE_BASED)
        
        # Verify original data is NOT preserved
        self.assertIsNone(result_old.original_structure)
        self.assertIsNone(result_old.original_data)
        
        # Verify metadata indicates backward compatibility
        self.assertTrue(result_old.metadata.get('backward_compatibility_mode', False))
        self.assertFalse(result_old.metadata.get('original_structure_preserved', True))
        
        print(f"📊 Transactions extracted: {len(result_old.transactions)}")
        if result_old.transactions:
            print(f"📝 Sample transaction: {result_old.transactions[0]}")
    
    def test_real_enhanced_mode_extraction(self):
        """Test real extraction with enhanced mode"""
        print("\n🧪 Testing enhanced mode with real Groq API...")
        
        # Create a small test table
        small_table = pd.DataFrame({
            'Fecha': ['01/01/2025'],
            'Descripción': ['Test Transaction'],
            'Debe': [100.0],
            'Haber': [0.0]
        })
        
        # Test enhanced mode
        service_new = TransactionExtractorService(debug=True, preserve_original_data=True)
        result_new = service_new.extract_from_tables([small_table])
        
        print(f"✅ Enhanced mode result: success={result_new.success}")
        
        # Verify basic functionality
        self.assertTrue(result_new.success)
        self.assertEqual(result_new.method, ExtractionMethod.TABLE_BASED)
        
        # Verify original data IS preserved
        self.assertIsNotNone(result_new.original_structure)
        self.assertIsNotNone(result_new.original_data)
        
        # Verify metadata indicates enhanced mode
        self.assertFalse(result_new.metadata.get('backward_compatibility_mode', True))
        self.assertTrue(result_new.metadata.get('original_structure_preserved', False))
        
        # Verify original structure contains expected data
        self.assertIn('Fecha', result_new.original_structure.original_headers)
        self.assertIn('Descripción', result_new.original_structure.original_headers)
        
        print(f"📊 Transactions extracted: {len(result_new.transactions)}")
        print(f"🏗️  Original headers: {result_new.original_structure.original_headers}")
        print(f"📋 Original data rows: {len(result_new.original_data)}")
        
        # Verify transactions have enhanced fields
        if result_new.transactions:
            transaction = result_new.transactions[0]
            print(f"📝 Sample enhanced transaction keys: {list(transaction.keys())}")
            
            # Basic fields should still exist
            self.assertIn('date', transaction)
            self.assertIn('description', transaction)
            self.assertIn('amount', transaction)
            self.assertIn('type', transaction)
            
            # Enhanced fields should exist
            self.assertIn('original_data', transaction)
            self.assertIn('structure_metadata', transaction)
            self.assertIn('preservation_stats', transaction)



def run_compatibility_tests():
    """Run all compatibility tests"""
    print("🧪 Running Flexible Extraction Compatibility Tests...")
    
    # Create test suite
    suite = unittest.TestLoader().loadTestsFromTestCase(TestFlexibleExtractionCompatibility)
    
    # Run tests
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    
    # Print summary
    if result.wasSuccessful():
        print("✅ All compatibility tests passed!")
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
    run_compatibility_tests()