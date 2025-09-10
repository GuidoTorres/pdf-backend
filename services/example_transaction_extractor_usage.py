#!/usr/bin/env python3
"""
Example usage of Transaction Extractor Service

This script demonstrates how to use the Transaction Extractor Service
with different input formats and integration patterns.
"""

import os
import sys
import json
import pandas as pd
from transaction_extractor_service import TransactionExtractorService, extract_from_tables, extract_from_text


def example_table_extraction():
    """Example of extracting transactions from table data"""
    print("=" * 60)
    print("EJEMPLO: EXTRACCIÓN DESDE TABLAS")
    print("=" * 60)
    
    # Create sample table with separate debit/credit columns
    table_with_separate_columns = pd.DataFrame({
        'Fecha': ['01/01/2025', '02/01/2025', '03/01/2025', '04/01/2025'],
        'Descripción': [
            'Retiro ATM Banco Central',
            'Depósito Nómina Empresa XYZ',
            'Compra Supermercado ABC',
            'Transferencia Recibida'
        ],
        'Debe': [150.00, 0.00, 85.50, 0.00],
        'Haber': [0.00, 2500.00, 0.00, 300.00],
        'Saldo': [1850.00, 4350.00, 4264.50, 4564.50]
    })
    
    # Create sample table with single amount column
    table_with_single_amount = pd.DataFrame({
        'Date': ['2025-01-05', '2025-01-06', '2025-01-07'],
        'Description': [
            'Online Purchase Amazon',
            'Salary Deposit',
            'Gas Station Payment'
        ],
        'Amount': [-125.99, 3000.00, -45.00],
        'Balance': [4438.51, 7438.51, 7393.51]
    })
    
    try:
        service = TransactionExtractorService(debug=True)
        
        print("\n🔍 PROCESANDO TABLA CON COLUMNAS SEPARADAS DEBE/HABER:")
        result1 = service.extract_from_tables([table_with_separate_columns])
        
        print(f"\n📊 RESULTADO:")
        print(f"  ✅ Éxito: {result1.success}")
        print(f"  📝 Transacciones extraídas: {len(result1.transactions)}")
        print(f"  ⏱️  Tiempo de procesamiento: {result1.processing_time:.2f}s")
        print(f"  🏗️  Método: {result1.method.value}")
        print(f"  🔧 Columnas separadas D/C: {result1.metadata.get('column_structure', {}).get('has_separate_debit_credit', False)}")
        
        if result1.success and result1.transactions:
            print(f"\n🎯 PRIMERAS 3 TRANSACCIONES:")
            for i, trans in enumerate(result1.transactions[:3], 1):
                print(f"    {i}. {trans.get('date')} | {trans.get('description')[:30]}... | ${trans.get('amount'):.2f} | {trans.get('type')}")
        
        print("\n" + "-" * 50)
        print("\n🔍 PROCESANDO TABLA CON COLUMNA ÚNICA DE MONTO:")
        result2 = service.extract_from_tables([table_with_single_amount])
        
        print(f"\n📊 RESULTADO:")
        print(f"  ✅ Éxito: {result2.success}")
        print(f"  📝 Transacciones extraídas: {len(result2.transactions)}")
        print(f"  ⏱️  Tiempo de procesamiento: {result2.processing_time:.2f}s")
        print(f"  🔧 Columnas separadas D/C: {result2.metadata.get('column_structure', {}).get('has_separate_debit_credit', False)}")
        
        if result2.success and result2.transactions:
            print(f"\n🎯 TRANSACCIONES:")
            for i, trans in enumerate(result2.transactions, 1):
                print(f"    {i}. {trans.get('date')} | {trans.get('description')[:30]}... | ${trans.get('amount'):.2f} | {trans.get('type')}")
        
    except Exception as e:
        print(f"❌ ERROR: {e}")
        import traceback
        traceback.print_exc()


