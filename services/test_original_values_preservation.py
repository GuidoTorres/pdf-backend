#!/usr/bin/env python3
"""
Test script to verify that original credit/debit/amount values are preserved
in transaction extraction as required by task 3.
"""

import os
import sys
import json
import pandas as pd
from transaction_extractor_service import TransactionExtractorService

def test_original_values_preservation():
    """Test that original values are preserved in extracted transactions"""
    
    # Set up test environment
    os.environ['GROQ_API_KEY'] = os.environ.get('GROQ_API_KEY', 'test-key')
    
    # Create test service
    service = TransactionExtractorService(debug=True)
    
    # Test 1: Table with separate debit/credit columns
    print("🧪 Test 1: Table with separate debit/credit columns")
    test_table_data = {
        'Fecha': ['2025-01-01', '2025-01-02', '2025-01-03'],
        'Descripción': ['Depósito inicial', 'Pago tarjeta', 'Transferencia recibida'],
        'Débito': [None, 150.00, None],
        'Crédito': [1000.00, None, 500.00],
        'Saldo': [1000.00, 850.00, 1350.00]
    }
    
    test_table = pd.DataFrame(test_table_data)
    
    # Test column structure detection
    column_structure = service.detect_column_structure([test_table])
    print(f"✅ Column structure detected - Separate D/C: {column_structure.has_separate_debit_credit}")
    print(f"   Strategy: {column_structure.amount_sign_strategy}")
    print(f"   Confidence: {column_structure.confidence:.2f}")
    
    # Test prompt creation
    tables_str = service._format_tables_for_ai([test_table])
    prompt = service._create_table_extraction_prompt(tables_str, column_structure)
    
    # Verify prompt includes original value instructions
    assert "original_credit" in prompt, "Prompt should request original_credit field"
    assert "original_debit" in prompt, "Prompt should request original_debit field"
    assert "original_amount" in prompt, "Prompt should request original_amount field"
    print("✅ Prompt correctly requests original value fields")
    
    # Test 2: Mock AI response parsing
    print("\n🧪 Test 2: AI response parsing with original values")
    mock_response = '''```json
[
    {
        "date": "2025-01-01",
        "description": "Depósito inicial",
        "amount": 1000.0,
        "type": "credit",
        "original_credit": 1000.0,
        "original_debit": null,
        "original_amount": null
    },
    {
        "date": "2025-01-02", 
        "description": "Pago tarjeta",
        "amount": 150.0,
        "type": "debit",
        "original_credit": null,
        "original_debit": 150.0,
        "original_amount": null
    }
]
```'''
    
    transactions = service._parse_groq_response(mock_response)
    
    # Verify original values are preserved
    assert len(transactions) == 2, f"Expected 2 transactions, got {len(transactions)}"
    
    # Check first transaction (credit)
    t1 = transactions[0]
    assert t1['original_credit'] == 1000.0, f"Expected original_credit=1000.0, got {t1['original_credit']}"
    assert t1['original_debit'] is None, f"Expected original_debit=None, got {t1['original_debit']}"
    assert t1['sign_detection_method'] == 'columns', f"Expected columns method, got {t1['sign_detection_method']}"
    
    # Check second transaction (debit)
    t2 = transactions[1]
    assert t2['original_debit'] == 150.0, f"Expected original_debit=150.0, got {t2['original_debit']}"
    assert t2['original_credit'] is None, f"Expected original_credit=None, got {t2['original_credit']}"
    assert t2['sign_detection_method'] == 'columns', f"Expected columns method, got {t2['sign_detection_method']}"
    
    print("✅ Original values correctly preserved in parsed transactions")
    
    # Test 3: Ensure original fields method
    print("\n🧪 Test 3: _ensure_original_fields method")
    incomplete_transaction = {
        "date": "2025-01-01",
        "description": "Test transaction",
        "amount": 100.0,
        "type": "debit"
    }
    
    enhanced = service._ensure_original_fields(incomplete_transaction)
    
    # Verify all original fields are present
    assert 'original_credit' in enhanced, "Missing original_credit field"
    assert 'original_debit' in enhanced, "Missing original_debit field"
    assert 'original_amount' in enhanced, "Missing original_amount field"
    assert 'sign_detection_method' in enhanced, "Missing sign_detection_method field"
    assert 'confidence' in enhanced, "Missing confidence field"
    
    print("✅ _ensure_original_fields correctly adds missing fields")
    
    # Test 4: Text extraction prompt
    print("\n🧪 Test 4: Text extraction prompt includes original values")
    text_prompt = service._create_text_extraction_prompt("Sample bank statement text")
    
    assert "original_credit" in text_prompt, "Text prompt should request original_credit field"
    assert "original_debit" in text_prompt, "Text prompt should request original_debit field"
    assert "original_amount" in text_prompt, "Text prompt should request original_amount field"
    
    print("✅ Text extraction prompt correctly requests original value fields")
    
    print("\n🎉 All tests passed! Original values preservation is working correctly.")
    print("\n📋 Summary of implemented changes:")
    print("   ✅ Modified _create_table_extraction_prompt to request original credit/debit/amount")
    print("   ✅ Modified _create_text_extraction_prompt to request original values")
    print("   ✅ Updated _parse_groq_response to preserve original values")
    print("   ✅ Added _ensure_original_fields to guarantee field presence")
    print("   ✅ Enhanced logging to track original values preservation")
    print("   ✅ Updated metadata to include preservation statistics")

if __name__ == "__main__":
    test_original_values_preservation()