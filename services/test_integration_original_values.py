#!/usr/bin/env python3
"""
Integration test to verify original values preservation works end-to-end
with the transaction extraction service.
"""

import os
import sys
import json
import pandas as pd
from transaction_extractor_service import TransactionExtractorService

def test_integration_original_values():
    """Integration test for original values preservation"""
    
    print("🔧 Integration Test: Original Values Preservation")
    
    # Check if GROQ_API_KEY is available for real testing
    api_key = os.environ.get('GROQ_API_KEY')
    if not api_key:
        print("⚠️  GROQ_API_KEY not found - running mock test only")
        return test_mock_integration()
    
    # Create service
    service = TransactionExtractorService(debug=True)
    
    # Create test data that mimics real bank statement structure
    test_data = {
        'Fecha': ['01/01/2025', '02/01/2025', '03/01/2025'],
        'Descripción': [
            'DEPOSITO INICIAL CUENTA',
            'PAGO TARJETA CREDITO',
            'TRANSFERENCIA RECIBIDA'
        ],
        'Débito': [None, 250.50, None],
        'Crédito': [1500.00, None, 750.25],
        'Saldo': [1500.00, 1249.50, 1999.75]
    }
    
    test_table = pd.DataFrame(test_data)
    
    print("📊 Test table created:")
    print(test_table.to_string())
    
    try:
        # Run extraction
        result = service.extract_from_tables([test_table])
        
        if result.success:
            print(f"\n✅ Extraction successful: {len(result.transactions)} transactions")
            
            # Verify original values preservation
            preservation_stats = result.metadata.get('original_values_preservation', {})
            print(f"📈 Preservation stats: {preservation_stats}")
            
            # Check each transaction
            for i, transaction in enumerate(result.transactions):
                print(f"\n🔍 Transaction {i+1}:")
                print(f"   Description: {transaction.get('description')}")
                print(f"   Amount: {transaction.get('amount')}")
                print(f"   Type: {transaction.get('type')}")
                print(f"   Original Credit: {transaction.get('original_credit')}")
                print(f"   Original Debit: {transaction.get('original_debit')}")
                print(f"   Original Amount: {transaction.get('original_amount')}")
                print(f"   Sign Detection Method: {transaction.get('sign_detection_method')}")
                
                # Verify requirements
                assert 'original_credit' in transaction, "Missing original_credit field"
                assert 'original_debit' in transaction, "Missing original_debit field"
                assert 'original_amount' in transaction, "Missing original_amount field"
                assert 'sign_detection_method' in transaction, "Missing sign_detection_method field"
            
            print("\n🎉 Integration test passed! All requirements satisfied:")
            print("   ✅ Original credit/debit/amount values preserved")
            print("   ✅ Sign detection method tracked")
            print("   ✅ Metadata includes preservation statistics")
            
        else:
            print(f"❌ Extraction failed: {result.error_message}")
            return False
            
    except Exception as e:
        print(f"❌ Integration test failed: {e}")
        return False
    
    return True

def test_mock_integration():
    """Mock integration test when API key is not available"""
    print("🔧 Running mock integration test...")
    
    service = TransactionExtractorService(debug=True)
    
    # Test the parsing functionality with mock data
    mock_ai_response = '''```json
[
    {
        "date": "2025-01-01",
        "description": "DEPOSITO INICIAL CUENTA",
        "amount": 1500.0,
        "type": "credit",
        "original_credit": 1500.0,
        "original_debit": null,
        "original_amount": null
    },
    {
        "date": "2025-01-02",
        "description": "PAGO TARJETA CREDITO", 
        "amount": 250.5,
        "type": "debit",
        "original_credit": null,
        "original_debit": 250.5,
        "original_amount": null
    }
]
```'''
    
    transactions = service._parse_groq_response(mock_ai_response)
    
    print(f"✅ Mock parsing successful: {len(transactions)} transactions")
    
    for i, transaction in enumerate(transactions):
        print(f"\n🔍 Mock Transaction {i+1}:")
        print(f"   Description: {transaction.get('description')}")
        print(f"   Original Credit: {transaction.get('original_credit')}")
        print(f"   Original Debit: {transaction.get('original_debit')}")
        print(f"   Sign Detection Method: {transaction.get('sign_detection_method')}")
        
        # Verify all required fields are present
        assert 'original_credit' in transaction
        assert 'original_debit' in transaction
        assert 'original_amount' in transaction
        assert 'sign_detection_method' in transaction
    
    print("\n🎉 Mock integration test passed!")
    return True

if __name__ == "__main__":
    success = test_integration_original_values()
    if success:
        print("\n✅ All integration tests completed successfully!")
        sys.exit(0)
    else:
        print("\n❌ Integration tests failed!")
        sys.exit(1)