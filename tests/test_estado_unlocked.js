#!/usr/bin/env node
/**
 * Test específico para el PDF estado_unlocked.pdf
 */
import { pdfProcessingQueue } from './src/config/queue.js';
import databaseService from './src/services/databaseService.js';
import { User } from './src/models/index.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('[ESTADO-UNLOCKED-TEST] Testing estado_unlocked.pdf specifically...');

async function testEstadoUnlocked() {
  try {
    // Obtener cualquier usuario existente de la base de datos
    const existingUser = await User.findOne();
    
    if (!existingUser) {
      console.error('❌ No hay usuarios en la base de datos. Crea un usuario primero.');
      return false;
    }
    
    const testUserId = existingUser.id;
    console.log(`✅ Usando usuario existente: ${existingUser.email} (ID: ${testUserId})`);
    const testPdfPath = path.join(__dirname, 'pdf', 'estado_unlocked.pdf');
    
    // Verificar que el PDF existe
    await fs.access(testPdfPath);
    console.log(`✅ PDF encontrado: ${testPdfPath}`);
    
    // Obtener información del archivo
    const stats = await fs.stat(testPdfPath);
    console.log(`📄 Tamaño del archivo: ${(stats.size / 1024).toFixed(2)} KB`);
    console.log(`📅 Última modificación: ${stats.mtime}`);
    
    // Paso 1: Agregar job a la cola
    console.log('\n📤 Paso 1: Agregando job a la cola...');
    const job = await pdfProcessingQueue.add('process-pdf', {
      tempFilePath: testPdfPath,
      originalName: 'estado_unlocked.pdf',
      userId: testUserId,
    });
    
    console.log(`✅ Job agregado con ID: ${job.id}`);
    
    // Paso 2: Monitorear el progreso del job
    console.log('\n⏳ Paso 2: Monitoreando progreso del job...');
    let attempts = 0;
    const maxAttempts = 120; // 2 minutos timeout
    
    while (attempts < maxAttempts) {
      const jobStatus = await job.getState();
      const progress = job.progress;
      
      console.log(`   Intento ${attempts + 1}: Estado = ${jobStatus}, Progreso = ${progress}`);
      
      if (jobStatus === 'completed') {
        console.log('✅ Job completado exitosamente!');
        break;
      } else if (jobStatus === 'failed') {
        console.error('❌ Job falló:', job.failedReason);
        console.error('❌ Stack trace:', job.stacktrace);
        return false;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    
    if (attempts >= maxAttempts) {
      console.error('❌ Job timeout después de 2 minutos');
      return false;
    }
    
    // Paso 3: Verificar resultados en la base de datos
    console.log('\n🗄️  Paso 3: Verificando resultados en la base de datos...');
    const document = await databaseService.getDocumentByJobId(job.id.toString());
    
    if (!document) {
      console.error('❌ Documento no encontrado en la base de datos');
      return false;
    }
    
    console.log(`✅ Documento encontrado: ${document.original_file_name}`);
    console.log(`   ID: ${document.id}`);
    console.log(`   Estado: ${document.status}`);
    console.log(`   Progreso: ${document.progress}%`);
    console.log(`   Proveedor: ${document.provider}`);
    console.log(`   Creado: ${document.created_at}`);
    
    // Paso 4: Analizar las transacciones
    console.log('\n💰 Paso 4: Analizando transacciones extraídas...');
    
    console.log('   Campo transactions (raw):', typeof document.transactions, document.transactions ? 'tiene datos' : 'está vacío');
    
    if (!document.transactions) {
      console.error('❌ Campo transactions está vacío o null');
      console.log('   Valor exacto:', document.transactions);
      
      // Verificar si hay metadata con información de error
      if (document.metadata) {
        try {
          const metadata = JSON.parse(document.metadata);
          console.log('   Metadata disponible:');
          console.log(`     Tiempo de procesamiento: ${metadata.processing_time}s`);
          console.log(`     Método de extracción: ${metadata.extraction_method}`);
          console.log(`     Total transacciones: ${metadata.total_transactions}`);
          if (metadata.error) {
            console.log(`     Error reportado: ${metadata.error}`);
          }
        } catch (parseErr) {
          console.log('   Error parseando metadata:', parseErr.message);
        }
      }
      
      return false;
    }
    
    let transactions;
    try {
      transactions = typeof document.transactions === 'string' 
        ? JSON.parse(document.transactions) 
        : document.transactions;
    } catch (parseErr) {
      console.error('❌ Error parseando JSON de transacciones:', parseErr);
      console.log('   Datos raw (primeros 200 chars):', document.transactions.substring(0, 200));
      return false;
    }
    
    if (!Array.isArray(transactions)) {
      console.error('❌ Las transacciones no son un array');
      console.log('   Tipo:', typeof transactions);
      console.log('   Valor:', transactions);
      return false;
    }
    
    if (transactions.length === 0) {
      console.error('❌ Array de transacciones está vacío');
      return false;
    }
    
    console.log(`✅ Encontradas ${transactions.length} transacciones`);
    
    // Mostrar las primeras 3 transacciones
    console.log('\n📋 Primeras transacciones encontradas:');
    transactions.slice(0, 3).forEach((transaction, index) => {
      console.log(`   ${index + 1}. Fecha: ${transaction.date}`);
      console.log(`      Descripción: ${transaction.description}`);
      console.log(`      Monto: ${transaction.amount}`);
      console.log(`      Tipo: ${transaction.type || 'N/A'}`);
      console.log('');
    });
    
    // Paso 5: Verificar metadata
    if (document.metadata) {
      console.log('\n📊 Metadata del procesamiento:');
      try {
        const metadata = JSON.parse(document.metadata);
        console.log(`   Tiempo de procesamiento: ${metadata.processing_time}s`);
        console.log(`   Método de extracción: ${metadata.extraction_method}`);
        console.log(`   Total transacciones: ${metadata.total_transactions}`);
        console.log(`   Páginas procesadas: ${metadata.pages_processed || 'N/A'}`);
      } catch (parseErr) {
        console.log('   Error parseando metadata:', parseErr.message);
      }
    }
    
    console.log('\n🎉 Test de estado_unlocked.pdf EXITOSO!');
    return true;
    
  } catch (error) {
    console.error('[ESTADO-UNLOCKED-TEST] ❌ Error:', error);
    return false;
  }
}

// Ejecutar el test
testEstadoUnlocked()
  .then(success => {
    if (success) {
      console.log('\n✅ TEST EXITOSO - estado_unlocked.pdf procesado correctamente');
      process.exit(0);
    } else {
      console.log('\n❌ TEST FALLIDO - Problema con estado_unlocked.pdf');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('[ESTADO-UNLOCKED-TEST] ❌ Error inesperado:', error);
    process.exit(1);
  });
