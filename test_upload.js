#!/usr/bin/env node

/**
 * Script de prueba para simular la subida de un archivo PDF
 */

import fs from 'fs';
import FormData from 'form-data';
import fetch from 'node-fetch';

const SERVER_URL = 'http://localhost:3000';
const PDF_PATH = './pdf/extracto1.pdf';

// Token de prueba (necesitarás usar un token válido)
const TEST_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjM3Y2JlMzM2LWJhNDktNDhhNi04MzQyLTBmMDhiNDAzYTRjNyIsImVtYWlsIjoidGVzdEBleGFtcGxlLmNvbSIsImlhdCI6MTcyNTQ2NzQxMCwiZXhwIjoxNzI2MDcyMjEwfQ.example';

async function testUpload() {
  try {
    console.log('🚀 Iniciando prueba de subida de PDF...');
    
    // Verificar que el archivo existe
    if (!fs.existsSync(PDF_PATH)) {
      console.error('❌ Archivo PDF no encontrado:', PDF_PATH);
      return;
    }
    
    // Crear FormData
    const form = new FormData();
    form.append('pdf', fs.createReadStream(PDF_PATH));
    
    console.log('📤 Subiendo archivo:', PDF_PATH);
    
    // Hacer la petición
    const response = await fetch(`${SERVER_URL}/api/documents/process`, {
      method: 'POST',
      body: form,
      headers: {
        'Authorization': `Bearer ${TEST_TOKEN}`,
        ...form.getHeaders()
      }
    });
    
    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ Archivo subido exitosamente');
      console.log('📋 Job ID:', result.jobId);
      console.log('📊 Queue Info:', result.queueInfo);
      
      // Monitorear el progreso
      await monitorJob(result.jobId);
      
    } else {
      console.error('❌ Error al subir archivo:', result);
    }
    
  } catch (error) {
    console.error('❌ Error en la prueba:', error.message);
  }
}

async function monitorJob(jobId) {
  console.log('\n🔍 Monitoreando progreso del job...');
  
  let completed = false;
  let attempts = 0;
  const maxAttempts = 30; // 30 intentos = 1 minuto
  
  while (!completed && attempts < maxAttempts) {
    try {
      const response = await fetch(`${SERVER_URL}/api/documents/status/${jobId}`, {
        headers: {
          'Authorization': `Bearer ${TEST_TOKEN}`
        }
      });
      
      const status = await response.json();
      
      console.log(`📊 Estado: ${status.state} - ${status.step || 'Procesando...'}`);
      
      if (status.state === 'completed') {
        console.log('🎉 ¡Procesamiento completado!');
        console.log('📈 Transacciones encontradas:', status.result?.transactions?.length || 0);
        completed = true;
      } else if (status.state === 'failed') {
        console.log('❌ Procesamiento falló:', status.failedReason);
        completed = true;
      }
      
      if (!completed) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Esperar 2 segundos
      }
      
    } catch (error) {
      console.error('❌ Error al consultar estado:', error.message);
    }
    
    attempts++;
  }
  
  if (!completed) {
    console.log('⏰ Timeout: El procesamiento está tomando más tiempo del esperado');
  }
}

// Ejecutar la prueba
testUpload();