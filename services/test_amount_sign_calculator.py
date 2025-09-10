#!/usr/bin/env python3
"""
Test suite for AmountSignCalculator

This test suite verifies all functionality of the AmountSignCalculator class
including column-based detection, heuristics-based detection, and hybrid approaches.
"""

import pytest
import sys
import os

# Add the backend directory to the Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from amount_sign_calculator import (
    AmountSignCalculator, 
    SignDetectionStrategy, 
    TransactionType,
    SignDetectionResult
)


class TestAmountSignCalculator:
    """Test cases for AmountSignCalculator"""
    
    def setup_method(self):
        """Set up test fixtures"""
        self.calculator = AmountSignCalculator(debug=True)
    
    def test_initialization(self):
        """Test calculator initialization"""
        assert self.calculator is not None
        assert hasattr(self.calculator, 'compiled_debit_patterns')
        assert hasattr(self.calculator, 'compiled_credit_patterns')
        assert len(self.calculator.compiled_debit_patterns) > 0
        assert len(self.calculator.compiled_credit_patterns) > 0
    
    def test_extract_numeric_value(self):
        """Test numeric value extraction from various formats"""
        # Test basic numbers
        assert self.calculator._extract_numeric_value(100.50) == 100.50
        assert self.calculator._extract_numeric_value("100.50") == 100.50
        assert self.calculator._extract_numeric_value("1,234.56") == 1234.56
        
        # Test currency symbols
        assert self.calculator._extract_numeric_value("$100.50") == 100.50
        assert self.calculator._extract_numeric_value("€1,234.56") == 1234.56
        
        # Test parentheses (negative values)
        assert self.calculator._extract_numeric_value("(100.50)") == -100.50
        assert self.calculator._extract_numeric_value("($1,234.56)") == -1234.56
        
        # Test None and empty values
        assert self.calculator._extract_numeric_value(None) is None
        assert self.calculator._extract_numeric_value("") is None
        assert self.calculator._extract_numeric_value("nan") is None
        
        # Test invalid values
        assert self.calculator._extract_numeric_value("invalid") is None
        assert self.calculator._extract_numeric_value("abc123") is None
    
    def test_column_based_detection_credit(self):
        """Test column-based detection for credit transactions"""
        transaction_data = {
            'amount': 100.0,
            'credit': 100.0,
            'debit': None,
            'description': 'Salary payment'
        }
        
        column_structure = {
            'has_separate_debit_credit': True,
            'amount_sign_strategy': 'columns'
        }
        
        result = self.calculator.calculate_transaction_sign(transaction_data, column_structure)
        
        assert result.signed_amount == 100.0
        assert result.transaction_type == TransactionType.CREDIT
        assert result.method_used == SignDetectionStrategy.COLUMNS
        assert result.confidence >= 0.8
    
    def test_column_based_detection_debit(self):
        """Test column-based detection for debit transactions"""
        transaction_data = {
            'amount': 50.0,
            'credit': None,
            'debit': 50.0,
            'description': 'ATM withdrawal'
        }
        
        column_structure = {
            'has_separate_debit_credit': True,
            'amount_sign_strategy': 'columns'
        }
        
        result = self.calculator.calculate_transaction_sign(transaction_data, column_structure)
        
        assert result.signed_amount == -50.0
        assert result.transaction_type == TransactionType.DEBIT
        assert result.method_used == SignDetectionStrategy.COLUMNS
        assert result.confidence >= 0.8
    
    def test_column_based_detection_both_amounts(self):
        """Test column-based detection when both credit and debit are present"""
        transaction_data = {
            'amount': 100.0,
            'credit': 150.0,
            'debit': 50.0,
            'description': 'Transfer with fee'
        }
        
        column_structure = {
            'has_separate_debit_credit': True,
            'amount_sign_strategy': 'columns'
        }
        
        result = self.calculator.calculate_transaction_sign(transaction_data, column_structure)
        
        # Net amount should be 150 - 50 = 100
        assert result.signed_amount == 100.0
        assert result.transaction_type == TransactionType.CREDIT
        assert result.method_used == SignDetectionStrategy.COLUMNS
        assert len(result.warnings) > 0  # Should warn about both amounts present
    
    def test_heuristics_detection_credit_spanish(self):
        """Test heuristics-based detection for credit transactions (Spanish)"""
        transaction_data = {
            'amount': 2500.0,
            'credit': None,
            'debit': None,
            'description': 'Depósito de nómina mensual'
        }
        
        result = self.calculator.calculate_transaction_sign(transaction_data)
        
        assert result.signed_amount == 2500.0
        assert result.transaction_type == TransactionType.CREDIT
        assert result.method_used == SignDetectionStrategy.HEURISTICS
        assert result.confidence >= 0.7
    
    def test_heuristics_detection_debit_spanish(self):
        """Test heuristics-based detection for debit transactions (Spanish)"""
        transaction_data = {
            'amount': 75.0,
            'credit': None,
            'debit': None,
            'description': 'Pago en comercio con tarjeta'
        }
        
        result = self.calculator.calculate_transaction_sign(transaction_data)
        
        assert result.signed_amount == -75.0
        assert result.transaction_type == TransactionType.DEBIT
        assert result.method_used == SignDetectionStrategy.HEURISTICS
        assert result.confidence >= 0.7
    
    def test_heuristics_detection_credit_english(self):
        """Test heuristics-based detection for credit transactions (English)"""
        transaction_data = {
            'amount': 1000.0,
            'credit': None,
            'debit': None,
            'description': 'Salary deposit from employer'
        }
        
        result = self.calculator.calculate_transaction_sign(transaction_data)
        
        assert result.signed_amount == 1000.0
        assert result.transaction_type == TransactionType.CREDIT
        assert result.method_used == SignDetectionStrategy.HEURISTICS
        assert result.confidence >= 0.7
    
    def test_heuristics_detection_debit_english(self):
        """Test heuristics-based detection for debit transactions (English)"""
        transaction_data = {
            'amount': 25.0,
            'credit': None,
            'debit': None,
            'description': 'ATM withdrawal fee'
        }
        
        result = self.calculator.calculate_transaction_sign(transaction_data)
        
        assert result.signed_amount == -25.0
        assert result.transaction_type == TransactionType.DEBIT
        assert result.method_used == SignDetectionStrategy.HEURISTICS
        assert result.confidence >= 0.7
    
    def test_heuristics_detection_no_clear_pattern(self):
        """Test heuristics-based detection with no clear patterns"""
        transaction_data = {
            'amount': 100.0,
            'credit': None,
            'debit': None,
            'description': 'Transaction XYZ123'
        }
        
        result = self.calculator.calculate_transaction_sign(transaction_data)
        
        # Should default to debit (conservative approach)
        assert result.signed_amount == -100.0
        assert result.transaction_type == TransactionType.DEBIT
        assert result.method_used == SignDetectionStrategy.HEURISTICS
        assert result.confidence < 0.5
        assert len(result.warnings) > 0
    
    def test_heuristics_detection_conflicting_patterns(self):
        """Test heuristics-based detection with conflicting patterns"""
        transaction_data = {
            'amount': 200.0,
            'credit': None,
            'debit': None,
            'description': 'Pago de depósito'  # Contains both 'pago' (debit) and 'depósito' (credit)
        }
        
        result = self.calculator.calculate_transaction_sign(transaction_data)
        
        # Should resolve conflict and provide warning
        assert result.method_used == SignDetectionStrategy.HEURISTICS
        assert result.confidence < 0.8  # Lower confidence due to conflict
        assert len(result.warnings) > 0
    
    def test_hybrid_detection_agreement(self):
        """Test hybrid detection when column and heuristic methods agree"""
        transaction_data = {
            'amount': 500.0,
            'credit': 500.0,
            'debit': None,
            'description': 'Depósito bancario'
        }
        
        column_structure = {
            'has_separate_debit_credit': True,
            'amount_sign_strategy': 'hybrid'
        }
        
        result = self.calculator.calculate_transaction_sign(transaction_data, column_structure)
        
        assert result.signed_amount == 500.0
        assert result.transaction_type == TransactionType.CREDIT
        assert result.method_used == SignDetectionStrategy.HYBRID
        assert result.confidence >= 0.9  # High confidence when methods agree
    
    def test_hybrid_detection_disagreement(self):
        """Test hybrid detection when column and heuristic methods disagree"""
        transaction_data = {
            'amount': 300.0,
            'credit': 300.0,  # Column says credit
            'debit': None,
            'description': 'Pago de servicios'  # Heuristics says debit
        }
        
        column_structure = {
            'has_separate_debit_credit': True,
            'amount_sign_strategy': 'hybrid'
        }
        
        result = self.calculator.calculate_transaction_sign(transaction_data, column_structure)
        
        assert result.method_used == SignDetectionStrategy.HYBRID
        assert result.confidence < 0.9  # Lower confidence due to disagreement
        assert len(result.warnings) > 0  # Should warn about disagreement
    
    def test_strategy_determination(self):
        """Test strategy determination logic"""
        # Test columns strategy
        column_structure = {
            'amount_sign_strategy': 'columns',
            'has_separate_debit_credit': True
        }
        strategy = self.calculator._determine_strategy(column_structure, 100.0, None)
        assert strategy == SignDetectionStrategy.COLUMNS
        
        # Test hybrid strategy
        column_structure = {
            'amount_sign_strategy': 'hybrid'
        }
        strategy = self.calculator._determine_strategy(column_structure, None, None)
        assert strategy == SignDetectionStrategy.HYBRID
        
        # Test heuristics fallback
        strategy = self.calculator._determine_strategy(None, None, None)
        assert strategy == SignDetectionStrategy.HEURISTICS
    
    def test_batch_processing(self):
        """Test batch processing of multiple transactions"""
        transactions = [
            {
                'amount': 1000.0,
                'credit': 1000.0,
                'debit': None,
                'description': 'Salary deposit'
            },
            {
                'amount': 50.0,
                'credit': None,
                'debit': 50.0,
                'description': 'ATM withdrawal'
            },
            {
                'amount': 25.0,
                'credit': None,
                'debit': None,
                'description': 'Service fee'
            }
        ]
        
        column_structure = {
            'has_separate_debit_credit': True,
            'amount_sign_strategy': 'columns'
        }
        
        results = self.calculator.batch_calculate_signs(transactions, column_structure)
        
        assert len(results) == 3
        assert results[0].signed_amount == 1000.0
        assert results[0].transaction_type == TransactionType.CREDIT
        assert results[1].signed_amount == -50.0
        assert results[1].transaction_type == TransactionType.DEBIT
        assert results[2].signed_amount == -25.0  # Should default to debit
        assert results[2].transaction_type == TransactionType.DEBIT
    
    def test_detection_statistics(self):
        """Test detection statistics generation"""
        results = [
            SignDetectionResult(
                signed_amount=1000.0,
                transaction_type=TransactionType.CREDIT,
                confidence=0.9,
                method_used=SignDetectionStrategy.COLUMNS,
                debug_info={},
                warnings=[]
            ),
            SignDetectionResult(
                signed_amount=-500.0,
                transaction_type=TransactionType.DEBIT,
                confidence=0.8,
                method_used=SignDetectionStrategy.HEURISTICS,
                debug_info={},
                warnings=['Low confidence']
            ),
            SignDetectionResult(
                signed_amount=-200.0,
                transaction_type=TransactionType.DEBIT,
                confidence=0.7,
                method_used=SignDetectionStrategy.HYBRID,
                debug_info={},
                warnings=[]
            )
        ]
        
        stats = self.calculator.get_detection_statistics(results)
        
        assert stats['total_transactions'] == 3
        assert stats['credit_transactions'] == 1
        assert stats['debit_transactions'] == 2
        assert abs(stats['credit_percentage'] - 100/3) < 0.01
        assert abs(stats['debit_percentage'] - 200/3) < 0.01
        assert stats['confidence_stats']['average'] == 0.8
        assert stats['method_usage']['columns'] == 1
        assert stats['method_usage']['heuristics'] == 1
        assert stats['method_usage']['hybrid'] == 1
        assert stats['warning_stats']['transactions_with_warnings'] == 1
    
    def test_error_handling(self):
        """Test error handling for invalid inputs"""
        # Test with empty transaction data
        result = self.calculator.calculate_transaction_sign({})
        assert result.confidence < 0.5
        assert len(result.warnings) > 0
        
        # Test with invalid amount
        transaction_data = {
            'amount': 'invalid',
            'description': 'Test transaction'
        }
        result = self.calculator.calculate_transaction_sign(transaction_data)
        assert result.signed_amount == 0.0
        assert result.transaction_type == TransactionType.DEBIT
    
    def test_edge_cases(self):
        """Test edge cases and boundary conditions"""
        # Test zero amount
        transaction_data = {
            'amount': 0.0,
            'description': 'Zero amount transaction'
        }
        result = self.calculator.calculate_transaction_sign(transaction_data)
        assert result.signed_amount == 0.0
        
        # Test very large amount
        transaction_data = {
            'amount': 1000000.0,
            'credit': 1000000.0,
            'description': 'Large deposit'
        }
        result = self.calculator.calculate_transaction_sign(transaction_data)
        assert result.signed_amount == 1000000.0
        assert result.transaction_type == TransactionType.CREDIT
        
        # Test negative raw amount (should be handled correctly)
        transaction_data = {
            'amount': -100.0,
            'description': 'Negative amount'
        }
        result = self.calculator.calculate_transaction_sign(transaction_data)
        assert result.signed_amount == -100.0
        assert result.transaction_type == TransactionType.DEBIT


if __name__ == '__main__':
    # Run tests if script is executed directly
    pytest.main([__file__, '-v'])