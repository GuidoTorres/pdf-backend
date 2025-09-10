#!/usr/bin/env python3
"""
Test script for parallel processing and performance optimizations.

This script tests the implementation of task 9: parallel processing,
intelligent caching, memory optimization, and performance monitoring.
"""

import os
import sys
import time
import tempfile
import logging
from pathlib import Path

# Add src to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

# Import optimization components
from src.services.parallelProcessor import ParallelProcessor, ParallelTask
from src.services.intelligentCache import IntelligentCache
from src.services.performanceMonitor import PerformanceMonitor
from src.services.optimizedDocumentProcessor import OptimizedDocumentProcessor


def setup_logging():
    """Set up logging for tests"""
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )


def create_test_pdf():
    """Create a simple test PDF for testing"""
    try:
        import fitz  # PyMuPDF
        
        # Create a simple PDF with text and table-like content
        doc = fitz.open()
        page = doc.new_page()
        
        # Add some text content
        text = """
        BANK STATEMENT
        Account: 123456789
        Period: January 2024
        
        Date        Description             Amount
        01/01/2024  Opening Balance         1000.00
        01/05/2024  Deposit                  500.00
        01/10/2024  ATM Withdrawal          -100.00
        01/15/2024  Online Purchase          -50.00
        01/20/2024  Transfer                -200.00
        01/31/2024  Closing Balance         1150.00
        """
        
        page.insert_text((50, 50), text, fontsize=12)
        
        # Save to temporary file
        temp_pdf = tempfile.NamedTemporaryFile(suffix='.pdf', delete=False)
        doc.save(temp_pdf.name)
        doc.close()
        
        return temp_pdf.name
        
    except ImportError:
        print("PyMuPDF not available, skipping PDF creation")
        return None


def test_parallel_processor():
    """Test parallel processing functionality"""
    print("\n=== Testing Parallel Processor ===")
    
    test_pdf = create_test_pdf()
    if not test_pdf:
        print("Skipping parallel processor test - no test PDF available")
        return False
    
    try:
        with ParallelProcessor(max_workers=2, debug=True) as processor:
            print(f"Testing parallel processing with: {test_pdf}")
            
            # Test parallel PDF processing
            start_time = time.time()
            results = processor.process_pdf_parallel(
                file_path=test_pdf,
                enable_text_extraction=True,
                enable_table_detection=True,
                enable_ocr=False
            )
            processing_time = time.time() - start_time
            
            print(f"Parallel processing completed in {processing_time:.2f}s")
            print(f"Results: {len(results)} tasks completed")
            
            # Check results
            for task_id, result in results.items():
                print(f"  Task {task_id}: {result.task_type} - {'SUCCESS' if result.success else 'FAILED'}")
                if result.success and result.result:
                    if result.task_type == "text_extraction":
                        text_length = len(result.result.get('text', ''))
                        print(f"    Extracted {text_length} characters")
                    elif result.task_type == "table_detection":
                        table_count = result.result.get('table_count', 0)
                        print(f"    Found {table_count} tables")
            
            # Get processing statistics
            stats = processor.get_processing_stats()
            print(f"Processing stats: {stats['parallel_stats']['completed_tasks']} completed, "
                  f"{stats['parallel_stats']['failed_tasks']} failed")
            
        # Cleanup
        os.unlink(test_pdf)
        print("✓ Parallel processor test completed successfully")
        return True
        
    except Exception as e:
        print(f"✗ Parallel processor test failed: {e}")
        if test_pdf and os.path.exists(test_pdf):
            os.unlink(test_pdf)
        return False


def test_intelligent_cache():
    """Test intelligent caching functionality"""
    print("\n=== Testing Intelligent Cache ===")
    
    test_pdf = create_test_pdf()
    if not test_pdf:
        print("Skipping cache test - no test PDF available")
        return False
    
    try:
        with IntelligentCache(max_memory_entries=10, debug=True) as cache:
            print(f"Testing caching with: {test_pdf}")
            
            # Test cache miss
            result = cache.get(test_pdf)
            print(f"Cache miss test: {'PASS' if result is None else 'FAIL'}")
            
            # Test cache put and get
            test_data = {
                "transactions": [
                    {"date": "2024-01-01", "amount": 100.0, "description": "Test transaction"}
                ],
                "confidence": 0.95
            }
            
            cache.put(
                file_path=test_pdf,
                data=test_data,
                processing_time=1.5,
                confidence_score=0.95,
                metadata={"test": True}
            )
            
            # Test cache hit
            cached_result = cache.get(test_pdf)
            print(f"Cache hit test: {'PASS' if cached_result is not None else 'FAIL'}")
            
            if cached_result:
                print(f"  Cached data matches: {'PASS' if cached_result == test_data else 'FAIL'}")
            
            # Test cache statistics
            stats = cache.get_cache_stats()
            print(f"Cache stats: {stats['cache_stats']['cache_hits']} hits, "
                  f"{stats['cache_stats']['cache_misses']} misses")
            print(f"Hit ratio: {stats['cache_stats']['hit_ratio']:.2f}")
            
            # Test cache optimization
            cache.optimize_cache()
            print("Cache optimization completed")
        
        # Cleanup
        os.unlink(test_pdf)
        print("✓ Intelligent cache test completed successfully")
        return True
        
    except Exception as e:
        print(f"✗ Intelligent cache test failed: {e}")
        if test_pdf and os.path.exists(test_pdf):
            os.unlink(test_pdf)
        return False


