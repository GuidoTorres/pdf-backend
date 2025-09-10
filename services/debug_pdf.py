#!/usr/bin/env python3
"""
Herramienta de diagnóstico para PDFs problemáticos
"""

import sys
import os
import json
import base64
import tempfile
import fitz  # PyMuPDF
import camelot
from PIL import Image
import pytesseract
import io
from pathlib import Path

def analyze_pdf(pdf_path):
    """Analiza un PDF y proporciona información detallada sobre por qué podría fallar"""
    
    print(f"\n{'='*60}")
    print(f"ANÁLISIS COMPLETO DE PDF: {pdf_path}")
    print(f"{'='*60}")
    
    if not os.path.exists(pdf_path):
        print(f"❌ ARCHIVO NO ENCONTRADO: {pdf_path}")
        return
    
    # Información básica del archivo
    file_size = os.path.getsize(pdf_path) / 1024 / 1024  # MB
    print(f"\n📁 INFORMACIÓN BÁSICA:")
    print(f"   • Tamaño: {file_size:.2f} MB")
    
    try:
        # Análisis con PyMuPDF
        doc = fitz.open(pdf_path)
        print(f"   • Páginas: {len(doc)}")
        print(f"   • Es válido: ✅")
        
        # Analizar cada página
        total_text_length = 0
        has_images = False
        
        print(f"\n📄 ANÁLISIS POR PÁGINA:")
        for page_num in range(len(doc)):
            page = doc.load_page(page_num)
            text = page.get_text()
            text_length = len(text.strip())
            total_text_length += text_length
            
            # Verificar imágenes
            image_list = page.get_images()
            page_has_images = len(image_list) > 0
            has_images = has_images or page_has_images
            
            print(f"   Página {page_num + 1}:")
            print(f"     • Texto extraíble: {text_length} caracteres")
            print(f"     • Imágenes: {len(image_list)}")
            print(f"     • Tipo: {'📄 Basado en texto' if text_length > 50 else '🖼️  Basado en imagen/escaneado'}")
            
            # Muestra de texto (primeros 200 caracteres)
            if text_length > 0:
                sample = text[:200].replace('\n', ' ').strip()
                print(f"     • Muestra: {sample}...")
        
        doc.close()
        
        # Clasificación del documento
        print(f"\n🔍 CLASIFICACIÓN DEL DOCUMENTO:")
        is_scanned = total_text_length < 100
        print(f"   • Total de texto: {total_text_length} caracteres")
        print(f"   • Clasificación: {'🖼️  PDF Escaneado (necesita OCR)' if is_scanned else '📄 PDF con texto'}")
        print(f"   • Contiene imágenes: {'✅' if has_images else '❌'}")
        
    except Exception as e:
        print(f"❌ ERROR AL ANALIZAR PDF: {e}")
        return
    
    # Análisis con Camelot
    print(f"\n🔢 ANÁLISIS DE TABLAS (Camelot):")
    try:
        # Probar lattice
        print("   Probando método 'lattice'...")
        tables_lattice = camelot.read_pdf(pdf_path, flavor='lattice', pages='all')
        print(f"     • Tablas encontradas: {len(tables_lattice)}")
        
        if len(tables_lattice) == 0:
            print("   Probando método 'stream'...")
            tables_stream = camelot.read_pdf(pdf_path, flavor='stream', pages='all', row_tol=10)
            print(f"     • Tablas encontradas: {len(tables_stream)}")
            tables = tables_stream
        else:
            tables = tables_lattice
            
        # Mostrar información de las tablas encontradas
        if len(tables) > 0:
            print(f"   ✅ TABLAS ENCONTRADAS:")
            for i, table in enumerate(tables):
                print(f"     Tabla {i+1}: {table.shape[0]} filas x {table.shape[1]} columnas")
                print(f"     Página: {table.page}")
                # Mostrar primeras filas
                print("     Muestra de datos:")
                print(table.df.head(3).to_string(max_cols=5, max_colwidth=20))
                print()
        else:
            print("   ❌ NO SE ENCONTRARON TABLAS")
            print("     Posibles causas:")
            print("     • El PDF está escaneado (necesita OCR)")
            print("     • Las tablas no tienen bordes claros")
            print("     • El formato no es reconocible por Camelot")
            
    except Exception as e:
        print(f"   ❌ ERROR EN CAMELOT: {e}")
    
    # Análisis OCR si es necesario
    if is_scanned:
        print(f"\n👁️  ANÁLISIS OCR (Tesseract):")
        try:
            print("   Ejecutando OCR en la primera página...")
            doc = fitz.open(pdf_path)
            page = doc.load_page(0)
            pix = page.get_pixmap()
            img_bytes = pix.tobytes("png")
            img = Image.open(io.BytesIO(img_bytes))
            
            # OCR
            ocr_text = pytesseract.image_to_string(img, lang='eng+spa')
            ocr_length = len(ocr_text.strip())
            
            print(f"   • Texto extraído por OCR: {ocr_length} caracteres")
            if ocr_length > 0:
                sample = ocr_text[:300].replace('\n', ' ').strip()
                print(f"   • Muestra OCR: {sample}...")
                print("   ✅ OCR funcional")
            else:
                print("   ❌ OCR no extrajo texto")
                
            doc.close()
            
        except Exception as e:
            print(f"   ❌ ERROR EN OCR: {e}")
    
    # Recomendaciones
    print(f"\n💡 RECOMENDACIONES:")
    if total_text_length > 100:
        print("   ✅ PDF con texto - debería procesarse correctamente")
    elif has_images and is_scanned:
        print("   🔄 PDF escaneado - se aplicará OCR automáticamente")
        print("   📝 Verifica que Tesseract esté instalado y configurado")
    else:
        print("   ⚠️  PDF problemático - posibles soluciones:")
        print("     • Verificar que el archivo no esté corrupto")
        print("     • Intentar con OCR forzado")
        print("     • Revisar si el formato es compatible")
    
    print(f"\n{'='*60}")

def test_with_base64(pdf_path):
    """Prueba el procesamiento completo como lo haría el sistema"""
    print(f"\n🧪 PRUEBA COMPLETA DE PROCESAMIENTO:")
    
    try:
        # Convertir a base64
        with open(pdf_path, 'rb') as f:
            pdf_content = f.read()
            pdf_b64 = base64.b64encode(pdf_content).decode('utf-8')
        
        print(f"   • Archivo convertido a base64: {len(pdf_b64)} caracteres")
        
        # Simular el proceso completo
        pdf_content = base64.b64decode(pdf_b64)
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp_file:
            tmp_file.write(pdf_content)
            temp_path = tmp_file.name
        
        print(f"   • Archivo temporal creado: {temp_path}")
        
        # Aquí normalmente llamaríamos al procesador real
        print("   • Proceso simulado exitoso ✅")
        
        # Limpiar
        os.remove(temp_path)
        print("   • Archivo temporal eliminado")
        
    except Exception as e:
        print(f"   ❌ ERROR EN SIMULACIÓN: {e}")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Uso: python debug_pdf.py <ruta_del_pdf>")
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    analyze_pdf(pdf_path)
    test_with_base64(pdf_path)