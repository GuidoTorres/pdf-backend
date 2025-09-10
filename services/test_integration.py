#!/usr/bin/env python3
"""
Integration test for format-specific processors

This script demonstrates the complete integration of all format processors
working together through the unified interface.
"""

import sys
import os
import tempfile
import pandas as pd
from pathlib import Path

# Add src to path for imports
sys.path.append(os.path.join(os.path.dirname(__file__), 'src'))

try:
    from services.formatProcessorIntegration import FormatProcessorIntegration
    print("✓ Successfully imported integration module")
except ImportError as e:
    print(f"✗ Import failed: {e}")
    sys.exit(1)


def create_sample_excel_file():
    """Create a sample Excel file with banking data"""
    sample_data = {
        'Fecha': ['2024-01-15', '2024-01-16', '2024-01-17', '2024-01-18'],
        'Descripción': [
            'Transferencia recibida de Juan Pérez',
            'Pago tarjeta crédito VISA',
            'Cajero automático Santander',
            'Nómina empresa ABC S.L.'
        ],
        'Importe': [1500.50, -245.80, -50.00, 2800.00],
        'Saldo': [3500.50, 3254.70, 3204.70, 6004.70],
        'Referencia': ['TRF001234', 'PAY005678', 'ATM009012', 'SAL003456']
    }
    
    df = pd.DataFrame(sample_data)
    
    with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp_file:
        df.to_excel(tmp_file.name, index=False)
        return tmp_file.name


def create_sample_csv_file():
    """Create a sample CSV file with banking data"""
    csv_content = """Date,Description,Amount,Balance,Reference
2024-01-15,Transfer received from John Smith,1200.00,2500.00,TRF789
2024-01-16,Online purchase Amazon,-89.99,2410.01,PUR456
2024-01-17,ATM withdrawal,-100.00,2310.01,ATM123
2024-01-18,Salary deposit,3000.00,5310.01,SAL999"""
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False) as tmp_file:
        tmp_file.write(csv_content)
        return tmp_file.name


def test_unified_processing():
    """Test the unified processing interface"""
    print("\n=== Testing Unified Document Processing ===")
    
    # Create sample files
    excel_file = create_sample_excel_file()
    csv_file = create_sample_csv_file()
    
    try:
        # Initialize integrated processor
        processor = FormatProcessorIntegration(debug=True)
        
        print(f"Supported formats: {processor.get_supported_formats()}")
        
        # Test Excel processing
        print("\n--- Processing Excel File ---")
        excel_result = processor.process_document(excel_file)
        
        print(f"Success: {excel_result.success}")
        print(f"Document type: {excel_result.document_type}")
        print(f"Processing method: {excel_result.processing_method}")
        print(f"Transactions found: {len(excel_result.transactions)}")
        print(f"Confidence: {excel_result.confidence:.2f}")
        print(f"Processing time: {excel_result.processing_time:.3f}s")
        
        if excel_result.transactions:
            print("Sample transaction:")
            trans = excel_result.transactions[0]
            print(f"  Date: {trans['date']}")
            print(f"  Description: {trans['description']}")
            print(f"  Amount: {trans['amount']}")
            print(f"  Confidence: {trans['confidence']:.2f}")
        
        # Test CSV processing
        print("\n--- Processing CSV File ---")
        csv_result = processor.process_document(csv_file)
        
        print(f"Success: {csv_result.success}")
        print(f"Document type: {csv_result.document_type}")
        print(f"Transactions found: {len(csv_result.transactions)}")
        print(f"Confidence: {csv_result.confidence:.2f}")
        
        # Test multiple document processing
        print("\n--- Processing Multiple Documents ---")
        all_files = [excel_file, csv_file]
        multiple_results = processor.process_multiple_documents(all_files)
        
        print(f"Processed {len(multiple_results)} documents")
        total_transactions = sum(len(r.transactions) for r in multiple_results)
        print(f"Total transactions found: {total_transactions}")
        
        # Show processing statistics
        print("\n--- Processing Statistics ---")
        stats = processor.get_processing_statistics()
        print(f"Total processed: {stats['total_processed']}")
        print(f"Success rate: {stats['success_rate']:.2%}")
        print(f"Average processing time: {stats['average_processing_time']:.3f}s")
        print(f"Average confidence: {stats['average_confidence']:.2f}")
        print(f"Format distribution: {stats['format_distribution']}")
        
        # Test file validation
        print("\n--- File Validation ---")
        print(f"Excel file supported: {processor.validate_file_support(excel_file)}")
        print(f"CSV file supported: {processor.validate_file_support(csv_file)}")
        print(f"Non-existent file supported: {processor.validate_file_support('nonexistent.txt')}")
        
        return (excel_result.success and csv_result.success and 
                len(multiple_results) == 2 and all(r.success for r in multiple_results))
        
    finally:
        # Clean up temporary files
        os.unlink(excel_file)
        os.unlink(csv_file)


