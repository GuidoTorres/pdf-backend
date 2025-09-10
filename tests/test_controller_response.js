#!/usr/bin/env node
/**
 * Test para verificar que el controlador devuelve las transacciones correctamente
 */
import { pdfProcessingQueue } from './src/config/queue.js';
import databaseService from './src/services/databaseService.js';
import { getJobStatus } from './src/controllers/documentController.js';
import { User } from './src/models/index.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('[CONTROLLER-RESPONSE-TEST] Testing controller response with estado_unlocked.pdf...');

async function testControllerResponse() {
  try {
    // Obtener usuario existente
    const existingUser = await User.findOne();
    if (!existingUser) {
      console.error('❌ No hay usuarios en la base de datos');
      return false;
    }
    
    const testUserId = existingUser.id;
    console.log(`✅ Usando usuario: ${existingUser.email}`);
    
    const sourcePdfPath = path.join(__dirname, 'pdf', 'estado_unlocked.pdf');
    
    // Copiar a ubicación temporal
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `test_${Date.now()}_estado_unlocked.pdf`);
    await fs.copyFile(sourcePdfPath, tempFilePath);
    console.log(`✅ PDF copiado a ubicación temporal: ${tempFilePath}`);
    
    // Paso 1: Procesar el PDF
    console.log('\n📤 Paso 1: Procesando PDF...');
    const job = await pdfProcessingQueue.add('process-pdf', {
      tempFilePath: tempFilePath,
      originalName: 'estado_unlocked.pdf',
      userId: testUserId,
    });
    
    console.log(`✅ Job creado con ID: ${job.id}`);
    
    // Paso 2: Esperar a que complete
    console.log('\n⏳ Paso 2: Esperando completar...');
    let attempts = 0;
    const maxAttempts = 60;
    
    while (attempts < maxAttempts) {
      const jobStatus = await job.getState();
      console.log(`   Intento ${attempts + 1}: ${jobStatus}`);
      
      if (jobStatus === 'completed') {
        console.log('✅ Job completado');
        break;
      } else if (jobStatus === 'failed') {
        console.error('❌ Job falló:', job.failedReason);
        return false;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    
    if (attempts >= maxAttempts) {
      console.error('❌ Timeout');
      return false;
    }
    
    // Paso 3: Simular llamada al controlador
    console.log('\n📡 Paso 3: Simulando llamada al controlador...');
    
    // Mock request and response objects
    const mockReq = {
      params: { jobId: job.id.toString() }
    };
    
    let responseData = null;
    const mockRes = {
      json: (data) => {
        responseData = data;
        console.log('✅ Respuesta del controlador recibida');
      },
      status: (code) => ({
        json: (data) => {
          responseData = { statusCode: code, ...data };
          console.log(`❌ Error response: ${code}`);
        }
      })
    };
    
    // Llamar al controlador
    await getJobStatus(mockReq, mockRes);
    
    if (!responseData) {
      console.error('❌ No se recibió respuesta del controlador');
      return false;
    }
    
    // Paso 4: Verificar la respuesta
    console.log('\n🔍 Paso 4: Verificando respuesta...');
    console.log(`   Job ID: ${responseData.jobId}`);
    console.log(`   Estado: ${responseData.state}`);
    console.log(`   Progreso: ${responseData.progress}%`);
    console.log(`   Archivo: ${responseData.fileName}`);
    
    if (responseData.state !== 'completed') {
      console.error(`❌ Estado incorrecto: ${responseData.state}`);
      return false;
    }
    
    if (!responseData.result) {
      console.error('❌ No hay resultado en la respuesta');
      return false;
    }
    
    if (!responseData.result.transactions) {
      console.error('❌ No hay transacciones en el resultado');
      console.log('   Resultado completo:', JSON.stringify(responseData.result, null, 2));
      return false;
    }
    
    const transactions = responseData.result.transactions;
    
    if (!Array.isArray(transactions)) {
      console.error('❌ Las transacciones no son un array');
      console.log('   Tipo:', typeof transactions);
      return false;
    }
    
    if (transactions.length === 0) {
      console.error('❌ Array de transacciones vacío');
      return false;
    }
    
    console.log(`✅ Encontradas ${transactions.length} transacciones en la respuesta`);
    
    // Mostrar algunas transacciones
    console.log('\n📋 Transacciones en la respuesta del controlador:');
    transactions.slice(0, 3).forEach((transaction, index) => {
      console.log(`   ${index + 1}. ${transaction.date} - ${transaction.description} - ${transaction.amount}`);
    });
    
    // Verificar metadata
    if (responseData.result.meta) {
      console.log('\n📊 Metadata en la respuesta:');
      const meta = responseData.result.meta;
      console.log(`   Tiempo de procesamiento: ${meta.processing_time}s`);
      console.log(`   Método: ${meta.extraction_method}`);
      console.log(`   Total transacciones: ${meta.total_transactions}`);
    }
    
    console.log('\n🎉 Test del controlador EXITOSO!');
    console.log('✅ El controlador está devolviendo las transacciones correctamente');
    
    return true;
    
  } catch (error) {
    console.error('[CONTROLLER-RESPONSE-TEST] ❌ Error:', error);
    return false;
  }
}

// Ejecutar el test
testControllerResponse()
  .then(success => {
    if (success) {
      console.log('\n✅ CONTROLLER RESPONSE TEST PASSED');
      process.exit(0);
    } else {
      console.log('\n❌ CONTROLLER RESPONSE TEST FAILED');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('[CONTROLLER-RESPONSE-TEST] ❌ Error inesperado:', error);
    process.exit(1);
  });