#!/usr/bin/env python3
"""
Integration test for ModernTableDetector with existing system

This script tests the integration of ModernTableDetector with the current
PDF processing pipeline and compares it against the existing Camelot implementation.
"""

import os
import sys
import json
import time
from pathlib import Path

# Add the src directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

from src.services.modernTableDetector import ModernTableDetector


def test_integration_with_sample_pdfs():
    """Test ModernTableDetector with available sample PDFs"""
    print("=== ModernTableDetector Integration Test ===\n")
    
    # Initialize detector
    detector = ModernTableDetector(debug=True)
    
    # Look for sample PDFs
    pdf_dir = Path(__file__).parent / "pdf"
    sample_files = []
    
    if pdf_dir.exists():
        sample_files = list(pdf_dir.glob("*.pdf"))
    
    if not sample_files:
        print("No sample PDF files found in ./pdf/ directory")
        print("Please add some sample banking PDFs to test with")
        return
    
    print(f"Found {len(sample_files)} sample PDF files:")
    for pdf_file in sample_files:
        print(f"  - {pdf_file.name}")
    
    print("\n" + "="*50)
    
    # Test each PDF
    total_tables = 0
    total_time = 0
    successful_files = 0
    
    for pdf_file in sample_files:
        print(f"\nProcessing: {pdf_file.name}")
        print("-" * 40)
        
        try:
            # Test basic table detection
            start_time = time.time()
            tables = detector.detect_tables(str(pdf_file))
            detection_time = time.time() - start_time
            
            print(f"Basic detection: {len(tables)} tables in {detection_time:.2f}s")
            
            # Test confidence-based extraction
            start_time = time.time()
            result = detector.extract_tables_with_confidence(str(pdf_file))
            extraction_time = time.time() - start_time
            
            print(f"Confidence extraction: {len(result.tables)} high-confidence tables in {extraction_time:.2f}s")
            print(f"Success: {result.success}")
            
            if result.metadata:
                print(f"Average confidence: {result.metadata.get('average_confidence', 0):.2f}")
                print(f"Quality distribution: {result.metadata.get('quality_distribution', {})}")
                print(f"Strategies used: {result.metadata.get('detection_strategies_used', [])}")
            
            # Test structure analysis
            structure = detector.get_table_structure(str(pdf_file))
            print(f"Structure analysis: {structure.get('table_count', 0)} tables detected")
            print(f"Recommended method: {structure.get('recommended_extraction_method', 'unknown')}")
            
            # Show sample table data if available
            if result.tables:
                sample_table = result.tables[0]
                print(f"\nSample table (page {sample_table.page_number}):")
                print(f"  Shape: {sample_table.data.shape}")
                print(f"  Confidence: {sample_table.confidence:.2f}")
                print(f"  Method: {sample_table.method_used}")
                print(f"  Quality metrics: {sample_table.quality_metrics}")
                
                # Show first few rows
                if not sample_table.data.empty:
                    print("  First few rows:")
                    print(sample_table.data.head(3).to_string(index=False))
            
            total_tables += len(result.tables)
            total_time += extraction_time
            successful_files += 1
            
        except Exception as e:
            print(f"ERROR processing {pdf_file.name}: {e}")
            import traceback
            traceback.print_exc()
    
    # Summary
    print("\n" + "="*50)
    print("INTEGRATION TEST SUMMARY")
    print("="*50)
    print(f"Files processed: {len(sample_files)}")
    print(f"Successful: {successful_files}")
    print(f"Total tables found: {total_tables}")
    print(f"Average processing time: {total_time/len(sample_files):.2f}s per file")
    print(f"Success rate: {successful_files/len(sample_files)*100:.1f}%")
    
    if successful_files > 0:
        print(f"Average tables per successful file: {total_tables/successful_files:.1f}")


