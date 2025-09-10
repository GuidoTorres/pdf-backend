#!/usr/bin/env python3
"""
Basic test for ModernTableDetector without pytest dependency

This script provides basic testing functionality to verify the ModernTableDetector
implementation works correctly.
"""

import os
import sys
import traceback

# Add the src directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

try:
    from src.services.modernTableDetector import ModernTableDetector, TableResult, TableExtractionResult
    print("✓ Successfully imported ModernTableDetector")
except ImportError as e:
    print(f"✗ Failed to import ModernTableDetector: {e}")
    sys.exit(1)


def test_initialization():
    """Test that ModernTableDetector initializes correctly"""
    print("\n=== Testing Initialization ===")
    
    try:
        detector = ModernTableDetector(debug=True)
        print("✓ ModernTableDetector initialized successfully")
        
        # Check attributes
        assert hasattr(detector, 'detection_strategies'), "Missing detection_strategies"
        assert hasattr(detector, 'quality_thresholds'), "Missing quality_thresholds"
        assert len(detector.detection_strategies) >= 2, "Should have at least 2 detection strategies"
        
        print(f"✓ Detection strategies: {list(detector.detection_strategies.keys())}")
        print(f"✓ Quality thresholds: {detector.quality_thresholds}")
        
        return True
        
    except Exception as e:
        print(f"✗ Initialization failed: {e}")
        traceback.print_exc()
        return False


def test_nonexistent_file():
    """Test handling of non-existent PDF file"""
    print("\n=== Testing Non-existent File Handling ===")
    
    try:
        detector = ModernTableDetector(debug=False)
        
        # Test detect_tables
        result = detector.detect_tables("nonexistent_file.pdf")
        assert result == [], "Should return empty list for non-existent file"
        print("✓ detect_tables handles non-existent file correctly")
        
        # Test extract_tables_with_confidence
        result = detector.extract_tables_with_confidence("nonexistent_file.pdf")
        assert result.success is False, "Should return success=False for non-existent file"
        assert result.total_tables == 0, "Should return 0 tables for non-existent file"
        assert result.error_message is not None, "Should have error message"
        print("✓ extract_tables_with_confidence handles non-existent file correctly")
        
        return True
        
    except Exception as e:
        print(f"✗ Non-existent file test failed: {e}")
        traceback.print_exc()
        return False


def test_confidence_calculation():
    """Test confidence calculation for different table qualities"""
    print("\n=== Testing Confidence Calculation ===")
    
    try:
        import pandas as pd
        
        detector = ModernTableDetector(debug=False)
        
        # High quality table
        high_quality_df = pd.DataFrame({
            'Date': ['2024-01-01', '2024-01-02', '2024-01-03'],
            'Amount': ['$100.00', '$200.00', '$300.00'],
            'Description': ['Purchase A', 'Purchase B', 'Purchase C']
        })
        
        # Low quality table (mostly empty)
        low_quality_df = pd.DataFrame({
            'Col1': ['', '', ''],
            'Col2': ['', '', ''],
            'Col3': ['', '', '']
        })
        
        # Mock table object
        class MockTable:
            def __init__(self):
                self.bbox = (0, 0, 100, 100)
        
        mock_table = MockTable()
        
        # Test high quality table
        high_confidence, high_metrics = detector._calculate_table_confidence(
            high_quality_df, mock_table, 'lines'
        )
        
        # Test low quality table
        low_confidence, low_metrics = detector._calculate_table_confidence(
            low_quality_df, mock_table, 'text'
        )
        
        print(f"✓ High quality confidence: {high_confidence:.2f}")
        print(f"✓ Low quality confidence: {low_confidence:.2f}")
        print(f"✓ High quality metrics: {high_metrics}")
        
        # Assertions
        assert high_confidence > low_confidence, "High quality should have higher confidence"
        assert high_confidence > 0.5, "High quality should have confidence > 0.5"
        assert high_metrics['fill_ratio'] > low_metrics['fill_ratio'], "High quality should have better fill ratio"
        
        print("✓ Confidence calculation works correctly")
        return True
        
    except Exception as e:
        print(f"✗ Confidence calculation test failed: {e}")
        traceback.print_exc()
        return False


