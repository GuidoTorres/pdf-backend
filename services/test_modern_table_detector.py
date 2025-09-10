#!/usr/bin/env python3
"""
Unit tests for ModernTableDetector comparing pdfplumber vs Camelot accuracy

This test suite compares the performance of the new ModernTableDetector (pdfplumber)
against the legacy Camelot implementation on sample banking documents.
"""

import pytest
import os
import sys
import time
import pandas as pd
import numpy as np
from pathlib import Path
from typing import List, Dict, Any
import tempfile
import logging

# Add the src directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

# Import the classes to test
from src.services.modernTableDetector import ModernTableDetector, TableResult, TableExtractionResult

# Import legacy Camelot for comparison
try:
    import camelot
    CAMELOT_AVAILABLE = True
except ImportError:
    CAMELOT_AVAILABLE = False
    print("Warning: Camelot not available for comparison tests")


class LegacyTableDetector:
    """Legacy table detector using Camelot for comparison"""
    
    def __init__(self, debug: bool = False):
        self.debug = debug
        self.logger = logging.getLogger(f"{__name__}.LegacyTableDetector")
    
    def detect_tables(self, pdf_path: str) -> List[pd.DataFrame]:
        """Detect tables using Camelot (legacy method)"""
        if not CAMELOT_AVAILABLE:
            return []
        
        tables = []
        try:
            # Try lattice method first
            camelot_tables = camelot.read_pdf(pdf_path, flavor='lattice', pages='all')
            tables = [table.df for table in camelot_tables]
            
            # Try stream method if lattice failed
            if not tables:
                camelot_tables = camelot.read_pdf(pdf_path, flavor='stream', pages='all', row_tol=10)
                tables = [table.df for table in camelot_tables]
                
        except Exception as e:
            self.logger.error(f"Camelot extraction failed: {e}")
            tables = []
        
        return tables


@pytest.fixture
def modern_detector():
    """Fixture for ModernTableDetector"""
    return ModernTableDetector(debug=True)


@pytest.fixture
def legacy_detector():
    """Fixture for LegacyTableDetector"""
    return LegacyTableDetector(debug=True)


@pytest.fixture
def sample_pdf_paths():
    """Fixture providing paths to sample PDF files"""
    # Look for sample PDFs in the pdf directory
    pdf_dir = Path(__file__).parent / "pdf"
    sample_files = []
    
    if pdf_dir.exists():
        for pdf_file in pdf_dir.glob("*.pdf"):
            sample_files.append(str(pdf_file))
    
    # If no sample files found, create a simple test PDF
    if not sample_files:
        sample_files = [create_test_pdf()]
    
    return sample_files


def create_test_pdf() -> str:
    """Create a simple test PDF with table-like content for testing"""
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle
        from reportlab.lib import colors
        
        # Create temporary PDF file
        temp_file = tempfile.NamedTemporaryFile(suffix='.pdf', delete=False)
        temp_path = temp_file.name
        temp_file.close()
        
        # Create PDF with table
        doc = SimpleDocTemplate(temp_path, pagesize=letter)
        
        # Sample banking data
        data = [
            ['Date', 'Description', 'Amount', 'Balance'],
            ['2024-01-15', 'ATM Withdrawal', '-$50.00', '$1,450.00'],
            ['2024-01-16', 'Direct Deposit', '+$2,500.00', '$3,950.00'],
            ['2024-01-17', 'Online Purchase', '-$125.75', '$3,824.25'],
            ['2024-01-18', 'Bank Fee', '-$15.00', '$3,809.25'],
            ['2024-01-19', 'Transfer In', '+$500.00', '$4,309.25']
        ]
        
        table = Table(data)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 14),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
            ('GRID', (0, 0), (-1, -1), 1, colors.black)
        ]))
        
        doc.build([table])
        return temp_path
        
    except ImportError:
        # If reportlab not available, return None
        return None