def test_comparison_with_legacy():
    """Compare ModernTableDetector with legacy Camelot implementation"""
    print("\n=== Legacy Comparison Test ===\n")
    
    try:
        import camelot
        print("Camelot available for comparison")
    except ImportError:
        print("Camelot not available - skipping comparison")
        return
    
    # Initialize detectors
    modern_detector = ModernTableDetector(debug=False)
    
    # Look for sample PDFs
    pdf_dir = Path(__file__).parent / "pdf"
    sample_files = list(pdf_dir.glob("*.pdf")) if pdf_dir.exists() else []
    
    if not sample_files:
        print("No sample PDF files found for comparison")
        return
    
    # Test first file for comparison
    test_file = sample_files[0]
    print(f"Comparing with file: {test_file.name}")
    
    # Modern detector
    print("\nModern Detector (pdfplumber):")
    start_time = time.time()
    modern_result = modern_detector.extract_tables_with_confidence(str(test_file))
    modern_time = time.time() - start_time
    
    print(f"  Tables found: {len(modern_result.tables)}")
    print(f"  Processing time: {modern_time:.2f}s")
    print(f"  Success: {modern_result.success}")
    if modern_result.metadata:
        print(f"  Average confidence: {modern_result.metadata.get('average_confidence', 0):.2f}")
    
    # Legacy detector (Camelot)
    print("\nLegacy Detector (Camelot):")
    start_time = time.time()
    try:
        # Try lattice first
        camelot_tables = camelot.read_pdf(str(test_file), flavor='lattice', pages='all')
        legacy_tables = [table.df for table in camelot_tables]
        
        if not legacy_tables:
            # Try stream if lattice failed
            camelot_tables = camelot.read_pdf(str(test_file), flavor='stream', pages='all', row_tol=10)
            legacy_tables = [table.df for table in camelot_tables]
        
        legacy_time = time.time() - start_time
        
        print(f"  Tables found: {len(legacy_tables)}")
        print(f"  Processing time: {legacy_time:.2f}s")
        print(f"  Success: {len(legacy_tables) > 0}")
        
        # Compare table content if both found tables
        if modern_result.tables and legacy_tables:
            modern_table = modern_result.tables[0]
            legacy_table = legacy_tables[0]
            
            print(f"\nTable Comparison:")
            print(f"  Modern shape: {modern_table.data.shape}")
            print(f"  Legacy shape: {legacy_table.shape}")
            
            # Calculate fill ratios
            modern_filled = modern_table.data.count().sum()
            modern_total = modern_table.data.shape[0] * modern_table.data.shape[1]
            modern_fill_ratio = modern_filled / modern_total if modern_total > 0 else 0
            
            legacy_filled = legacy_table.count().sum()
            legacy_total = legacy_table.shape[0] * legacy_table.shape[1]
            legacy_fill_ratio = legacy_filled / legacy_total if legacy_total > 0 else 0
            
            print(f"  Modern fill ratio: {modern_fill_ratio:.2f}")
            print(f"  Legacy fill ratio: {legacy_fill_ratio:.2f}")
        
    except Exception as e:
        legacy_time = time.time() - start_time
        print(f"  ERROR: {e}")
        print(f"  Processing time: {legacy_time:.2f}s")
        print(f"  Success: False")
    
    # Performance comparison
    print(f"\nPerformance Comparison:")
    if 'legacy_time' in locals():
        speed_improvement = ((legacy_time - modern_time) / legacy_time) * 100 if legacy_time > 0 else 0
        print(f"  Speed improvement: {speed_improvement:+.1f}%")
    print(f"  Modern time: {modern_time:.2f}s")
    if 'legacy_time' in locals():
        print(f"  Legacy time: {legacy_time:.2f}s")


def test_error_handling():
    """Test error handling capabilities"""
    print("\n=== Error Handling Test ===\n")
    
    detector = ModernTableDetector(debug=True)
    
    # Test with non-existent file
    print("Testing with non-existent file:")
    result = detector.extract_tables_with_confidence("nonexistent.pdf")
    print(f"  Success: {result.success}")
    print(f"  Error message: {result.error_message}")
    print(f"  Tables: {len(result.tables)}")
    
    # Test with invalid file path
    print("\nTesting with invalid path:")
    tables = detector.detect_tables("")
    print(f"  Tables returned: {len(tables)}")
    
    # Test structure analysis with invalid file
    print("\nTesting structure analysis with invalid file:")
    structure = detector.get_table_structure("invalid.pdf")
    print(f"  Has tables: {structure.get('has_tables', False)}")
    print(f"  Error: {structure.get('error', 'No error')}")


def main():
    """Run all integration tests"""
    print("Starting ModernTableDetector Integration Tests")
    print("=" * 60)
    
    # Test 1: Basic integration with sample PDFs
    test_integration_with_sample_pdfs()
    
    # Test 2: Comparison with legacy implementation
    test_comparison_with_legacy()
    
    # Test 3: Error handling
    test_error_handling()
    
    print("\n" + "=" * 60)
    print("Integration tests completed!")


if __name__ == "__main__":
    main()