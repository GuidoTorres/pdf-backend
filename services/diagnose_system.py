#!/usr/bin/env python3
"""
Script de diagnóstico completo del sistema de procesamiento de PDFs
"""

import sys
import os
import json
import subprocess
import pkg_resources
from pathlib import Path

def check_dependencies():
    """Verifica que todas las dependencias estén instaladas correctamente"""
    
    print("🔍 VERIFICANDO DEPENDENCIAS DEL SISTEMA")
    print("=" * 50)
    
    required_packages = [
        'fitz',  # PyMuPDF
        'camelot',
        'pandas', 
        'numpy',
        'groq',
        'pytesseract',
        'PIL',  # Pillow
        'cv2'   # opencv-python-headless
    ]
    
    missing_packages = []
    installed_packages = []
    
    for package in required_packages:
        try:
            __import__(package)
            try:
                version = pkg_resources.get_distribution(package).version
            except:
                version = "unknown"
            installed_packages.append(f"✅ {package} ({version})")
        except ImportError:
            missing_packages.append(f"❌ {package} - NO INSTALADO")
    
    print("\n📦 PAQUETES PYTHON:")
    for pkg in installed_packages + missing_packages:
        print(f"   {pkg}")
    
    # Verificar Tesseract
    print("\n🔧 HERRAMIENTAS EXTERNAS:")
    try:
        result = subprocess.run(['tesseract', '--version'], 
                              capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            version_line = result.stdout.split('\n')[0]
            print(f"   ✅ Tesseract: {version_line}")
        else:
            print(f"   ❌ Tesseract: Error al obtener versión")
    except (subprocess.TimeoutExpired, FileNotFoundError):
        print(f"   ❌ Tesseract: NO INSTALADO o no accesible")
    
    # Verificar GROQ API Key
    print("\n🔑 CONFIGURACIÓN:")
    groq_key = os.environ.get("GROQ_API_KEY")
    if groq_key:
        print(f"   ✅ GROQ_API_KEY: Configurada ({len(groq_key)} caracteres)")
    else:
        print(f"   ❌ GROQ_API_KEY: NO CONFIGURADA")
    
    return len(missing_packages) == 0 and groq_key is not None

def check_file_structure():
    """Verifica la estructura de archivos del proyecto"""
    
    print("\n📁 VERIFICANDO ESTRUCTURA DE ARCHIVOS")
    print("=" * 50)
    
    current_dir = Path(__file__).parent
    required_files = [
        'docling_processor.py',
        'docling_worker.py', 
        'parser_config.json',
        'requirements.txt'
    ]
    
    print(f"Directorio actual: {current_dir}")
    
    for file in required_files:
        file_path = current_dir / file
        if file_path.exists():
            size = file_path.stat().st_size
            print(f"   ✅ {file} ({size} bytes)")
        else:
            print(f"   ❌ {file} - NO ENCONTRADO")

def test_basic_functionality():
    """Prueba funcionalidad básica del procesador"""
    
    print("\n🧪 PRUEBA DE FUNCIONALIDAD BÁSICA")
    print("=" * 50)
    
    try:
        from unified_pdf_processor import UnifiedPdfProcessor
        
        config_path = os.path.join(os.path.dirname(__file__), 'parser_config.json')
        
        print("   📋 Inicializando procesador...")
        processor = UnifiedPdfProcessor(config_path, debug=True)
        print("   ✅ Procesador inicializado correctamente")
        
        # Probar procesamiento de texto plano
        print("   📄 Probando procesamiento de texto plano...")
        sample_text = """
        ESTADO DE CUENTA BANCARIO
        01/08/2025  DEPÓSITO NÓMINA        +2500.00    2500.00
        02/08/2025  TRANSFERENCIA SALIENTE  -150.00    2350.00
        03/08/2025  COMPRA SUPERMERCADO     -89.50     2260.50
        """
        
        # Use the extractor service directly for text processing
        extraction_result = processor.extractor_service.extract_from_text(sample_text)
        
        if extraction_result.success and len(extraction_result.transactions) > 0:
            print(f"   ✅ Procesamiento exitoso: {len(extraction_result.transactions)} transacciones")
        else:
            print("   ⚠️  Procesamiento devolvió resultado vacío")
            
    except Exception as e:
        print(f"   ❌ Error en prueba básica: {e}")
        import traceback
        print(f"   Traceback: {traceback.format_exc()}")

def generate_diagnosis_report():
    """Genera un reporte completo de diagnóstico"""
    
    print("\n" + "=" * 60)
    print("📊 REPORTE DE DIAGNÓSTICO DEL SISTEMA")
    print("=" * 60)
    
    # Verificar todas las funcionalidades
    deps_ok = check_dependencies()
    check_file_structure() 
    test_basic_functionality()
    
    print("\n💡 RECOMENDACIONES:")
    print("-" * 30)
    
    if not deps_ok:
        print("❌ DEPENDENCIAS FALTANTES:")
        print("   • Instala las dependencias faltantes con:")
        print("   • pip install -r requirements.txt")
        print("   • Configura GROQ_API_KEY en tu entorno")
        
    print("\n🔧 PARA DIAGNOSTICAR PDFS ESPECÍFICOS:")
    print("   • Usa: python debug_pdf.py <archivo.pdf>")
    print("   • Usa: python test_processor.py <archivo.pdf>")
    
    print("\n📋 PARA VER LOGS DETALLADOS:")
    print("   • Los logs están en: backend/log.txt")
    print("   • Para activar debug: modifica debug=True en docling_worker.py")
    
    print("\n🚨 CAUSAS COMUNES DE RESPUESTA VACÍA:")
    print("   1. PDF escaneado sin OCR adecuado")
    print("   2. Formato de tabla no reconocible por Camelot")
    print("   3. Texto extraído no tiene formato de estado de cuenta")
    print("   4. Error en comunicación con API de Groq")
    print("   5. Respuesta de IA no tiene formato JSON válido")
    
    print("\n🎯 PRÓXIMOS PASOS PARA DEBUG:")
    print("   1. Ejecuta: python debug_pdf.py tu_archivo.pdf")
    print("   2. Revisa los logs detallados que genera")
    print("   3. Verifica que el texto extraído sea legible")
    print("   4. Confirma que Groq devuelve respuesta válida")

if __name__ == '__main__':
    generate_diagnosis_report()