def example_text_extraction():
    """Example of extracting transactions from text content"""
    print("\n" + "=" * 60)
    print("EJEMPLO: EXTRACCIÓN DESDE TEXTO")
    print("=" * 60)
    
    # Sample bank statement text in Spanish
    spanish_text = """
    BANCO CENTRAL DEL PERÚ
    ESTADO DE CUENTA - ENERO 2025
    
    FECHA       DESCRIPCIÓN                           DEBE      HABER     SALDO
    01/01/2025  Saldo anterior                                           2,000.00
    02/01/2025  Retiro ATM Av. Arequipa              150.00              1,850.00
    03/01/2025  Depósito nómina EMPRESA XYZ                   2,500.00   4,350.00
    04/01/2025  Pago tarjeta de crédito              85.50               4,264.50
    05/01/2025  Transferencia recibida                         300.00    4,564.50
    06/01/2025  Comisión mantenimiento               12.00               4,552.50
    07/01/2025  Compra POS Supermercado              67.80               4,484.70
    """
    
    # Sample bank statement text in English
    english_text = """
    CHASE BANK STATEMENT
    ACCOUNT SUMMARY - JANUARY 2025
    
    Date        Description                          Amount      Balance
    01/05/2025  Beginning Balance                                $3,245.67
    01/06/2025  Direct Deposit - ACME CORP          +$2,800.00   $6,045.67
    01/07/2025  ATM Withdrawal                       -$100.00    $5,945.67
    01/08/2025  Online Purchase - Amazon             -$89.99     $5,855.68
    01/09/2025  Gas Station                          -$45.50     $5,810.18
    01/10/2025  Restaurant                           -$32.75     $5,777.43
    01/11/2025  Mobile Deposit                       +$150.00    $5,927.43
    """
    
    try:
        service = TransactionExtractorService(debug=True)
        
        print("\n🔍 PROCESANDO TEXTO EN ESPAÑOL:")
        result1 = service.extract_from_text(spanish_text)
        
        print(f"\n📊 RESULTADO:")
        print(f"  ✅ Éxito: {result1.success}")
        print(f"  📝 Transacciones extraídas: {len(result1.transactions)}")
        print(f"  ⏱️  Tiempo de procesamiento: {result1.processing_time:.2f}s")
        print(f"  📄 Longitud del texto: {result1.metadata.get('text_length', 0)} caracteres")
        
        if result1.success and result1.transactions:
            print(f"\n🎯 TRANSACCIONES EXTRAÍDAS:")
            for i, trans in enumerate(result1.transactions, 1):
                quality = trans.get('quality_score', 0)
                confidence = trans.get('type_confidence', 0)
                print(f"    {i}. {trans.get('date')} | {trans.get('description')[:35]}... | ${trans.get('amount'):.2f} | {trans.get('type')} (Q:{quality:.2f}, C:{confidence:.2f})")
        
        print("\n" + "-" * 50)
        print("\n🔍 PROCESANDO TEXTO EN INGLÉS:")
        result2 = service.extract_from_text(english_text)
        
        print(f"\n📊 RESULTADO:")
        print(f"  ✅ Éxito: {result2.success}")
        print(f"  📝 Transacciones extraídas: {len(result2.transactions)}")
        print(f"  ⏱️  Tiempo de procesamiento: {result2.processing_time:.2f}s")
        
        if result2.success and result2.transactions:
            print(f"\n🎯 TRANSACCIONES EXTRAÍDAS:")
            for i, trans in enumerate(result2.transactions, 1):
                quality = trans.get('quality_score', 0)
                confidence = trans.get('type_confidence', 0)
                print(f"    {i}. {trans.get('date')} | {trans.get('description')[:35]}... | ${trans.get('amount'):.2f} | {trans.get('type')} (Q:{quality:.2f}, C:{confidence:.2f})")
        
    except Exception as e:
        print(f"❌ ERROR: {e}")
        import traceback
        traceback.print_exc()


