#!/usr/bin/env python3
"""
Test script for enhanced transaction validation service
"""

import json
from transaction_validation_service import TransactionValidationService, validate_transaction, validate_transactions_batch

def test_enhanced_validation():
    """Test the enhanced validation functionality"""
    print("Testing Enhanced Transaction Validation Service")
    print("=" * 60)
    
    service = TransactionValidationService(debug=True)
    
    # Test 1: Valid transaction with all new fields
    print("\n1. Testing valid transaction with complete sign detection info:")
    valid_transaction = {
        "date": "2024-01-15",
        "description": "SALARY DEPOSIT",
        "amount": 2500.00,
        "type": "credit",
        "original_credit": 2500.00,
        "original_debit": None,
        "original_amount": 2500.00,
        "sign_detection_method": "columns",
        "confidence": 0.95
    }
    
    result = service.validate_transaction(valid_transaction)
    print(f"✓ Valid: {result.is_valid}")
    print(f"✓ Quality Score: {result.quality_score:.3f}")
    print(f"✓ Sign Detection Quality: {result.sign_detection_quality:.3f}")
    print(f"✓ Amount Consistency: {result.amount_consistency_score:.3f}")
    print(f"✓ Warnings: {len(result.warnings)} warnings")
    
    # Test 2: Transaction with missing sign detection method
    print("\n2. Testing transaction with missing sign detection method:")
    missing_method = {
        "date": "2024-01-16",
        "description": "ATM WITHDRAWAL",
        "amount": -100.00,
        "type": "debit"
    }
    
    result = service.validate_transaction(missing_method)
    print(f"✗ Valid: {result.is_valid}")
    print(f"✗ Errors: {result.errors}")
    
    # Test 3: Transaction with amount conflicts
    print("\n3. Testing transaction with amount conflicts:")
    conflict_transaction = {
        "date": "2024-01-17",
        "description": "PURCHASE AT STORE",
        "amount": -75.00,  # Negative amount
        "type": "debit",
        "original_credit": 75.00,  # Should be debit, not credit
        "original_debit": None,
        "original_amount": 75.00,
        "sign_detection_method": "hybrid",
        "confidence": 0.60
    }
    
    result = service.validate_transaction(conflict_transaction)
    print(f"✓ Valid: {result.is_valid}")
    print(f"✓ Quality Score: {result.quality_score:.3f}")
    print(f"✓ Sign Detection Quality: {result.sign_detection_quality:.3f}")
    print(f"✓ Amount Consistency: {result.amount_consistency_score:.3f}")
    print(f"⚠ Warnings: {result.warnings}")
    
    # Test 4: Transaction with low confidence
    print("\n4. Testing transaction with low confidence:")
    low_confidence = {
        "date": "2024-01-18",
        "description": "UNKNOWN TRANSACTION",
        "amount": 25.00,
        "type": "credit",
        "original_credit": 25.00,
        "sign_detection_method": "heuristics",
        "confidence": 0.35  # Low confidence
    }
    
    result = service.validate_transaction(low_confidence)
    print(f"✓ Valid: {result.is_valid}")
    print(f"✓ Quality Score: {result.quality_score:.3f}")
    print(f"✓ Sign Detection Quality: {result.sign_detection_quality:.3f}")
    print(f"⚠ Warnings: {result.warnings}")
    
    # Test 5: Batch validation
    print("\n5. Testing batch validation:")
    batch_transactions = [
        valid_transaction,
        conflict_transaction,
        low_confidence
    ]
    
    batch_result = service.validate_transactions_batch(batch_transactions)
    print(f"✓ Total transactions: {batch_result['total_transactions']}")
    print(f"✓ Valid transactions: {batch_result['valid_transactions']}")
    print(f"✓ Validation rate: {batch_result['validation_rate']:.1%}")
    print(f"✓ Average quality: {batch_result['average_quality_score']:.3f}")
    print(f"✓ Average sign detection quality: {batch_result['average_sign_detection_quality']:.3f}")
    print(f"✓ Average consistency: {batch_result['average_consistency_score']:.3f}")
    
    # Test 6: Enhancement functionality
    print("\n6. Testing transaction enhancement:")
    basic_transaction = {
        "date": "2024-01-19",
        "description": "  payment to vendor  ",  # Needs cleaning
        "amount": -150.50,
        "original_debit": 150.50
    }
    
    enhanced = service.enhance_transaction(basic_transaction)
    print(f"✓ Original description: '{basic_transaction['description']}'")
    print(f"✓ Enhanced description: '{enhanced['description']}'")
    print(f"✓ Added sign detection method: {enhanced['sign_detection_method']}")
    print(f"✓ Added transaction type: {enhanced['type']}")
    print(f"✓ Quality score: {enhanced['quality_score']:.3f}")
    
    print("\n" + "=" * 60)
    print("✅ All tests completed successfully!")

if __name__ == "__main__":
    test_enhanced_validation()