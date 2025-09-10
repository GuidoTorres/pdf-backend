#!/usr/bin/env node
/**
 * Test directo del endpoint API para ver la respuesta exacta
 */
import express from 'express';
import { pdfProcessingQueue } from './src/config/queue.js';
import { getJobStatus } from './src/controllers/documentController.js';
import { User } from './src/models/index.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('[API-RESPONSE-TEST] Testing API response format...');

async function testApiResponse() {
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
    const tempFilePath = path.join(tempDir, `api_test_${Date.now()}_estado_unlocked.pdf`);
    await fs.copyFile(sourcePdfPath, tempFilePath);
    console.log(`✅ PDF copiado a: ${tempFilePath}`);
    
    // Procesar PDF
    console.log('\n📤 Procesando PDF...');
    const job = await pdfProcessingQueue.add('process-pdf', {
      tempFilePath: tempFilePath,
      originalName: 'estado_unlocked.pdf',
      userId: testUserId,
    });
    
    console.log(`✅ Job creado con ID: ${job.id}`);
    
    // Esperar a que complete
    console.log('\n⏳ Esperando completar...');
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
    
    // Simular llamada HTTP al endpoint
    console.log('\n📡 Simulando llamada HTTP al endpoint...');
    
    const mockReq = {
      params: { jobId: job.id.toString() }
    };
    
    let apiResponse = null;
    const mockRes = {
      json: (data) => {
        apiResponse = data;
      },
      status: (code) => ({
        json: (data) => {
          apiResponse = { statusCode: code, ...data };
        }
      })
    };
    
    // Llamar al controlador
    await getJobStatus(mockReq, mockRes);
    
    if (!apiResponse) {
      console.error('❌ No se recibió respuesta del API');
      return false;
    }
    
    console.log('\n🔍 Analizando respuesta del API...');
    console.log('📋 Estructura de la respuesta:');
    console.log(`   jobId: ${apiResponse.jobId}`);
    console.log(`   state: ${apiResponse.state}`);
    console.log(`   progress: ${apiResponse.progress}`);
    console.log(`   fileName: ${apiResponse.fileName}`);
    
    if (!apiResponse.result) {
      console.error('❌ No hay campo "result" en la respuesta');
      return false;
    }
    
    console.log('\n📊 Resultado:');
    console.log(`   Tiene transacciones: ${!!apiResponse.result.transactions}`);
    console.log(`   Tipo de transacciones: ${typeof apiResponse.result.transactions}`);
    
    if (apiResponse.result.transactions) {
      const transactions = apiResponse.result.transactions;
      console.log(`   Número de transacciones: ${transactions.length}`);
      
      if (transactions.length > 0) {
        console.log('\n💰 Primeras 3 transacciones:');
        transactions.slice(0, 3).forEach((transaction, index) => {
          console.log(`   ${index + 1}. Estructura de la transacción:`);
          console.log(`      date: "${transaction.date}" (${typeof transaction.date})`);
          console.log(`      post_date: "${transaction.post_date}" (${typeof transaction.post_date})`);
          console.log(`      value_date: "${transaction.value_date}" (${typeof transaction.value_date})`);
          console.log(`      description: "${transaction.description}"`);
          console.log(`      amount: ${transaction.amount}`);
          console.log(`      type: "${transaction.type}"`);
          console.log('');
        });
        
        // Verificar si las fechas están presentes
        const firstTransaction = transactions[0];
        console.log('🔍 Análisis de fechas en la primera transacción:');
        console.log(`   ¿Tiene campo "date"? ${firstTransaction.date ? '✅ SÍ' : '❌ NO'}`);
        console.log(`   ¿Tiene campo "post_date"? ${firstTransaction.post_date ? '✅ SÍ' : '❌ NO'}`);
        console.log(`   ¿Tiene campo "value_date"? ${firstTransaction.value_date ? '✅ SÍ' : '❌ NO'}`);
        
        if (!firstTransaction.date && !firstTransaction.post_date && !firstTransaction.value_date) {
          console.error('❌ PROBLEMA: La transacción no tiene ningún campo de fecha');
          return false;
        }
        
        if (firstTransaction.date) {
          console.log(`✅ Campo "date" disponible: ${firstTransaction.date}`);
        } else {
          console.log('⚠️  Campo "date" no disponible, pero hay otros campos de fecha');
        }
      }
    }
    
    // Verificar metadata
    if (apiResponse.result.meta) {
      console.log('\n📊 Metadata:');
      const meta = apiResponse.result.meta;
      console.log(`   processing_time: ${meta.processing_time}`);
      console.log(`   extraction_method: ${meta.extraction_method}`);
      console.log(`   total_transactions: ${meta.total_transactions}`);
    }
    
    console.log('\n🎉 Test del API completado exitosamente!');
    
    // Crear un JSON de ejemplo para el frontend
    console.log('\n📄 Respuesta JSON completa (para debugging):');
    console.log(JSON.stringify(apiResponse, null, 2));
    
    return true;
    
  } catch (error) {
    console.error('[API-RESPONSE-TEST] ❌ Error:', error);
    return false;
  }
}

// Ejecutar el test
testApiResponse()
  .then(success => {
    if (success) {
      console.log('\n✅ API RESPONSE TEST PASSED');
      process.exit(0);
    } else {
      console.log('\n❌ API RESPONSE TEST FAILED');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('[API-RESPONSE-TEST] ❌ Error inesperado:', error);
    process.exit(1);
  });