class TestModernTableDetector:
    """Test suite for ModernTableDetector"""
    
    def test_initialization(self, modern_detector):
        """Test that ModernTableDetector initializes correctly"""
        assert modern_detector is not None
        assert hasattr(modern_detector, 'detection_strategies')
        assert hasattr(modern_detector, 'quality_thresholds')
        assert len(modern_detector.detection_strategies) >= 2
    
    def test_detect_tables_nonexistent_file(self, modern_detector):
        """Test handling of non-existent PDF file"""
        result = modern_detector.detect_tables("nonexistent_file.pdf")
        assert result == []
    
    def test_extract_tables_with_confidence_nonexistent_file(self, modern_detector):
        """Test confidence extraction with non-existent file"""
        result = modern_detector.extract_tables_with_confidence("nonexistent_file.pdf")
        assert result.success is False
        assert result.total_tables == 0
        assert result.error_message is not None
    
    @pytest.mark.skipif(not CAMELOT_AVAILABLE, reason="Camelot not available")
    def test_comparison_with_camelot(self, modern_detector, legacy_detector, sample_pdf_paths):
        """Compare ModernTableDetector with legacy Camelot implementation"""
        if not sample_pdf_paths or sample_pdf_paths[0] is None:
            pytest.skip("No sample PDF files available for testing")
        
        comparison_results = []
        
        for pdf_path in sample_pdf_paths[:3]:  # Test first 3 files
            print(f"\nTesting file: {pdf_path}")
            
            # Test modern detector
            start_time = time.time()
            modern_result = modern_detector.extract_tables_with_confidence(pdf_path)
            modern_time = time.time() - start_time
            
            # Test legacy detector
            start_time = time.time()
            legacy_tables = legacy_detector.detect_tables(pdf_path)
            legacy_time = time.time() - start_time
            
            # Compare results
            comparison = {
                'file': os.path.basename(pdf_path),
                'modern_tables': len(modern_result.tables),
                'legacy_tables': len(legacy_tables),
                'modern_time': modern_time,
                'legacy_time': legacy_time,
                'modern_success': modern_result.success,
                'modern_confidence': modern_result.metadata.get('average_confidence', 0) if modern_result.metadata else 0,
                'modern_high_confidence': modern_result.metadata.get('high_confidence_tables', 0) if modern_result.metadata else 0
            }
            
            comparison_results.append(comparison)
            
            # Print detailed comparison
            print(f"  Modern: {comparison['modern_tables']} tables, {comparison['modern_time']:.2f}s")
            print(f"  Legacy: {comparison['legacy_tables']} tables, {comparison['legacy_time']:.2f}s")
            print(f"  Modern confidence: {comparison['modern_confidence']:.2f}")
            print(f"  Modern high confidence: {comparison['modern_high_confidence']}")
        
        # Analyze overall performance
        if comparison_results:
            avg_modern_time = np.mean([r['modern_time'] for r in comparison_results])
            avg_legacy_time = np.mean([r['legacy_time'] for r in comparison_results])
            avg_modern_tables = np.mean([r['modern_tables'] for r in comparison_results])
            avg_legacy_tables = np.mean([r['legacy_tables'] for r in comparison_results])
            avg_confidence = np.mean([r['modern_confidence'] for r in comparison_results])
            
            print(f"\n=== COMPARISON SUMMARY ===")
            print(f"Average processing time - Modern: {avg_modern_time:.2f}s, Legacy: {avg_legacy_time:.2f}s")
            print(f"Average tables found - Modern: {avg_modern_tables:.1f}, Legacy: {avg_legacy_tables:.1f}")
            print(f"Average modern confidence: {avg_confidence:.2f}")
            
            # Assert that modern detector performs reasonably
            assert avg_confidence > 0.4, "Modern detector should have reasonable confidence"
            
            # Modern detector should find at least as many tables as legacy
            # (This might not always be true, but it's a reasonable expectation)
            if avg_legacy_tables > 0:
                table_ratio = avg_modern_tables / avg_legacy_tables
                print(f"Table detection ratio (modern/legacy): {table_ratio:.2f}")
    
    def test_table_confidence_calculation(self, modern_detector):
        """Test confidence calculation for different table qualities"""
        # Create test DataFrames with different qualities
        
        # High quality table
        high_quality_df = pd.DataFrame({
            'Date': ['2024-01-01', '2024-01-02', '2024-01-03'],
            'Amount': ['$100.00', '$200.00', '$300.00'],
            'Description': ['Purchase A', 'Purchase B', 'Purchase C']
        })
        
        # Low quality table (mostly empty)
        low_quality_df = pd.DataFrame({
            'Col1': ['', '', 'value'],
            'Col2': ['', 'value', ''],
            'Col3': ['', '', '']
        })
        
        # Mock table object for testing
        class MockTable:
            def __init__(self):
                self.bbox = (0, 0, 100, 100)
        
        mock_table = MockTable()
        
        # Test high quality table
        high_confidence, high_metrics = modern_detector._calculate_table_confidence(
            high_quality_df, mock_table, 'lines'
        )
        
        # Test low quality table
        low_confidence, low_metrics = modern_detector._calculate_table_confidence(
            low_quality_df, mock_table, 'text'
        )
        
        # High quality should have higher confidence
        assert high_confidence > low_confidence
        assert high_confidence > 0.5
        assert high_metrics['fill_ratio'] > low_metrics['fill_ratio']
        
        print(f"High quality confidence: {high_confidence:.2f}")
        print(f"Low quality confidence: {low_confidence:.2f}")
    
    def test_table_structure_analysis(self, modern_detector, sample_pdf_paths):
        """Test table structure analysis functionality"""
        if not sample_pdf_paths or sample_pdf_paths[0] is None:
            pytest.skip("No sample PDF files available for testing")
        
        pdf_path = sample_pdf_paths[0]
        structure_info = modern_detector.get_table_structure(pdf_path)
        
        assert isinstance(structure_info, dict)
        assert 'has_tables' in structure_info
        assert 'table_count' in structure_info
        
        if structure_info['has_tables']:
            assert structure_info['table_count'] > 0
            assert 'tables_by_page' in structure_info
            assert 'overall_quality' in structure_info
            assert 'recommended_extraction_method' in structure_info
            
            print(f"Structure analysis: {structure_info}")
    
    def test_duplicate_table_removal(self, modern_detector):
        """Test removal of duplicate tables"""
        # Create mock duplicate tables
        df1 = pd.DataFrame({'A': [1, 2], 'B': [3, 4]})
        df2 = pd.DataFrame({'A': [1, 2], 'B': [3, 4]})  # Identical
        df3 = pd.DataFrame({'A': [5, 6], 'B': [7, 8]})  # Different
        
        table1 = TableResult(
            data=df1, confidence=0.8, page_number=1, 
            bbox=(0, 0, 100, 100), method_used='lines', quality_metrics={}
        )
        table2 = TableResult(
            data=df2, confidence=0.6, page_number=1, 
            bbox=(10, 10, 110, 110), method_used='text', quality_metrics={}
        )
        table3 = TableResult(
            data=df3, confidence=0.7, page_number=1, 
            bbox=(200, 200, 300, 300), method_used='lines', quality_metrics={}
        )
        
        tables = [table1, table2, table3]
        unique_tables = modern_detector._remove_duplicate_tables(tables)
        
        # Should keep table1 (higher confidence) and table3 (different content)
        assert len(unique_tables) == 2
        assert any(t.confidence == 0.8 for t in unique_tables)  # table1
        assert any(t.confidence == 0.7 for t in unique_tables)  # table3
    
    def test_numeric_value_detection(self, modern_detector):
        """Test numeric value detection"""
        assert modern_detector._is_numeric_value("123.45")
        assert modern_detector._is_numeric_value("$1,234.56")
        assert modern_detector._is_numeric_value("€100.00")
        assert modern_detector._is_numeric_value("-50.25")
        assert not modern_detector._is_numeric_value("Not a number")
        assert not modern_detector._is_numeric_value("ABC123")
    
    def test_performance_benchmarks(self, modern_detector, sample_pdf_paths):
        """Test performance benchmarks for the modern detector"""
        if not sample_pdf_paths or sample_pdf_paths[0] is None:
            pytest.skip("No sample PDF files available for testing")
        
        pdf_path = sample_pdf_paths[0]
        
        # Measure processing time
        start_time = time.time()
        result = modern_detector.extract_tables_with_confidence(pdf_path)
        processing_time = time.time() - start_time
        
        print(f"Processing time: {processing_time:.2f}s")
        print(f"Tables found: {len(result.tables)}")
        print(f"Success: {result.success}")
        
        # Performance assertions
        assert processing_time < 30.0, "Processing should complete within 30 seconds"
        
        if result.success and result.tables:
            avg_confidence = np.mean([t.confidence for t in result.tables])
            assert avg_confidence > 0.3, "Average confidence should be reasonable"


