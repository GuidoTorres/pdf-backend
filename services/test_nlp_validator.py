#!/usr/bin/env python3
"""
Test script for NLP Validator

This script tests the NLP Validator functionality with sample banking transactions.
"""

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'src', 'services'))

from nlpValidator import NLPValidator

def test_nlp_validator():
    """Test the NLP Validator with sample transactions"""
    print("Testing NLP Validator...")
    
    # Initialize validator
    validator = NLPValidator(debug=True)
    
    # Check if model is available
    info = validator.get_validator_info()
    print(f"Validator Info: {info}")
    
    if not validator.is_model_available():
        print("❌ spaCy model not available. Please install with:")
        print("   python -m spacy download es_core_news_sm")
        return False
    
    # Test transactions
    test_transactions = [
        {
            'description': 'Transferencia a Juan Pérez por $1,500.00 el 15/03/2024',
            'amount': '1500.00',
            'date': '2024-03-15'
        },
        {
            'description': 'Pago de factura Enel por €85.50',
            'amount': '85.50',
            'date': '2024-03-14'
        },
        {
            'description': 'Compra en Supermercado ABC $234.67',
            'amount': '234.67',
            'date': '2024-03-13'
        },
        {
            'description': 'Retiro cajero automático $100',
            'amount': '100.00',
            'date': '2024-03-12'
        },
        {
            'description': 'URGENTE PREMIO GANADOR $10000 SECRETO',  # Suspicious
            'amount': '10000.00',
            'date': '2024-03-11'
        }
    ]
    
    print("\n" + "="*60)
    print("TESTING INDIVIDUAL TRANSACTIONS")
    print("="*60)
    
    for i, transaction in enumerate(test_transactions, 1):
        print(f"\n--- Transaction {i} ---")
        print(f"Description: {transaction['description']}")
        
        # Validate transaction
        result = validator.validate_with_context(transaction)
        
        print(f"Valid: {result.is_valid}")
        print(f"Confidence: {result.confidence:.2f}")
        print(f"Quality Score: {result.quality_score:.2f}")
        print(f"Transaction Type: {result.transaction_type}")
        
        if result.entities:
            print("Entities found:")
            for entity in result.entities:
                print(f"  - {entity.label}: '{entity.text}' (confidence: {entity.confidence:.2f})")
        
        if result.anomalies:
            print("Anomalies:")
            for anomaly in result.anomalies:
                print(f"  - {anomaly}")
        
        if result.suggestions:
            print("Suggestions:")
            for suggestion in result.suggestions:
                print(f"  - {suggestion}")
    
    print("\n" + "="*60)
    print("TESTING ENTITY EXTRACTION")
    print("="*60)
    
    test_texts = [
        "Pago de $1,234.56 a Banco Santander el 15/03/2024",
        "Transferencia €500.00 para María García",
        "Compra en tienda por 1.500,50 € el 10 de marzo de 2024"
    ]
    
    for text in test_texts:
        print(f"\nText: {text}")
        entities = validator.extract_entities(text)
        for entity in entities:
            print(f"  - {entity.label}: '{entity.text}' -> '{entity.normalized_value}'")
    
    print("\n" + "="*60)
    print("TESTING TRANSACTION CLASSIFICATION")
    print("="*60)
    
    classification_tests = [
        "Transferencia bancaria a cuenta de ahorros",
        "Pago de factura de electricidad",
        "Compra en supermercado con tarjeta",
        "Retiro de efectivo en cajero automático",
        "Depósito en cuenta corriente",
        "Comisión por mantenimiento de cuenta"
    ]
    
    for text in classification_tests:
        print(f"\nText: {text}")
        classification = validator.classify_transaction_type(text)
        if classification:
            print(f"  Type: {classification.transaction_type} (confidence: {classification.confidence:.2f})")
            print(f"  Reasoning: {classification.reasoning}")
        else:
            print("  No classification found")
    
    print("\n" + "="*60)
    print("TESTING ANOMALY DETECTION")
    print("="*60)
    
    anomaly_transactions = [
        {'description': 'URGENTE PREMIO GANADOR SECRETO', 'amount': '10000', 'date': '2024-03-15'},
        {'description': 'AAAAAAAAAAAAAAAA 1111111111111', 'amount': '100', 'date': '2024-03-15'},
        {'description': 'Pago $100 USD y también $100 USD duplicado', 'amount': '100', 'date': '2024-03-15'},
        {'description': 'Transferencia normal', 'amount': '50', 'date': '2024-03-15'},
        {'description': 'Transferencia normal', 'amount': '50', 'date': '2024-03-15'}  # Duplicate
    ]
    
    anomalies = validator.detect_anomalies(anomaly_transactions)
    print(f"Found {len(anomalies)} anomalies:")
    for anomaly in anomalies:
        print(f"  - {anomaly.anomaly_type}: {anomaly.description} (severity: {anomaly.severity})")
    
    print("\n✅ NLP Validator test completed successfully!")
    return True

if __name__ == "__main__":
    success = test_nlp_validator()
    sys.exit(0 if success else 1)