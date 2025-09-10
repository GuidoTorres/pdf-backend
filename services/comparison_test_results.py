#!/usr/bin/env python3
"""
Comparison test results between ModernTableDetector (pdfplumber) and Camelot

This script runs a comprehensive comparison and generates a detailed report.
"""

import os
import sys
import time
import json
from pathlib import Path

# Add the src directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

from src.services.modernTableDetector import ModernTableDetector

try:
    import camelot
    CAMELOT_AVAILABLE = True
except ImportError:
    CAMELOT_AVAILABLE = False


def run_comprehensive_comparison():
    """Run comprehensive comparison between modern and legacy detectors"""
    print("=== COMPREHENSIVE COMPARISON REPORT ===")
    print("ModernTableDetector (pdfplumber) vs Legacy Camelot")
    print("=" * 60)
    
    # Initialize detectors
    modern_detector = ModernTableDetector(debug=False)
    
    # Find sample PDFs
    pdf_dir = Path(__file__).parent / "pdf"
    sample_files = list(pdf_dir.glob("*.pdf")) if pdf_dir.exists() else []
    
    if not sample_files:
        print("No sample PDF files found for comparison")
        return
    
    results = []
    
    for pdf_file in sample_files:
        print(f"\n--- Testing: {pdf_file.name} ---")
        
        # Modern detector test
        start_time = time.time()
        modern_result = modern_detector.extract_tables_with_confidence(str(pdf_file))
        modern_time = time.time() - start_time
        
        modern_metrics = {
            'file': pdf_file.name,
            'tables_found': len(modern_result.tables),
            'processing_time': modern_time,
            'success': modern_result.success,
            'avg_confidence': modern_result.metadata.get('average_confidence', 0) if modern_result.metadata else 0,
            'high_confidence_tables': modern_result.metadata.get('high_confidence_tables', 0) if modern_result.metadata else 0,
            'strategies_used': modern_result.metadata.get('detection_strategies_used', []) if modern_result.metadata else [],
            'quality_distribution': modern_result.metadata.get('quality_distribution', {}) if modern_result.metadata else {}
        }
        
        # Legacy detector test (if available)
        legacy_metrics = {'tables_found': 0, 'processing_time': 0, 'success': False, 'error': 'Camelot not available'}
        
        if CAMELOT_AVAILABLE:
            start_time = time.time()
            try:
                # Try lattice first
                camelot_tables = camelot.read_pdf(str(pdf_file), flavor='lattice', pages='all')
                legacy_tables = [table.df for table in camelot_tables]
                
                if not legacy_tables:
                    # Try stream if lattice failed
                    camelot_tables = camelot.read_pdf(str(pdf_file), flavor='stream', pages='all', row_tol=10)
                    legacy_tables = [table.df for table in camelot_tables]
                
                legacy_time = time.time() - start_time
                legacy_metrics = {
                    'tables_found': len(legacy_tables),
                    'processing_time': legacy_time,
                    'success': len(legacy_tables) > 0,
                    'total_cells': sum(df.shape[0] * df.shape[1] for df in legacy_tables),
                    'filled_cells': sum(df.count().sum() for df in legacy_tables)
                }
                
            except Exception as e:
                legacy_time = time.time() - start_time
                legacy_metrics = {
                    'tables_found': 0,
                    'processing_time': legacy_time,
                    'success': False,
                    'error': str(e)
                }
        
        # Print comparison for this file
        print(f"Modern:  {modern_metrics['tables_found']} tables, {modern_metrics['processing_time']:.2f}s, confidence: {modern_metrics['avg_confidence']:.2f}")
        print(f"Legacy:  {legacy_metrics['tables_found']} tables, {legacy_metrics['processing_time']:.2f}s")
        
        if modern_metrics['tables_found'] > 0:
            print(f"Modern strategies: {modern_metrics['strategies_used']}")
            print(f"Quality distribution: {modern_metrics['quality_distribution']}")
        
        # Calculate improvements
        if legacy_metrics['processing_time'] > 0:
            speed_improvement = ((legacy_metrics['processing_time'] - modern_metrics['processing_time']) / legacy_metrics['processing_time']) * 100
            print(f"Speed improvement: {speed_improvement:+.1f}%")
        
        results.append({
            'modern': modern_metrics,
            'legacy': legacy_metrics
        })
    
    # Generate summary
    print("\n" + "=" * 60)
    print("SUMMARY STATISTICS")
    print("=" * 60)
    
    if results:
        # Modern detector stats
        modern_success_rate = sum(1 for r in results if r['modern']['success']) / len(results)
        modern_avg_time = sum(r['modern']['processing_time'] for r in results) / len(results)
        modern_total_tables = sum(r['modern']['tables_found'] for r in results)
        modern_avg_confidence = sum(r['modern']['avg_confidence'] for r in results) / len(results)
        
        # Legacy detector stats
        legacy_success_rate = sum(1 for r in results if r['legacy']['success']) / len(results)
        legacy_avg_time = sum(r['legacy']['processing_time'] for r in results) / len(results)
        legacy_total_tables = sum(r['legacy']['tables_found'] for r in results)
        
        print(f"Files tested: {len(results)}")
        print(f"\nModern Detector (pdfplumber):")
        print(f"  Success rate: {modern_success_rate:.1%}")
        print(f"  Average processing time: {modern_avg_time:.2f}s")
        print(f"  Total tables found: {modern_total_tables}")
        print(f"  Average confidence: {modern_avg_confidence:.2f}")
        
        print(f"\nLegacy Detector (Camelot):")
        print(f"  Success rate: {legacy_success_rate:.1%}")
        print(f"  Average processing time: {legacy_avg_time:.2f}s")
        print(f"  Total tables found: {legacy_total_tables}")
        
        # Overall improvements
        if legacy_avg_time > 0:
            overall_speed_improvement = ((legacy_avg_time - modern_avg_time) / legacy_avg_time) * 100
            print(f"\nOverall Performance:")
            print(f"  Speed improvement: {overall_speed_improvement:+.1f}%")
        
        if legacy_total_tables > 0:
            table_detection_improvement = ((modern_total_tables - legacy_total_tables) / legacy_total_tables) * 100
            print(f"  Table detection improvement: {table_detection_improvement:+.1f}%")
        
        # Quality insights
        high_confidence_tables = sum(r['modern']['high_confidence_tables'] for r in results)
        print(f"\nQuality Insights:")
        print(f"  High confidence tables: {high_confidence_tables}/{modern_total_tables}")
        
        # Strategy usage
        all_strategies = []
        for r in results:
            all_strategies.extend(r['modern']['strategies_used'])
        
        if all_strategies:
            from collections import Counter
            strategy_counts = Counter(all_strategies)
            print(f"  Most effective strategies: {dict(strategy_counts)}")
    
    # Save detailed results
    output_file = "comparison_results.json"
    with open(output_file, 'w') as f:
        json.dump(results, f, indent=2, default=str)
    
    print(f"\nDetailed results saved to: {output_file}")


if __name__ == "__main__":
    run_comprehensive_comparison()