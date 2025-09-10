#!/usr/bin/env python3
"""
Integration test for AmountSignCalculator with transaction extraction

This test demonstrates how the AmountSignCalculator integrates with
the existing transaction extraction pipeline.
"""

import sys
import os

# Add the backend directory to the Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from amount_sign_calculator import AmountSignCalculator, SignDetectionStrategy, TransactionType


def test_integration_with_sample_transactions():
    """Test integration with sample transaction data that might come from PDF extraction"""
    
    calculator = AmountSignCalculator(debug=True)
    
    # Sample transactions that might come from PDF extraction
    sample_transactions = [
        {
            'date': '2024-01-15',
            'description': 'DEPOSITO NOMINA EMPRESA XYZ',
            'amount': 2500.00,
            'credit': 2500.00,
            'debit': None,
            'balance': 5000.00
        },
        {
            'date': '2024-01-16',
            'description': 'PAGO TARJETA CREDITO',
            'amount': 150.00,
            'credit': None,
            'debit': 150.00,
            'balance': 4850.00
        },
        {
            'date': '2024-01-17',
            'description': 'RETIRO ATM BANCO CENTRAL',
            'amount': 100.00,
            'credit': None,
            'debit': None,  # No separate columns, rely on heuristics
            'balance': 4750.00
        },
        {
            'date': '2024-01-18',
            'description': 'TRANSFERENCIA RECIBIDA',
            'amount': 300.00,
            'credit': None,
            'debit': None,  # No separate columns, rely on heuristics
            'balance': 5050.00
        },
        {
            'date': '2024-01-19',
            'description': 'COMISION MANTENIMIENTO',
            'amount': 25.00,
            'credit': None,
            'debit': None,  # No separate columns, rely on heuristics
            'balance': 5025.00
        }
    ]
    
    # Column structure information (as would come from column detection)
    column_structure = {
        'has_separate_debit_credit': True,
        'amount_sign_strategy': 'hybrid',
        'confidence': 0.85
    }
    
    print("=== AmountSignCalculator Integration Test ===\n")
    
    # Process each transaction
    results = []
    for i, transaction in enumerate(sample_transactions):
        print(f"Transaction {i+1}: {transaction['description']}")
        print(f"  Original amount: {transaction['amount']}")
        print(f"  Credit: {transaction.get('credit')}")
        print(f"  Debit: {transaction.get('debit')}")
        
        result = calculator.calculate_transaction_sign(transaction, column_structure)
        results.append(result)
        
        print(f"  → Calculated amount: {result.signed_amount}")
        print(f"  → Transaction type: {result.transaction_type.value}")
        print(f"  → Method used: {result.method_used.value}")
        print(f"  → Confidence: {result.confidence:.2f}")
        if result.warnings:
            print(f"  → Warnings: {', '.join(result.warnings)}")
        print()
    
    # Generate statistics
    stats = calculator.get_detection_statistics(results)
    
    print("=== Detection Statistics ===")
    print(f"Total transactions: {stats['total_transactions']}")
    print(f"Credit transactions: {stats['credit_transactions']} ({stats['credit_percentage']:.1f}%)")
    print(f"Debit transactions: {stats['debit_transactions']} ({stats['debit_percentage']:.1f}%)")
    print(f"Average confidence: {stats['confidence_stats']['average']:.2f}")
    print(f"Method usage: {stats['method_usage']}")
    print(f"Transactions with warnings: {stats['warning_stats']['transactions_with_warnings']}")
    
    # Verify expected results
    assert results[0].transaction_type == TransactionType.CREDIT  # Salary deposit
    assert results[0].signed_amount == 2500.00
    
    assert results[1].transaction_type == TransactionType.DEBIT   # Credit card payment
    assert results[1].signed_amount == -150.00
    
    assert results[2].transaction_type == TransactionType.DEBIT   # ATM withdrawal
    assert results[2].signed_amount == -100.00
    
    assert results[3].transaction_type == TransactionType.CREDIT  # Transfer received
    assert results[3].signed_amount == 300.00
    
    assert results[4].transaction_type == TransactionType.DEBIT   # Maintenance fee
    assert results[4].signed_amount == -25.00
    
    print("\n✅ All integration tests passed!")
    
    return results, stats


def test_balance_calculation_verification():
    """Test that the calculated amounts would produce correct running balances"""
    
    calculator = AmountSignCalculator(debug=False)
    
    # Sample transactions with known balance progression
    transactions = [
        {'description': 'SALDO INICIAL', 'amount': 0, 'balance': 1000.00},
        {'description': 'DEPOSITO', 'amount': 500.00, 'credit': 500.00, 'balance': 1500.00},
        {'description': 'RETIRO', 'amount': 200.00, 'debit': 200.00, 'balance': 1300.00},
        {'description': 'PAGO SERVICIO', 'amount': 50.00, 'balance': 1250.00},  # Heuristics
    ]
    
    column_structure = {'amount_sign_strategy': 'hybrid'}
    
    print("=== Balance Verification Test ===\n")
    
    running_balance = 1000.00  # Starting balance
    
    for i, transaction in enumerate(transactions[1:], 1):  # Skip initial balance
        result = calculator.calculate_transaction_sign(transaction, column_structure)
        
        # Calculate what the new balance should be
        expected_balance = running_balance + result.signed_amount
        actual_balance = transaction['balance']
        
        print(f"Transaction {i}: {transaction['description']}")
        print(f"  Calculated amount: {result.signed_amount}")
        print(f"  Previous balance: {running_balance}")
        print(f"  Expected balance: {expected_balance}")
        print(f"  Actual balance: {actual_balance}")
        print(f"  Balance match: {'✅' if abs(expected_balance - actual_balance) < 0.01 else '❌'}")
        print()
        
        running_balance = actual_balance
    
    print("Balance verification completed!")


if __name__ == '__main__':
    print("Running AmountSignCalculator integration tests...\n")
    
    # Run integration test
    results, stats = test_integration_with_sample_transactions()
    
    print("\n" + "="*50 + "\n")
    
    # Run balance verification test
    test_balance_calculation_verification()
    
    print("\n🎉 All integration tests completed successfully!")