def example_column_detection():
    """Example of column structure detection"""
    print("\n" + "=" * 60)
    print("EJEMPLO: DETECCIÓN DE ESTRUCTURA DE COLUMNAS")
    print("=" * 60)
    
    # Different table structures
    tables = [
        # Spanish bank format with separate debe/haber
        pd.DataFrame({
            'Fecha': ['01/01/2025'],
            'Concepto': ['Ejemplo'],
            'Debe': [100.0],
            'Haber': [0.0],
            'Saldo': [900.0]
        }),
        
        # English bank format with single amount
        pd.DataFrame({
            'Date': ['2025-01-01'],
            'Description': ['Example'],
            'Amount': [-100.0],
            'Balance': [900.0]
        }),
        
        # Mixed format
        pd.DataFrame({
            'Fecha Operación': ['01/01/2025'],
            'Descripción': ['Ejemplo'],
            'Importe': [100.0],
            'Tipo': ['Débito']
        })
    ]
    
    try:
        service = TransactionExtractorService(debug=True)
        
        for i, table in enumerate(tables, 1):
            print(f"\n🔍 ANALIZANDO TABLA {i}:")
            print(f"  Columnas: {list(table.columns)}")
            
            structure = service.detect_column_structure([table])
            
            print(f"\n📊 ESTRUCTURA DETECTADA:")
            print(f"  📅 Columnas de fecha: {structure.date_columns}")
            print(f"  📝 Columnas de descripción: {structure.description_columns}")
            print(f"  ➖ Columnas de débito: {structure.debit_columns}")
            print(f"  ➕ Columnas de crédito: {structure.credit_columns}")
            print(f"  💰 Columnas de monto: {structure.amount_columns}")
            print(f"  💳 Columnas de saldo: {structure.balance_columns}")
            print(f"  🔧 Tiene columnas D/C separadas: {structure.has_separate_debit_credit}")
            print(f"  🎯 Confianza: {structure.confidence:.2f}")
            
            print("-" * 40)
        
    except Exception as e:
        print(f"❌ ERROR: {e}")
        import traceback
        traceback.print_exc()


def example_standalone_functions():
    """Example using standalone convenience functions"""
    print("\n" + "=" * 60)
    print("EJEMPLO: FUNCIONES INDEPENDIENTES")
    print("=" * 60)
    
    # Sample data
    sample_table = pd.DataFrame({
        'Date': ['2025-01-01', '2025-01-02'],
        'Description': ['ATM Withdrawal', 'Deposit'],
        'Debit': [50.0, 0.0],
        'Credit': [0.0, 1000.0]
    })
    
    sample_text = "01/01/2025 ATM Withdrawal -50.00\n02/01/2025 Deposit +1000.00"
    
    try:
        print("\n🔍 USANDO FUNCIÓN INDEPENDIENTE PARA TABLAS:")
        result1 = extract_from_tables([sample_table], debug=True)
        print(f"  ✅ Éxito: {result1.success}")
        print(f"  📝 Transacciones: {len(result1.transactions)}")
        
        print("\n🔍 USANDO FUNCIÓN INDEPENDIENTE PARA TEXTO:")
        result2 = extract_from_text(sample_text, debug=True)
        print(f"  ✅ Éxito: {result2.success}")
        print(f"  📝 Transacciones: {len(result2.transactions)}")
        
    except Exception as e:
        print(f"❌ ERROR: {e}")
        import traceback
        traceback.print_exc()


def main():
    """Run all examples"""
    print("🚀 INICIANDO EJEMPLOS DEL TRANSACTION EXTRACTOR SERVICE")
    print("=" * 80)
    
    # Check if GROQ_API_KEY is set
    if not os.environ.get("GROQ_API_KEY"):
        print("⚠️  ADVERTENCIA: GROQ_API_KEY no está configurada.")
        print("   Configura la variable de entorno para usar el servicio completo.")
        print("   export GROQ_API_KEY='tu_api_key_aqui'")
        return
    
    try:
        # Run examples
        example_table_extraction()
        example_text_extraction()
        example_column_detection()
        example_standalone_functions()
        
        print("\n" + "=" * 80)
        print("🎉 TODOS LOS EJEMPLOS COMPLETADOS EXITOSAMENTE")
        print("=" * 80)
        
    except KeyboardInterrupt:
        print("\n\n⏹️  EJEMPLOS INTERRUMPIDOS POR EL USUARIO")
    except Exception as e:
        print(f"\n\n❌ ERROR GENERAL: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()