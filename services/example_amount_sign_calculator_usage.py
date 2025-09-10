#!/usr/bin/env python3
"""
Example usage of AmountSignCalculator

This script demonstrates how to use the AmountSignCalculator class
for different scenarios and transaction types.
"""

import sys
import os

# Add the backend directory to the Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from amount_sign_calculator import AmountSignCalculator, SignDetectionStrategy, TransactionType


def main():
    """Demonstrate AmountSignCalculator usage"""
    
    print("🧮 AmountSignCalculator Usage Examples\n")
    
    # Initialize the calculator
    calculator = AmountSignCalculator(debug=False)
    
    print("="*60)
    print("1. COLUMN-BASED DETECTION")
    print("="*60)
    
    # Example 1: Clear credit transaction with separate columns
    transaction1 = {
        'amount': 1500.00,
        'credit': 1500.00,
        'debit': None,
        'description': 'Salary payment from company'
    }
    
    column_structure = {
        'has_separate_debit_credit': True,
        'amount_sign_strategy': 'columns'
    }
    
    result1 = calculator.calculate_transaction_sign(transaction1, column_structure)
    print(f"Transaction: {transaction1['description']}")
    print(f"Result: {result1.signed_amount} ({result1.transaction_type.value})")
    print(f"Confidence: {result1.confidence:.2f}")
    print(f"Method: {result1.method_used.value}\n")
    
    # Example 2: Clear debit transaction with separate columns
    transaction2 = {
        'amount': 250.00,
        'credit': None,
        'debit': 250.00,
        'description': 'ATM withdrawal'
    }
    
    result2 = calculator.calculate_transaction_sign(transaction2, column_structure)
    print(f"Transaction: {transaction2['description']}")
    print(f"Result: {result2.signed_amount} ({result2.transaction_type.value})")
    print(f"Confidence: {result2.confidence:.2f}")
    print(f"Method: {result2.method_used.value}\n")
    
    print("="*60)
    print("2. HEURISTICS-BASED DETECTION")
    print("="*60)
    
    # Example 3: Spanish transaction descriptions
    spanish_transactions = [
        {
            'amount': 2800.00,
            'description': 'Depósito de nómina mensual'
        },
        {
            'amount': 75.50,
            'description': 'Pago en comercio con tarjeta'
        },
        {
            'amount': 15.00,
            'description': 'Comisión por transferencia'
        },
        {
            'amount': 500.00,
            'description': 'Transferencia recibida de familiar'
        }
    ]
    
    for transaction in spanish_transactions:
        result = calculator.calculate_transaction_sign(transaction)
        print(f"Transaction: {transaction['description']}")
        print(f"Result: {result.signed_amount} ({result.transaction_type.value})")
        print(f"Confidence: {result.confidence:.2f}")
        print(f"Method: {result.method_used.value}")
        if result.warnings:
            print(f"Warnings: {', '.join(result.warnings)}")
        print()
    
    print("="*60)
    print("3. ENGLISH TRANSACTION DESCRIPTIONS")
    print("="*60)
    
    english_transactions = [
        {
            'amount': 3200.00,
            'description': 'Direct deposit salary'
        },
        {
            'amount': 45.00,
            'description': 'ATM withdrawal fee'
        },
        {
            'amount': 120.00,
            'description': 'Online purchase payment'
        },
        {
            'amount': 800.00,
            'description': 'Refund from insurance company'
        }
    ]
    
    for transaction in english_transactions:
        result = calculator.calculate_transaction_sign(transaction)
        print(f"Transaction: {transaction['description']}")
        print(f"Result: {result.signed_amount} ({result.transaction_type.value})")
        print(f"Confidence: {result.confidence:.2f}")
        print(f"Method: {result.method_used.value}")
        if result.warnings:
            print(f"Warnings: {', '.join(result.warnings)}")
        print()
    
    print("="*60)
    print("4. HYBRID DETECTION")
    print("="*60)
    
    # Example 4: Hybrid approach with conflicting information
    hybrid_transaction = {
        'amount': 200.00,
        'credit': 200.00,  # Column says credit
        'debit': None,
        'description': 'Pago de servicios públicos'  # Description suggests debit
    }
    
    hybrid_structure = {
        'has_separate_debit_credit': True,
        'amount_sign_strategy': 'hybrid'
    }
    
    result4 = calculator.calculate_transaction_sign(hybrid_transaction, hybrid_structure)
    print(f"Transaction: {hybrid_transaction['description']}")
    print(f"Credit column: {hybrid_transaction['credit']}")
    print(f"Result: {result4.signed_amount} ({result4.transaction_type.value})")
    print(f"Confidence: {result4.confidence:.2f}")
    print(f"Method: {result4.method_used.value}")
    if result4.warnings:
        print(f"Warnings: {', '.join(result4.warnings)}")
    print()
    
    print("="*60)
    print("5. BATCH PROCESSING")
    print("="*60)
    
    # Example 5: Process multiple transactions at once
    batch_transactions = [
        {'amount': 1000, 'description': 'Salary deposit', 'credit': 1000},
        {'amount': 50, 'description': 'ATM withdrawal', 'debit': 50},
        {'amount': 25, 'description': 'Bank fee'},
        {'amount': 200, 'description': 'Transfer received'},
        {'amount': 75, 'description': 'Online purchase'}
    ]
    
    batch_results = calculator.batch_calculate_signs(batch_transactions, hybrid_structure)
    
    print("Batch processing results:")
    for i, (transaction, result) in enumerate(zip(batch_transactions, batch_results)):
        print(f"  {i+1}. {transaction['description']}: "
              f"{result.signed_amount} ({result.transaction_type.value})")
    
    # Generate statistics
    stats = calculator.get_detection_statistics(batch_results)
    print(f"\nBatch Statistics:")
    print(f"  Total transactions: {stats['total_transactions']}")
    print(f"  Credits: {stats['credit_transactions']} ({stats['credit_percentage']:.1f}%)")
    print(f"  Debits: {stats['debit_transactions']} ({stats['debit_percentage']:.1f}%)")
    print(f"  Average confidence: {stats['confidence_stats']['average']:.2f}")
    
    print("\n="*60)
    print("6. EDGE CASES AND ERROR HANDLING")
    print("="*60)
    
    # Example 6: Edge cases
    edge_cases = [
        {'amount': 0, 'description': 'Zero amount transaction'},
        {'amount': None, 'description': 'Missing amount'},
        {'amount': 'invalid', 'description': 'Invalid amount format'},
        {'amount': 100, 'description': ''},  # Empty description
        {'amount': -50, 'description': 'Already negative amount'},
    ]
    
    for transaction in edge_cases:
        result = calculator.calculate_transaction_sign(transaction)
        print(f"Transaction: {transaction['description'] or 'Empty description'}")
        print(f"Input amount: {transaction['amount']}")
        print(f"Result: {result.signed_amount} ({result.transaction_type.value})")
        print(f"Confidence: {result.confidence:.2f}")
        if result.warnings:
            print(f"Warnings: {', '.join(result.warnings)}")
        print()
    
    print("🎉 AmountSignCalculator examples completed!")


if __name__ == '__main__':
    main()