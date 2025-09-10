#!/usr/bin/env python3
"""
Integration test for Result Combination System with Enhanced Document Processor

Tests the integration between the result combination system and the enhanced document processor.
"""

import unittest
import sys
import os
from unittest.mock import Mock, patch, MagicMock

# Add the src directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src', 'services'))

from resultCombinationSystem import (
    ResultCombinationSystem, ExtractionResult, create_extraction_result
)


class TestResultCombinationIntegration(unittest.TestCase):
    """Integration test cases for Result Combination System"""
    
    def setUp(self):
        """Set up test fixtures"""
        self.combiner = ResultCombinationSystem(debug=True)
    
    def test_integration_with_multiple_extraction_methods(self):
        """Test integration with multiple extraction methods simulating real usage"""
        
        # Simulate results from different extraction methods
        # Method 1: pdfplumber (table detection)
        table_transactions = [
            {
                'date': '15/01/2024',
                'amount': 100.50,
                'description': 'PAYMENT TO STORE',
                'balance': 1500.25,
                'confidence': 0.9
            },
            {
                'date': '16/01/2024',
                'amount': -50.00,
                'description': 'ATM WITHDRAWAL',
                'balance': 1450.25,
                'confidence': 0.85
            }
        ]
        
        pdfplumber_result = create_extraction_result(
            method='pdfplumber',
            transactions=table_transactions,
            confidence=0.88,
            processing_time=2.5,
            metadata={'tables_found': 1, 'pages': 2},
            quality_metrics={'table_quality': 0.9, 'structure_quality': 0.85}
        )
        
        # Method 2: EasyOCR (with slight variations due to OCR errors)
        ocr_transactions = [
            {
                'date': '15/01/2024',
                'amount': 100.50,  # Same amount
                'description': 'PAYMENT TO STORE',  # Same description
                'balance': 1500.25,
                'confidence': 0.75
            },
            {
                'date': '16/01/2024',
                'amount': -50.00,
                'description': 'ATM WITHDRAWAL',
                'balance': 1450.25,
                'confidence': 0.70
            }
        ]
        
        easyocr_result = create_extraction_result(
            method='easyocr',
            transactions=ocr_transactions,
            confidence=0.72,
            processing_time=4.2,
            metadata={'pages_processed': 2, 'preprocessing_applied': True},
            quality_metrics={'ocr_quality': 0.75, 'text_confidence': 0.70}
        )
        
        # Method 3: PyMuPDF (direct text extraction with some missing data)
        text_transactions = [
            {
                'date': '15/01/2024',
                'amount': 100.50,
                'description': 'PAYMENT TO STORE',
                # Missing balance field
                'confidence': 0.95
            },
            {
                'date': '16/01/2024',
                'amount': -50.00,
                'description': 'ATM WITHDRAWAL',
                'balance': 1450.25,
                'confidence': 0.95
            }
        ]
        
        pymupdf_result = create_extraction_result(
            method='pymupdf',
            transactions=text_transactions,
            confidence=0.95,
            processing_time=1.2,
            metadata={'text_length': 1250, 'direct_extraction': True},
            quality_metrics={'text_quality': 0.95, 'extraction_speed': 0.9}
        )
        
        # Combine all results
        extraction_results = [pdfplumber_result, easyocr_result, pymupdf_result]
        combined_result = self.combiner.combine_results(extraction_results)
        
        # Verify combined result structure
        self.assertIsNotNone(combined_result)
        self.assertEqual(len(combined_result.transactions), 2)
        
        # Verify quality assessment
        quality = combined_result.quality_assessment
        self.assertGreater(quality.overall_confidence, 0.7)
        self.assertIn('pdfplumber', quality.method_scores)
        self.assertIn('easyocr', quality.method_scores)
        self.assertIn('pymupdf', quality.method_scores)
        
        # Verify cross-validation
        cross_val = combined_result.cross_validation
        self.assertGreater(cross_val.consistency_score, 0.8)  # High consistency expected
        self.assertGreater(cross_val.agreement_percentage, 80.0)
        
        # Verify method contributions
        contributions = combined_result.method_contributions
        self.assertAlmostEqual(sum(contributions.values()), 100.0, places=1)
        
        # Verify recommendations
        self.assertIsInstance(combined_result.recommendations, list)
        
        # Verify processing summary
        summary = combined_result.processing_summary
        self.assertEqual(summary['input_methods'], 3)
        self.assertEqual(summary['final_transaction_count'], 2)
        self.assertIn('pdfplumber', summary['methods_used'])
        self.assertIn('easyocr', summary['methods_used'])
        self.assertIn('pymupdf', summary['methods_used'])
    
    def test_integration_with_conflicting_methods(self):
        """Test integration when methods produce conflicting results"""
        
        # Method 1: High confidence but potentially wrong amount
        method1_transactions = [
            {
                'date': '15/01/2024',
                'amount': 100.50,
                'description': 'PAYMENT TO STORE',
                'balance': 1500.25
            }
        ]
        
        method1_result = create_extraction_result(
            method='pdfplumber',
            transactions=method1_transactions,
            confidence=0.90,
            processing_time=2.0,
            quality_metrics={'table_quality': 0.9}
        )
        
        # Method 2: Lower confidence but different amount (OCR error)
        method2_transactions = [
            {
                'date': '15/01/2024',
                'amount': 105.50,  # Different amount (OCR misread 0 as 5)
                'description': 'PAYMENT TO STORE',
                'balance': 1505.25  # Corresponding different balance
            }
        ]
        
        method2_result = create_extraction_result(
            method='easyocr',
            transactions=method2_transactions,
            confidence=0.65,
            processing_time=3.5,
            quality_metrics={'ocr_quality': 0.65}
        )
        
        # Combine conflicting results
        combined_result = self.combiner.combine_results([method1_result, method2_result])
        
        # Verify conflict resolution
        self.assertGreater(len(combined_result.conflict_resolutions), 0)
        
        # Higher confidence method should win
        resolved_transaction = combined_result.transactions[0]
        self.assertEqual(resolved_transaction['amount'], 100.50)  # pdfplumber should win
        
        # Verify conflict metadata
        self.assertIn('_conflict_resolutions', resolved_transaction)
        
        # Verify lower consistency score due to conflicts
        self.assertLess(combined_result.cross_validation.consistency_score, 0.9)
        
        # Verify recommendations mention conflicts or consistency issues
        recommendations_text = ' '.join(combined_result.recommendations).upper()
        self.assertTrue('CONFLICT' in recommendations_text or 'CONSISTENCY' in recommendations_text)
    
    def test_integration_with_single_method_fallback(self):
        """Test integration when only one method succeeds"""
        
        single_method_transactions = [
            {
                'date': '15/01/2024',
                'amount': 100.50,
                'description': 'PAYMENT TO STORE',
                'balance': 1500.25
            }
        ]
        
        single_result = create_extraction_result(
            method='pdfplumber',
            transactions=single_method_transactions,
            confidence=0.85,
            processing_time=2.0,
            quality_metrics={'table_quality': 0.85}
        )
        
        # Combine single result
        combined_result = self.combiner.combine_results([single_result])
        
        # Verify single method handling
        self.assertEqual(len(combined_result.transactions), 1)
        self.assertEqual(combined_result.cross_validation.consistency_score, 1.0)  # Perfect consistency
        self.assertEqual(combined_result.cross_validation.agreement_percentage, 100.0)
        self.assertEqual(len(combined_result.conflict_resolutions), 0)  # No conflicts
        
        # Verify method contribution (may be empty for single method)
        if combined_result.method_contributions:
            self.assertAlmostEqual(combined_result.method_contributions.get('pdfplumber', 100.0), 100.0, places=1)
    
    def test_integration_quality_metrics_mapping(self):
        """Test that quality metrics are properly mapped and calculated"""
        
        # Create result with comprehensive quality metrics
        transactions = [
            {
                'date': '15/01/2024',
                'amount': 100.50,
                'description': 'PAYMENT TO STORE',
                'balance': 1500.25,
                'reference': 'REF123'
            }
        ]
        
        extraction_result = create_extraction_result(
            method='pdfplumber',
            transactions=transactions,
            confidence=0.88,
            processing_time=2.5,
            metadata={'tables_found': 1},
            quality_metrics={
                'table_quality': 0.9,
                'text_quality': 0.85,
                'structure_quality': 0.8
            }
        )
        
        combined_result = self.combiner.combine_results([extraction_result])
        
        # Verify quality assessment components
        quality = combined_result.quality_assessment
        
        # Check field confidence scores
        self.assertIn('date', quality.field_confidence)
        self.assertIn('amount', quality.field_confidence)
        self.assertIn('description', quality.field_confidence)
        self.assertIn('balance', quality.field_confidence)
        
        # Check completeness score (all required fields present)
        self.assertGreaterEqual(quality.completeness_score, 0.89)
        
        # Check consistency score
        self.assertGreater(quality.consistency_score, 0.8)
        
        # Check method scores
        self.assertIn('pdfplumber', quality.method_scores)
        self.assertGreater(quality.method_scores['pdfplumber'], 0.8)
        
        # Check overall confidence
        self.assertGreater(quality.overall_confidence, 0.8)
        
        # Check reliability indicators
        indicators = quality.reliability_indicators
        self.assertIn('transaction_count', indicators)
        self.assertIn('methods_used', indicators)
        self.assertIn('processing_times', indicators)
        self.assertEqual(indicators['transaction_count'], 1)
        self.assertEqual(indicators['methods_used'], ['pdfplumber'])


if __name__ == '__main__':
    # Run the integration tests
    unittest.main(verbosity=2)