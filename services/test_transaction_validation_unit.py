#!/usr/bin/env python3
"""
Unit tests for enhanced transaction validation service
"""

from transaction_validation_service import TransactionValidationService, ValidationResult

def test_sign_detection_validation():
    """Test sign detection validation functionality"""
    service = TransactionValidationService()
    
    # Test valid sign detection
    valid_transaction = {
        "date": "2024-01-15",
        "description": "Test transaction",
        "amount": 100.00,
        "sign_detection_method": "columns",
        "confidence": 0.85
    }
    
    result = service.validate_transaction(valid_transaction)
    assert result.is_valid
    assert result.sign_detection_quality >= 0.8
    
    # Test invalid sign detection method
    invalid_method = {
        "date": "2024-01-15",
        "description": "Test transaction",
        "amount": 100.00,
        "sign_detection_method": "invalid_method",
        "confidence": 0.85
    }
    
    result = service.validate_transaction(invalid_method)
    assert not result.is_valid
    assert "Invalid sign_detection_method" in str(result.errors)

def test_amount_consistency_validation():
    """Test amount consistency validation"""
    service = TransactionValidationService()
    
    # Test consistent amounts
    consistent_transaction = {
        "date": "2024-01-15",
        "description": "Test transaction",
        "amount": -100.00,
        "original_debit": 100.00,
        "original_credit": None,
        "sign_detection_method": "columns",
        "confidence": 0.85
    }
    
    result = service.validate_transaction(consistent_transaction)
    assert result.is_valid
    assert result.amount_consistency_score >= 0.9
    
    # Test inconsistent amounts
    inconsistent_transaction = {
        "date": "2024-01-15",
        "description": "Test transaction",
        "amount": 100.00,  # Positive
        "original_debit": 150.00,  # Should make it negative
        "original_credit": None,
        "sign_detection_method": "columns",
        "confidence": 0.85
    }
    
    result = service.validate_transaction(inconsistent_transaction)
    assert result.is_valid  # Still valid but with warnings
    assert result.amount_consistency_score < 0.9
    assert len(result.warnings) > 0

def test_confidence_scoring():
    """Test confidence scoring functionality"""
    service = TransactionValidationService()
    
    # Test high confidence
    high_confidence = {
        "date": "2024-01-15",
        "description": "Test transaction",
        "amount": 100.00,
        "sign_detection_method": "columns",
        "confidence": 0.95
    }
    
    result = service.validate_transaction(high_confidence)
    assert result.sign_detection_quality >= 0.9
    
    # Test low confidence
    low_confidence = {
        "date": "2024-01-15",
        "description": "Test transaction",
        "amount": 100.00,
        "sign_detection_method": "heuristics",
        "confidence": 0.35
    }
    
    result = service.validate_transaction(low_confidence)
    assert result.sign_detection_quality < 0.5
    assert any("Low sign detection confidence" in warning for warning in result.warnings)

def test_batch_validation():
    """Test batch validation functionality"""
    service = TransactionValidationService()
    
    transactions = [
        {
            "date": "2024-01-15",
            "description": "Transaction 1",
            "amount": 100.00,
            "sign_detection_method": "columns",
            "confidence": 0.95
        },
        {
            "date": "2024-01-16",
            "description": "Transaction 2",
            "amount": -50.00,
            "sign_detection_method": "heuristics",
            "confidence": 0.60
        }
    ]
    
    result = service.validate_transactions_batch(transactions)
    
    assert result['total_transactions'] == 2
    assert result['valid_transactions'] == 2
    assert result['validation_rate'] == 1.0
    assert 'average_quality_score' in result
    assert 'average_sign_detection_quality' in result
    assert 'average_consistency_score' in result

def test_enhancement_functionality():
    """Test transaction enhancement functionality"""
    service = TransactionValidationService()
    
    basic_transaction = {
        "date": "2024-01-15",
        "description": "  test transaction  ",
        "amount": -100.00,
        "original_debit": 100.00
    }
    
    enhanced = service.enhance_transaction(basic_transaction)
    
    # Should add missing fields
    assert 'sign_detection_method' in enhanced
    assert 'type' in enhanced
    assert 'quality_score' in enhanced
    
    # Should clean description
    assert enhanced['description'] != basic_transaction['description']
    assert enhanced['description'].strip() == enhanced['description']

if __name__ == "__main__":
    # Run tests manually if pytest is not available
    test_sign_detection_validation()
    test_amount_consistency_validation()
    test_confidence_scoring()
    test_batch_validation()
    test_enhancement_functionality()
    print("✅ All unit tests passed!")