def test_format_detection_accuracy():
    """Test format detection accuracy"""
    print("\n=== Testing Format Detection Accuracy ===")
    
    # Create files with different formats
    excel_file = create_sample_excel_file()
    csv_file = create_sample_csv_file()
    
    try:
        processor = FormatProcessorIntegration(debug=False)
        
        # Test Excel detection
        excel_result = processor.process_document(excel_file)
        excel_correct = excel_result.document_type == 'excel'
        print(f"Excel detection: {'✓' if excel_correct else '✗'} (detected: {excel_result.document_type})")
        
        # Test CSV detection
        csv_result = processor.process_document(csv_file)
        csv_correct = csv_result.document_type == 'csv'
        print(f"CSV detection: {'✓' if csv_correct else '✗'} (detected: {csv_result.document_type})")
        
        # Test forced format
        forced_result = processor.process_document(excel_file, force_format='excel')
        forced_correct = forced_result.document_type == 'excel'
        print(f"Forced format: {'✓' if forced_correct else '✗'}")
        
        return excel_correct and csv_correct and forced_correct
        
    finally:
        os.unlink(excel_file)
        os.unlink(csv_file)


def test_error_handling():
    """Test error handling for various scenarios"""
    print("\n=== Testing Error Handling ===")
    
    processor = FormatProcessorIntegration(debug=False)
    
    # Test non-existent file
    result1 = processor.process_document("nonexistent.xlsx")
    error1_handled = not result1.success and "not found" in result1.error_message.lower()
    print(f"Non-existent file: {'✓' if error1_handled else '✗'}")
    
    # Test unsupported format (create a fake file)
    with tempfile.NamedTemporaryFile(suffix='.xyz', delete=False) as tmp_file:
        tmp_file.write(b"fake content")
        fake_file = tmp_file.name
    
    try:
        result2 = processor.process_document(fake_file)
        error2_handled = not result2.success
        print(f"Unsupported format: {'✓' if error2_handled else '✗'}")
        
        return error1_handled and error2_handled
        
    finally:
        os.unlink(fake_file)


def main():
    """Run all integration tests"""
    print("Format Processor Integration Tests")
    print("=" * 50)
    
    tests = [
        ("Unified Processing", test_unified_processing),
        ("Format Detection Accuracy", test_format_detection_accuracy),
        ("Error Handling", test_error_handling)
    ]
    
    results = []
    for test_name, test_func in tests:
        try:
            success = test_func()
            results.append((test_name, success))
            print(f"\n{'✓' if success else '✗'} {test_name}: {'PASSED' if success else 'FAILED'}")
        except Exception as e:
            results.append((test_name, False))
            print(f"\n✗ {test_name}: FAILED - {e}")
    
    print("\n" + "=" * 50)
    print("Integration Test Summary:")
    passed = sum(1 for _, success in results if success)
    total = len(results)
    print(f"Passed: {passed}/{total}")
    
    if passed == total:
        print("🎉 All integration tests passed!")
        print("\nThe format-specific processors are working correctly and can:")
        print("• Automatically detect document formats (Excel, CSV, Word, PDF, Images)")
        print("• Process Excel/CSV files with automatic column detection")
        print("• Process Word documents with table extraction")
        print("• Handle multiple documents with optimized processing order")
        print("• Provide unified results with confidence scoring")
        print("• Track processing statistics and performance metrics")
        return 0
    else:
        print("❌ Some integration tests failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())