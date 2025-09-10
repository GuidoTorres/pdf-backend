#!/usr/bin/env python3
"""
Test script for format-specific processors

This script tests the ExcelProcessor, WordProcessor, and FormatDetector
implementations to ensure they work correctly.
"""

import sys
import os
import tempfile
import pandas as pd
from pathlib import Path

# Add src to path for imports
sys.path.append(os.path.join(os.path.dirname(__file__), 'src'))

try:
    from services.excelProcessor import ExcelProcessor
    from services.wordProcessor import WordProcessor
    from services.formatDetector import FormatDetector
    print("✓ Successfully imported all processors")
except ImportError as e:
    print(f"✗ Import failed: {e}")
    sys.exit(1)


def test_excel_processor():
    """Test Excel processor with sample data"""
    print("\n=== Testing Excel Processor ===")
    
    # Create sample banking data
    sample_data = {
        'Fecha': ['2024-01-15', '2024-01-16', '2024-01-17'],
        'Descripción': ['Transferencia recibida', 'Pago tarjeta', 'Cajero automático'],
        'Importe': [1500.50, -45.20, -50.00],
        'Saldo': [2500.50, 2455.30, 2405.30],
        'Referencia': ['TRF001', 'PAY002', 'ATM003']
    }
    
    df = pd.DataFrame(sample_data)
    
    # Create temporary Excel file
    with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp_file:
        df.to_excel(tmp_file.name, index=False)
        temp_excel_path = tmp_file.name
    
    try:
        processor = ExcelProcessor(debug=True)
        result = processor.process_excel(temp_excel_path)
        
        print(f"Processing success: {result.success}")
        print(f"Transactions found: {len(result.transactions)}")
        print(f"Column mapping confidence: {result.column_mapping.confidence:.2f}")
        print(f"Detected columns: {result.column_mapping.__dict__}")
        
        if result.transactions:
            print("Sample transaction:")
            print(f"  Date: {result.transactions[0].date}")
            print(f"  Description: {result.transactions[0].description}")
            print(f"  Amount: {result.transactions[0].amount}")
            print(f"  Confidence: {result.transactions[0].confidence:.2f}")
        
        return result.success
        
    finally:
        os.unlink(temp_excel_path)


def test_csv_processor():
    """Test CSV processor with sample data"""
    print("\n=== Testing CSV Processor ===")
    
    # Create sample CSV content
    csv_content = """Date,Description,Amount,Balance
2024-01-15,Transfer received,1500.50,2500.50
2024-01-16,Card payment,-45.20,2455.30
2024-01-17,ATM withdrawal,-50.00,2405.30"""
    
    # Create temporary CSV file
    with tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False) as tmp_file:
        tmp_file.write(csv_content)
        temp_csv_path = tmp_file.name
    
    try:
        processor = ExcelProcessor(debug=True)
        result = processor.process_csv(temp_csv_path)
        
        print(f"Processing success: {result.success}")
        print(f"Transactions found: {len(result.transactions)}")
        print(f"Column mapping confidence: {result.column_mapping.confidence:.2f}")
        
        return result.success
        
    finally:
        os.unlink(temp_csv_path)


def test_word_processor():
    """Test Word processor (basic functionality)"""
    print("\n=== Testing Word Processor ===")
    
    try:
        processor = WordProcessor(debug=True)
        
        # Test with a non-existent file to check error handling
        result = processor.process_word("non_existent.docx")
        
        print(f"Error handling works: {not result.success}")
        print(f"Error message: {result.error_message}")
        
        # Test supported formats
        supported = processor.get_supported_formats()
        print(f"Supported formats: {supported}")
        
        return True
        
    except Exception as e:
        print(f"Word processor test failed: {e}")
        return False


def test_format_detector():
    """Test format detector with sample files"""
    print("\n=== Testing Format Detector ===")
    
    try:
        detector = FormatDetector(debug=True)
        
        # Test with temporary Excel file
        sample_data = pd.DataFrame({
            'Date': ['2024-01-15'],
            'Amount': [100.50]
        })
        
        with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp_file:
            sample_data.to_excel(tmp_file.name, index=False)
            temp_excel_path = tmp_file.name
        
        try:
            result = detector.detect_format(temp_excel_path)
            
            print(f"Detected format: {result.detected_format}")
            print(f"Confidence: {result.confidence:.2f}")
            print(f"MIME type: {result.mime_type}")
            print(f"Recommended processor: {result.recommended_processor}")
            print(f"Processing strategy: {result.processing_strategy}")
            print(f"Banking score: {result.content_analysis.get('banking_score', 0):.2f}")
            
            # Test supported formats
            supported = detector.get_supported_formats()
            print(f"Supported formats: {supported}")
            
            return result.detected_format == 'excel'
            
        finally:
            os.unlink(temp_excel_path)
            
    except Exception as e:
        print(f"Format detector test failed: {e}")
        return False


def main():
    """Run all tests"""
    print("Testing Format-Specific Processors")
    print("=" * 50)
    
    tests = [
        ("Excel Processor", test_excel_processor),
        ("CSV Processor", test_csv_processor),
        ("Word Processor", test_word_processor),
        ("Format Detector", test_format_detector)
    ]
    
    results = []
    for test_name, test_func in tests:
        try:
            success = test_func()
            results.append((test_name, success))
            print(f"✓ {test_name}: {'PASSED' if success else 'FAILED'}")
        except Exception as e:
            results.append((test_name, False))
            print(f"✗ {test_name}: FAILED - {e}")
    
    print("\n" + "=" * 50)
    print("Test Summary:")
    passed = sum(1 for _, success in results if success)
    total = len(results)
    print(f"Passed: {passed}/{total}")
    
    if passed == total:
        print("🎉 All tests passed!")
        return 0
    else:
        print("❌ Some tests failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())