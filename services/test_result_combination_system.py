#!/usr/bin/env python3
"""
Unit tests for Result Combination and Validation System

Tests the intelligent result fusion logic, conflict resolution, cross-validation,
and comprehensive quality assessment functionality.
"""

import unittest
import sys
import os
import numpy as np
from unittest.mock import Mock, patch

# Add the src directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src', 'services'))

from resultCombinationSystem import (
    ResultCombinationSystem, ExtractionResult, CombinedResult,
    ConflictResolution, CrossValidationResult, QualityAssessment,
    create_extraction_result, combine_extraction_results
)


class TestResultCombinationSystem(unittest.TestCase):
    """Test cases for Result Combination System"""
    
    def setUp(self):
        """Set up test fixtures"""
        self.combiner = ResultCombinationSystem(debug=True)
        
        # Sample transactions for testing
        self.sample_transactions_1 = [
            {
                'date': '15/01/2024',
                'amount': 100.50,
                'description': 'PAYMENT TO STORE',
                'balance': 1500.25
            },
            {
                'date': '16/01/2024',
                'amount': -50.00,
                'description': 'ATM WITHDRAWAL',
                'balance': 1450.25
            }
        ]
        
        self.sample_transactions_2 = [
            {
                'date': '15/01/2024',
                'amount': 100.50,
                'description': 'PAYMENT TO STORE',
                'balance': 1500.25
            },
            {
                'date': '16/01/2024',
                'amount': -50.00,
                'description': 'ATM WITHDRAWAL',
                'balance': 1450.25
            }
        ]
        
        # Transactions with conflicts
        self.conflicting_transactions = [
            {
                'date': '16/01/2024',  # Different date
                'amount': 105.00,  # Significantly different amount
                'description': 'PAYMENT TO SHOP',  # Different description
                'balance': 1500.25
            },
            {
                'date': '17/01/2024',  # Different date
                'amount': -55.00,  # Different amount
                'description': 'CASH WITHDRAWAL',  # Different description
                'balance': 1445.25  # Different balance
            }
        ]
    
    def test_initialization(self):
        """Test system initialization"""
        self.assertIsInstance(self.combiner, ResultCombinationSystem)
        self.assertTrue(hasattr(self.combiner, 'config'))
        self.assertTrue(hasattr(self.combiner, 'logger'))
    
    def test_create_extraction_result(self):
        """Test creation of extraction result objects"""
        result = create_extraction_result(
            method='pdfplumber',
            transactions=self.sample_transactions_1,
            confidence=0.85,
            processing_time=2.5,
            metadata={'pages': 2},
            quality_metrics={'text_quality': 0.9}
        )
        
        self.assertEqual(result.method, 'pdfplumber')
        self.assertEqual(len(result.transactions), 2)
        self.assertEqual(result.confidence, 0.85)
        self.assertEqual(result.processing_time, 2.5)
        self.assertEqual(result.metadata['pages'], 2)
        self.assertEqual(result.quality_metrics['text_quality'], 0.9)
    
    def test_single_method_combination(self):
        """Test combination with single extraction method"""
        result1 = create_extraction_result(
            method='pdfplumber',
            transactions=self.sample_transactions_1,
            confidence=0.85,
            processing_time=2.5
        )
        
        combined = self.combiner.combine_results([result1])
        
        self.assertIsInstance(combined, CombinedResult)
        self.assertEqual(len(combined.transactions), 2)
        self.assertGreater(combined.quality_assessment.overall_confidence, 0.0)
        self.assertEqual(combined.cross_validation.consistency_score, 1.0)  # Perfect consistency with single method
    
    def test_multiple_method_combination_agreement(self):
        """Test combination with multiple methods in agreement"""
        result1 = create_extraction_result(
            method='pdfplumber',
            transactions=self.sample_transactions_1,
            confidence=0.85,
            processing_time=2.5,
            quality_metrics={'text_quality': 0.9}
        )
        
        result2 = create_extraction_result(
            method='easyocr',
            transactions=self.sample_transactions_2,
            confidence=0.80,
            processing_time=3.0,
            quality_metrics={'ocr_quality': 0.8}
        )
        
        combined = self.combiner.combine_results([result1, result2])
        
        self.assertIsInstance(combined, CombinedResult)
        self.assertEqual(len(combined.transactions), 2)
        self.assertGreater(combined.quality_assessment.overall_confidence, 0.7)
        self.assertGreater(combined.cross_validation.consistency_score, 0.8)
        self.assertEqual(len(combined.conflict_resolutions), 0)  # No conflicts expected
    
    def test_multiple_method_combination_conflicts(self):
        """Test combination with multiple methods having conflicts"""
        result1 = create_extraction_result(
            method='pdfplumber',
            transactions=self.sample_transactions_1,
            confidence=0.85,
            processing_time=2.5,
            quality_metrics={'text_quality': 0.9}
        )
        
        result2 = create_extraction_result(
            method='easyocr',
            transactions=self.conflicting_transactions,
            confidence=0.70,
            processing_time=3.0,
            quality_metrics={'ocr_quality': 0.7}
        )
        
        combined = self.combiner.combine_results([result1, result2])
        
        self.assertIsInstance(combined, CombinedResult)
        self.assertEqual(len(combined.transactions), 2)
        self.assertGreater(len(combined.conflict_resolutions), 0)  # Conflicts should be detected
        self.assertLess(combined.cross_validation.consistency_score, 1.0)  # Lower consistency due to conflicts
    
    def test_normalize_date(self):
        """Test date normalization"""
        test_cases = [
            ('15/01/2024', '15/01/2024'),
            ('2024-01-15', '15/01/2024'),
            ('15-01-24', '15/01/2024'),
            ('1/5/2024', '01/05/2024'),
            ('', ''),
            (None, '')
        ]
        
        for input_date, expected in test_cases:
            with self.subTest(input_date=input_date):
                result = self.combiner._normalize_date(input_date)
                self.assertEqual(result, expected)
    
    def test_normalize_amount(self):
        """Test amount normalization"""
        test_cases = [
            ('100.50', 100.50),
            ('€100,50', 100.50),
            ('$1,234.56', 1234.56),
            ('-50.00', -50.00),
            ('(25.75)', -25.75),
            ('1.234,56', 1234.56),  # European format
            ('', 0.0),
            (None, 0.0)
        ]
        
        for input_amount, expected in test_cases:
            with self.subTest(input_amount=input_amount):
                result = self.combiner._normalize_amount(input_amount)
                self.assertAlmostEqual(result, expected, places=2)
    
    def test_normalize_text(self):
        """Test text normalization"""
        test_cases = [
            ('Payment to Store', 'PAYMENT TO STORE'),
            ('  multiple   spaces  ', 'MULTIPLE SPACES'),
            ('', ''),
            (None, '')
        ]
        
        for input_text, expected in test_cases:
            with self.subTest(input_text=input_text):
                result = self.combiner._normalize_text(input_text)
                self.assertEqual(result, expected)
    
    def test_field_comparison(self):
        """Test field value comparison"""
        # Amount comparison
        self.assertTrue(self.combiner._compare_field_values(100.50, 100.50, 'amount'))
        self.assertTrue(self.combiner._compare_field_values(100.50, 100.51, 'amount'))  # Within tolerance
        self.assertFalse(self.combiner._compare_field_values(100.50, 101.50, 'amount'))  # Outside tolerance
        
        # Date comparison
        self.assertTrue(self.combiner._compare_field_values('15/01/2024', '15/01/2024', 'date'))
        self.assertTrue(self.combiner._compare_field_values('15/01/2024', '2024-01-15', 'date'))
        self.assertFalse(self.combiner._compare_field_values('15/01/2024', '16/01/2024', 'date'))
        
        # Text comparison
        self.assertTrue(self.combiner._compare_field_values('PAYMENT TO STORE', 'PAYMENT TO STORE', 'description'))
        self.assertTrue(self.combiner._compare_field_values('PAYMENT TO STORE', 'PAYMENT TO SHOP', 'description'))  # Similar
        self.assertFalse(self.combiner._compare_field_values('PAYMENT TO STORE', 'ATM WITHDRAWAL', 'description'))
    
    def test_conflict_detection(self):
        """Test conflict detection between field values"""
        # Amount conflict
        field_values = {'method1': 100.50, 'method2': 101.50}
        self.assertTrue(self.combiner._detect_field_conflict('amount', field_values))
        
        # No amount conflict (within tolerance)
        field_values = {'method1': 100.50, 'method2': 100.50}  # Exact match
        self.assertFalse(self.combiner._detect_field_conflict('amount', field_values))
        
        # Date conflict
        field_values = {'method1': '15/01/2024', 'method2': '16/01/2024'}
        self.assertTrue(self.combiner._detect_field_conflict('date', field_values))
        
        # Text conflict
        field_values = {'method1': 'PAYMENT TO STORE', 'method2': 'ATM WITHDRAWAL'}
        self.assertTrue(self.combiner._detect_field_conflict('description', field_values))
    
    def test_conflict_resolution(self):
        """Test conflict resolution logic"""
        # Create mock results for confidence lookup
        results = [
            create_extraction_result('pdfplumber', [], 0.85, 1.0),
            create_extraction_result('easyocr', [], 0.70, 1.0)
        ]
        
        field_values = {'pdfplumber': 100.50, 'easyocr': 101.50}
        
        resolution = self.combiner._resolve_field_conflict('amount', field_values, results)
        
        self.assertIsInstance(resolution, ConflictResolution)
        self.assertEqual(resolution.winning_method, 'pdfplumber')  # Higher confidence method should win
        self.assertEqual(resolution.resolved_value, 100.50)
        self.assertGreater(resolution.confidence, 0.0)
    
    def test_quality_assessment_calculation(self):
        """Test comprehensive quality assessment calculation"""
        # Create sample data
        transactions = self.sample_transactions_1
        results = [
            create_extraction_result('pdfplumber', transactions, 0.85, 1.0, 
                                   quality_metrics={'text_quality': 0.9}),
            create_extraction_result('easyocr', transactions, 0.80, 1.0,
                                   quality_metrics={'ocr_quality': 0.8})
        ]
        
        cross_validation = CrossValidationResult(
            consistency_score=0.9,
            agreement_percentage=90.0,
            discrepancies=[],
            validation_details={}
        )
        
        quality = self.combiner._calculate_quality_assessment(transactions, results, cross_validation)
        
        self.assertIsInstance(quality, QualityAssessment)
        self.assertGreater(quality.overall_confidence, 0.0)
        self.assertLessEqual(quality.overall_confidence, 1.0)
        self.assertIn('pdfplumber', quality.method_scores)
        self.assertIn('easyocr', quality.method_scores)
        self.assertGreater(quality.completeness_score, 0.0)
        self.assertEqual(quality.consistency_score, 0.9)
    
    def test_completeness_score_calculation(self):
        """Test completeness score calculation"""
        # Complete transactions
        complete_transactions = [
            {'date': '15/01/2024', 'amount': 100.50, 'description': 'PAYMENT', 'balance': 1500.25},
            {'date': '16/01/2024', 'amount': -50.00, 'description': 'WITHDRAWAL', 'balance': 1450.25}
        ]
        
        completeness = self.combiner._calculate_completeness_score(complete_transactions)
        self.assertAlmostEqual(completeness, 0.8, places=1)  # Allow for floating point precision
        
        # Incomplete transactions
        incomplete_transactions = [
            {'date': '15/01/2024', 'amount': 100.50},  # Missing description
            {'amount': -50.00, 'description': 'WITHDRAWAL'}  # Missing date
        ]
        
        completeness = self.combiner._calculate_completeness_score(incomplete_transactions)
        self.assertLess(completeness, 0.8)
    
    def test_method_contributions_calculation(self):
        """Test method contribution calculation"""
        # Create transactions with fusion metadata
        transactions = [
            {
                'date': '15/01/2024',
                'amount': 100.50,
                '_fusion_method': 'weighted_voting',
                '_primary_method': 'pdfplumber'
            },
            {
                'date': '16/01/2024',
                'amount': -50.00,
                '_fusion_method': 'best_method',
                '_selected_method': 'easyocr'
            }
        ]
        
        results = [
            create_extraction_result('pdfplumber', [], 0.85, 1.0),
            create_extraction_result('easyocr', [], 0.80, 1.0)
        ]
        
        contributions = self.combiner._calculate_method_contributions(results, transactions)
        
        self.assertIsInstance(contributions, dict)
        self.assertIn('pdfplumber', contributions)
        self.assertIn('easyocr', contributions)
        self.assertAlmostEqual(sum(contributions.values()), 100.0, places=1)
    
    def test_recommendations_generation(self):
        """Test recommendation generation"""
        # Create quality assessment with various issues
        quality = QualityAssessment(
            overall_confidence=0.4,  # Low confidence
            method_scores={'method1': 0.3, 'method2': 0.8},  # One poor method
            field_confidence={'amount': 0.3, 'date': 0.9},  # One poor field
            completeness_score=0.5,  # Low completeness
            consistency_score=0.4,  # Low consistency
            anomaly_score=0.3,  # High anomalies
            reliability_indicators={}
        )
        
        cross_validation = CrossValidationResult(
            consistency_score=0.4,
            agreement_percentage=40.0,
            discrepancies=[],
            validation_details={}
        )
        
        conflict_resolutions = [
            ConflictResolution('value', 'method1', 0.5, 'amount_conflict', {})
        ]
        
        recommendations = self.combiner._generate_recommendations(
            quality, cross_validation, conflict_resolutions
        )
        
        self.assertIsInstance(recommendations, list)
        self.assertGreater(len(recommendations), 0)
        
        # Check for expected recommendation types
        recommendation_text = ' '.join(recommendations).upper()
        self.assertIn('LOW CONFIDENCE', recommendation_text)
        self.assertIn('INCOMPLETE', recommendation_text)
        self.assertIn('CONSISTENCY', recommendation_text)
        self.assertIn('ANOMALIES', recommendation_text)
    
    def test_convenience_function(self):
        """Test convenience function for combining results"""
        result1 = create_extraction_result(
            method='pdfplumber',
            transactions=self.sample_transactions_1,
            confidence=0.85,
            processing_time=2.5
        )
        
        result2 = create_extraction_result(
            method='easyocr',
            transactions=self.sample_transactions_2,
            confidence=0.80,
            processing_time=3.0
        )
        
        combined = combine_extraction_results([result1, result2], debug=True)
        
        self.assertIsInstance(combined, CombinedResult)
        self.assertEqual(len(combined.transactions), 2)
        self.assertGreater(combined.quality_assessment.overall_confidence, 0.0)
    
    def test_empty_results_handling(self):
        """Test handling of empty or invalid results"""
        # Test empty results list
        with self.assertRaises(ValueError):
            self.combiner.combine_results([])
        
        # Test results with empty transactions
        empty_result = create_extraction_result('method1', [], 0.5, 1.0)
        combined = self.combiner.combine_results([empty_result])
        
        self.assertEqual(len(combined.transactions), 0)
        self.assertIsInstance(combined.quality_assessment, QualityAssessment)
    
    def test_cross_validation_with_different_transaction_counts(self):
        """Test cross-validation when methods return different numbers of transactions"""
        result1 = create_extraction_result(
            method='pdfplumber',
            transactions=self.sample_transactions_1,  # 2 transactions
            confidence=0.85,
            processing_time=2.5
        )
        
        result2 = create_extraction_result(
            method='easyocr',
            transactions=self.sample_transactions_1[:1],  # 1 transaction
            confidence=0.80,
            processing_time=3.0
        )
        
        combined = self.combiner.combine_results([result1, result2])
        
        self.assertIsInstance(combined, CombinedResult)
        self.assertGreater(len(combined.cross_validation.discrepancies), 0)  # Should detect count mismatch
        self.assertLess(combined.cross_validation.consistency_score, 1.0)


if __name__ == '__main__':
    # Run the tests
    unittest.main(verbosity=2)