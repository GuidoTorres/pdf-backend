# Fix para file_size y page_count

## Problema Identificado
El frontend estaba recibiendo `file_size: null` y `page_count: null` para los documentos procesados, aunque el modelo de base de datos sí tenía estos campos definidos.

## Root Cause Analysis
1. **El modelo Document.js** tenía los campos `file_size` y `page_count` definidos correctamente
2. **El procesador Python** tenía acceso a PyMuPDF para obtener el conteo de páginas
3. **El worker Node.js** tenía acceso al archivo para obtener el tamaño
4. **El problema**: Ninguno de los dos estaba calculando ni pasando estos valores al resultado final

## Cambios Realizados

### 1. Procesador Python (`unified_pdf_processor.py`)
- **Agregado**: Cálculo de `file_size` y `page_count` al inicio del procesamiento
- **Agregado**: Campos `file_size` y `page_count` al dataclass `ProcessingMetadata`
- **Agregado**: Inclusión de estos campos en el metadata del resultado
- **Implementación**: Usa `os.path.getsize()` para tamaño y `len(doc)` con PyMuPDF para páginas

```python
# Extract file size and page count at the beginning
file_size = 0
page_count = 0

try:
    # Get file size
    file_size = os.path.getsize(pdf_path)
    self.logger.debug(f"File size: {file_size} bytes ({file_size / (1024*1024):.2f} MB)")
    
    # Get page count using PyMuPDF
    doc = fitz.open(pdf_path)
    page_count = len(doc)
    doc.close()
    self.logger.debug(f"Page count: {page_count}")
    
except Exception as e:
    self.logger.warning(f"Failed to extract file metadata: {e}")
    # Continue processing even if we can't get metadata
```

### 2. Worker Node.js (`pdfProcessor.js`)
- **Agregado**: Extracción de `file_size` y `page_count` del resultado Python
- **Agregado**: Inclusión de estos campos en los datos de actualización de la base de datos
- **Agregado**: Logging para debugging

```javascript
// Extract file size and page count from metadata if available
const metadata = result.meta || result.metadata || {};
if (metadata.file_size) {
  updateData.file_size = metadata.file_size;
  console.log(`[PDF-WORKER] [${job.id}] File size: ${metadata.file_size} bytes`);
} else {
  console.warn(`[PDF-WORKER] [${job.id}] No file_size found in metadata`);
}
if (metadata.page_count) {
  updateData.page_count = metadata.page_count;
  console.log(`[PDF-WORKER] [${job.id}] Page count: ${metadata.page_count}`);
} else {
  console.warn(`[PDF-WORKER] [${job.id}] No page_count found in metadata`);
}
```

## Verificación de la Fix

### Tests Realizados
1. **Test básico de metadata**: ✅ Verificó que PyMuPDF puede extraer páginas y `os.path.getsize()` funciona
2. **Test de procesador unificado**: ✅ Verificó que los campos se incluyen en el resultado JSON
3. **Test de worker Node.js**: ✅ Verificó que el worker puede extraer los campos del resultado Python
4. **Test de integración completa**: ✅ Verificó todo el flujo end-to-end

### Resultado de Test
```json
{
  "meta": {
    "file_size": 121211,
    "page_count": 2,
    "processing_time": 6.96,
    "total_transactions": 0,
    "tables_found": 2,
    "extraction_method": "table_based"
  }
}
```

## Comportamiento Esperado Después del Fix

1. **Frontend recibirá**:
   - `file_size`: Número entero (bytes)
   - `page_count`: Número entero (páginas)

2. **Base de datos guardará**:
   - `file_size` en la columna correspondiente
   - `page_count` en la columna correspondiente

3. **API responderá**:
   - Campos populated instead of null
   - Información útil para el usuario sobre el documento

## Archivos Modificados
- `/backend/unified_pdf_processor.py` - Extracción de metadata
- `/backend/src/workers/pdfProcessor.js` - Procesamiento y guardado

## Archivos NO Modificados (ya estaban correctos)
- `/backend/src/models/Document.js` - Modelo de BD ya tenía los campos
- `/backend/src/services/databaseService.js` - Ya podía manejar estos campos
- `/backend/src/controllers/documentController.js` - Ya podía retornar estos campos

## Notas de Deployment
- Los cambios son backward compatible
- No requieren cambios de base de datos (campos ya existían)
- Los documentos procesados previamente seguirán teniendo null, pero los nuevos tendrán los valores correctos
- El fix funciona incluso si el procesamiento AI falla