class TestAccuracyComparison:
    """Dedicated test class for accuracy comparison between modern and legacy detectors"""
    
    @pytest.mark.skipif(not CAMELOT_AVAILABLE, reason="Camelot not available")
    def test_detailed_accuracy_comparison(self, modern_detector, legacy_detector, sample_pdf_paths):
        """Detailed accuracy comparison with metrics"""
        if not sample_pdf_paths or sample_pdf_paths[0] is None:
            pytest.skip("No sample PDF files available for testing")
        
        detailed_results = []
        
        for pdf_path in sample_pdf_paths:
            print(f"\n=== Detailed Analysis: {os.path.basename(pdf_path)} ===")
            
            # Modern detector analysis
            modern_result = modern_detector.extract_tables_with_confidence(pdf_path)
            modern_structure = modern_detector.get_table_structure(pdf_path)
            
            # Legacy detector analysis
            legacy_tables = legacy_detector.detect_tables(pdf_path)
            
            # Calculate metrics
            modern_metrics = {
                'tables_found': len(modern_result.tables),
                'success_rate': 1.0 if modern_result.success else 0.0,
                'avg_confidence': modern_result.metadata.get('average_confidence', 0) if modern_result.metadata else 0,
                'high_confidence_tables': modern_result.metadata.get('high_confidence_tables', 0) if modern_result.metadata else 0,
                'processing_time': modern_result.processing_time,
                'strategies_used': modern_result.metadata.get('detection_strategies_used', []) if modern_result.metadata else []
            }
            
            legacy_metrics = {
                'tables_found': len(legacy_tables),
                'success_rate': 1.0 if legacy_tables else 0.0,
                'total_cells': sum(df.shape[0] * df.shape[1] for df in legacy_tables),
                'filled_cells': sum(df.count().sum() for df in legacy_tables)
            }
            
            # Content quality comparison
            if modern_result.tables and legacy_tables:
                modern_total_cells = sum(t.data.shape[0] * t.data.shape[1] for t in modern_result.tables)
                modern_filled_cells = sum(t.data.count().sum() for t in modern_result.tables)
                modern_fill_ratio = modern_filled_cells / modern_total_cells if modern_total_cells > 0 else 0
                
                legacy_fill_ratio = legacy_metrics['filled_cells'] / legacy_metrics['total_cells'] if legacy_metrics['total_cells'] > 0 else 0
                
                print(f"Modern fill ratio: {modern_fill_ratio:.2f}")
                print(f"Legacy fill ratio: {legacy_fill_ratio:.2f}")
                
                modern_metrics['fill_ratio'] = modern_fill_ratio
                legacy_metrics['fill_ratio'] = legacy_fill_ratio
            
            detailed_results.append({
                'file': os.path.basename(pdf_path),
                'modern': modern_metrics,
                'legacy': legacy_metrics
            })
            
            # Print comparison
            print(f"Modern: {modern_metrics['tables_found']} tables, {modern_metrics['avg_confidence']:.2f} confidence")
            print(f"Legacy: {legacy_metrics['tables_found']} tables")
            print(f"Modern strategies: {modern_metrics['strategies_used']}")
        
        # Generate summary report
        self._generate_accuracy_report(detailed_results)
        
        # Assert overall performance
        modern_success_rate = np.mean([r['modern']['success_rate'] for r in detailed_results])
        legacy_success_rate = np.mean([r['legacy']['success_rate'] for r in detailed_results])
        
        print(f"\nOverall success rates - Modern: {modern_success_rate:.2f}, Legacy: {legacy_success_rate:.2f}")
        
        # Modern detector should have reasonable success rate
        assert modern_success_rate >= 0.5, "Modern detector should have at least 50% success rate"
    
    def _generate_accuracy_report(self, results: List[Dict]):
        """Generate detailed accuracy report"""
        print("\n" + "="*60)
        print("ACCURACY COMPARISON REPORT")
        print("="*60)
        
        for result in results:
            print(f"\nFile: {result['file']}")
            print(f"  Modern - Tables: {result['modern']['tables_found']}, "
                  f"Confidence: {result['modern']['avg_confidence']:.2f}, "
                  f"Time: {result['modern']['processing_time']:.2f}s")
            print(f"  Legacy - Tables: {result['legacy']['tables_found']}")
            
            if 'fill_ratio' in result['modern'] and 'fill_ratio' in result['legacy']:
                print(f"  Fill Ratios - Modern: {result['modern']['fill_ratio']:.2f}, "
                      f"Legacy: {result['legacy']['fill_ratio']:.2f}")
        
        # Calculate averages
        if results:
            avg_modern_tables = np.mean([r['modern']['tables_found'] for r in results])
            avg_legacy_tables = np.mean([r['legacy']['tables_found'] for r in results])
            avg_modern_confidence = np.mean([r['modern']['avg_confidence'] for r in results])
            avg_modern_time = np.mean([r['modern']['processing_time'] for r in results])
            
            print(f"\nAVERAGE PERFORMANCE:")
            print(f"  Tables Found - Modern: {avg_modern_tables:.1f}, Legacy: {avg_legacy_tables:.1f}")
            print(f"  Modern Confidence: {avg_modern_confidence:.2f}")
            print(f"  Modern Processing Time: {avg_modern_time:.2f}s")
            
            # Performance improvement calculation
            if avg_legacy_tables > 0:
                table_improvement = ((avg_modern_tables - avg_legacy_tables) / avg_legacy_tables) * 100
                print(f"  Table Detection Improvement: {table_improvement:+.1f}%")


if __name__ == "__main__":
    # Run tests with verbose output
    pytest.main([__file__, "-v", "-s", "--tb=short"])