def test_numeric_detection():
    """Test numeric value detection"""
    print("\n=== Testing Numeric Value Detection ===")
    
    try:
        detector = ModernTableDetector(debug=False)
        
        # Test cases
        test_cases = [
            ("123.45", True),
            ("$1,234.56", True),
            ("€100.00", True),
            ("-50.25", True),
            ("Not a number", False),
            ("ABC123", False),
            ("", False),
            ("£999.99", True)
        ]
        
        for value, expected in test_cases:
            result = detector._is_numeric_value(value)
            assert result == expected, f"Failed for '{value}': expected {expected}, got {result}"
            print(f"✓ '{value}' -> {result}")
        
        print("✓ Numeric value detection works correctly")
        return True
        
    except Exception as e:
        print(f"✗ Numeric detection test failed: {e}")
        traceback.print_exc()
        return False


def test_structure_analysis():
    """Test table structure analysis with mock data"""
    print("\n=== Testing Structure Analysis ===")
    
    try:
        detector = ModernTableDetector(debug=False)
        
        # Test with non-existent file
        structure_info = detector.get_table_structure("nonexistent.pdf")
        assert 'has_tables' in structure_info, "Should have has_tables key"
        assert structure_info['has_tables'] is False, "Should indicate no tables for non-existent file"
        
        print("✓ Structure analysis handles non-existent file correctly")
        print(f"✓ Structure info: {structure_info}")
        
        return True
        
    except Exception as e:
        print(f"✗ Structure analysis test failed: {e}")
        traceback.print_exc()
        return False


def test_duplicate_removal():
    """Test removal of duplicate tables"""
    print("\n=== Testing Duplicate Table Removal ===")
    
    try:
        import pandas as pd
        
        detector = ModernTableDetector(debug=False)
        
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
        unique_tables = detector._remove_duplicate_tables(tables)
        
        print(f"✓ Original tables: {len(tables)}")
        print(f"✓ Unique tables: {len(unique_tables)}")
        
        # Should keep table1 (higher confidence) and table3 (different content)
        assert len(unique_tables) == 2, f"Expected 2 unique tables, got {len(unique_tables)}"
        
        confidences = [t.confidence for t in unique_tables]
        assert 0.8 in confidences, "Should keep table with 0.8 confidence"
        assert 0.7 in confidences, "Should keep table with 0.7 confidence"
        assert 0.6 not in confidences, "Should remove duplicate with lower confidence"
        
        print("✓ Duplicate removal works correctly")
        return True
        
    except Exception as e:
        print(f"✗ Duplicate removal test failed: {e}")
        traceback.print_exc()
        return False


def main():
    """Run all basic tests"""
    print("Starting Basic ModernTableDetector Tests")
    print("=" * 50)
    
    tests = [
        test_initialization,
        test_nonexistent_file,
        test_confidence_calculation,
        test_numeric_detection,
        test_structure_analysis,
        test_duplicate_removal
    ]
    
    passed = 0
    failed = 0
    
    for test in tests:
        try:
            if test():
                passed += 1
            else:
                failed += 1
        except Exception as e:
            print(f"✗ Test {test.__name__} crashed: {e}")
            failed += 1
    
    print("\n" + "=" * 50)
    print("TEST SUMMARY")
    print("=" * 50)
    print(f"Passed: {passed}")
    print(f"Failed: {failed}")
    print(f"Total: {passed + failed}")
    print(f"Success Rate: {passed/(passed+failed)*100:.1f}%")
    
    if failed == 0:
        print("\n🎉 All tests passed!")
        return True
    else:
        print(f"\n❌ {failed} test(s) failed")
        return False


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)