def test_performance_monitor():
    """Test performance monitoring functionality"""
    print("\n=== Testing Performance Monitor ===")
    
    try:
        with PerformanceMonitor(debug=True) as monitor:
            print("Testing performance monitoring")
            
            # Test operation monitoring
            context = monitor.start_operation("test_op", "test_operation")
            
            # Simulate some work
            time.sleep(0.1)
            
            metrics = monitor.end_operation(context, success=True, metadata={"test": True})
            
            print(f"Operation metrics: {metrics.duration:.3f}s, "
                  f"{metrics.memory_delta:+.1f}MB memory change")
            
            # Test memory optimization
            optimization_stats = monitor.optimize_memory()
            print(f"Memory optimization: {optimization_stats.memory_saved:.1f}MB saved")
            
            # Test performance report
            report = monitor.get_performance_report()
            if 'performance_statistics' in report:
                stats = report['performance_statistics']
                print(f"Performance report: {stats.get('total_operations', 0)} operations, "
                      f"{stats.get('success_rate', 0):.2f} success rate")
            
        print("✓ Performance monitor test completed successfully")
        return True
        
    except Exception as e:
        print(f"✗ Performance monitor test failed: {e}")
        return False


def test_optimized_document_processor():
    """Test the complete optimized document processor"""
    print("\n=== Testing Optimized Document Processor ===")
    
    test_pdf = create_test_pdf()
    if not test_pdf:
        print("Skipping optimized processor test - no test PDF available")
        return False
    
    try:
        with OptimizedDocumentProcessor(
            debug=True,
            enable_caching=True,
            enable_parallel_processing=True,
            enable_performance_monitoring=True,
            max_workers=2,
            cache_size=10
        ) as processor:
            print(f"Testing optimized processing with: {test_pdf}")
            
            # First processing (cache miss)
            start_time = time.time()
            result1 = processor.process_document(test_pdf)
            time1 = time.time() - start_time
            
            print(f"First processing: {time1:.2f}s, "
                  f"{'SUCCESS' if result1.success else 'FAILED'}")
            print(f"  Transactions: {len(result1.transactions)}")
            print(f"  Confidence: {result1.confidence_score:.2f}")
            print(f"  Parallel processing: {result1.parallel_processing_used}")
            print(f"  Cache hit: {result1.cache_hit}")
            print(f"  Memory optimized: {result1.memory_optimized}")
            
            # Second processing (should be cache hit)
            start_time = time.time()
            result2 = processor.process_document(test_pdf)
            time2 = time.time() - start_time
            
            print(f"Second processing: {time2:.2f}s, "
                  f"{'SUCCESS' if result2.success else 'FAILED'}")
            print(f"  Cache hit: {result2.cache_hit}")
            print(f"  Speed improvement: {time1/time2:.1f}x" if time2 > 0 else "")
            
            # Get optimization statistics
            opt_stats = processor.get_optimization_stats()
            print(f"Optimization stats available: {list(opt_stats.get('optimization_stats', {}).keys())}")
            
        # Cleanup
        os.unlink(test_pdf)
        print("✓ Optimized document processor test completed successfully")
        return True
        
    except Exception as e:
        print(f"✗ Optimized document processor test failed: {e}")
        if test_pdf and os.path.exists(test_pdf):
            os.unlink(test_pdf)
        return False


def test_memory_optimization():
    """Test memory optimization for large documents"""
    print("\n=== Testing Memory Optimization ===")
    
    try:
        with PerformanceMonitor(
            memory_threshold_mb=100.0,  # Low threshold for testing
            auto_optimize_memory=True,
            debug=True
        ) as monitor:
            print("Testing memory optimization")
            
            # Get initial memory
            initial_memory = monitor._get_current_memory_usage()
            print(f"Initial memory: {initial_memory:.1f}MB")
            
            # Create some memory pressure (simulate large document processing)
            large_data = []
            for i in range(1000):
                large_data.append([f"transaction_{i}"] * 100)
            
            current_memory = monitor._get_current_memory_usage()
            print(f"Memory after allocation: {current_memory:.1f}MB")
            
            # Force memory optimization
            optimization_stats = monitor.optimize_memory()
            
            final_memory = monitor._get_current_memory_usage()
            print(f"Memory after optimization: {final_memory:.1f}MB")
            print(f"Memory saved: {optimization_stats.memory_saved:.1f}MB")
            print(f"GC collections: {optimization_stats.gc_collections}")
            
            # Clean up
            del large_data
            
        print("✓ Memory optimization test completed successfully")
        return True
        
    except Exception as e:
        print(f"✗ Memory optimization test failed: {e}")
        return False


def run_all_tests():
    """Run all optimization tests"""
    print("Starting parallel processing and optimization tests...")
    setup_logging()
    
    tests = [
        ("Parallel Processor", test_parallel_processor),
        ("Intelligent Cache", test_intelligent_cache),
        ("Performance Monitor", test_performance_monitor),
        ("Memory Optimization", test_memory_optimization),
        ("Optimized Document Processor", test_optimized_document_processor),
    ]
    
    results = []
    
    for test_name, test_func in tests:
        print(f"\n{'='*60}")
        print(f"Running {test_name} Test")
        print(f"{'='*60}")
        
        try:
            success = test_func()
            results.append((test_name, success))
        except Exception as e:
            print(f"✗ {test_name} test failed with exception: {e}")
            results.append((test_name, False))
    
    # Print summary
    print(f"\n{'='*60}")
    print("TEST SUMMARY")
    print(f"{'='*60}")
    
    passed = 0
    total = len(results)
    
    for test_name, success in results:
        status = "PASS" if success else "FAIL"
        print(f"{test_name:<30} {status}")
        if success:
            passed += 1
    
    print(f"\nResults: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All optimization tests passed!")
        return True
    else:
        print("❌ Some tests failed. Check the output above for details.")
        return False


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)