#!/usr/bin/env node
/**
 * Debug script para verificar los montos extraídos vs el PDF original
 */
import { pdfProcessingQueue } from './src/config/queue.js';
import databaseService from './src/services/databaseService.js';
import { User } from './src/models/index.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('[AMOUNTS-DEBUG] Debugging extracted amounts vs PDF...');

async function debugAmounts() {
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
    const tempFilePath = path.join(tempDir, `debug_amounts_${Date.now()}_estado_unlocked.pdf`);
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
    
    // Obtener documento de la base de datos
    console.log('\n📊 Obteniendo transacciones extraídas...');
    const document = await databaseService.getDocumentByJobId(job.id.toString());
    
    if (!document) {
      console.error('❌ Documento no encontrado en la base de datos');
      return false;
    }
    
    let transactions;
    try {
      transactions = typeof document.transactions === 'string' 
        ? JSON.parse(document.transactions) 
        : document.transactions;
    } catch (parseErr) {
      console.error('❌ Error parseando transacciones:', parseErr);
      return false;
    }
    
    if (!Array.isArray(transactions) || transactions.length === 0) {
      console.error('❌ No hay transacciones válidas');
      return false;
    }
    
    console.log(`✅ Encontradas ${transactions.length} transacciones`);
    
    // Mostrar todas las transacciones con sus montos
    console.log('\n💰 ANÁLISIS DETALLADO DE MONTOS:\n');
    console.log('Fecha       | Descripción                    | Monto    | Tipo');
    console.log('------------|--------------------------------|----------|--------');
    
    let totalCredits = 0;
    let totalDebits = 0;
    
    transactions.forEach((transaction, index) => {
      const date = transaction.date || 'N/A';
      const description = (transaction.description || '').substring(0, 30).padEnd(30);
      const amount = transaction.amount || 0;
      const type = transaction.type || 'N/A';
      
      console.log(`${date.padEnd(11)} | ${description} | ${amount.toString().padStart(8)} | ${type}`);
      
      if (amount > 0) {
        totalCredits += amount;
      } else {
        totalDebits += Math.abs(amount);
      }
    });
    
    console.log('------------|--------------------------------|----------|--------');
    console.log(`TOTALES:    | Créditos: ${totalCredits.toFixed(2).padStart(18)} | Débitos: ${totalDebits.toFixed(2).padStart(8)} |`);
    
    // Análisis de patrones de montos
    console.log('\n🔍 ANÁLISIS DE PATRONES:\n');
    
    const amounts = transactions.map(t => t.amount).filter(a => a !== undefined && a !== null);
    const uniqueAmounts = [...new Set(amounts)].sort((a, b) => b - a);
    
    console.log('Montos únicos encontrados (ordenados de mayor a menor):');
    uniqueAmounts.slice(0, 20).forEach((amount, index) => {
      const count = amounts.filter(a => a === amount).length;
      console.log(`   ${index + 1}. ${amount} (aparece ${count} ${count === 1 ? 'vez' : 'veces'})`);
    });
    
    // Verificar si hay montos sospechosos
    console.log('\n⚠️  VERIFICACIÓN DE MONTOS SOSPECHOSOS:\n');
    
    const suspiciousTransactions = transactions.filter(t => {
      const amount = t.amount;
      // Montos que podrían ser problemáticos
      return (
        amount === 0 ||                    // Montos en cero
        amount > 100000 ||                 // Montos muy altos
        (amount > 0 && amount < 0.01) ||   // Montos muy pequeños positivos
        (amount < 0 && amount > -0.01) ||  // Montos muy pequeños negativos
        !Number.isFinite(amount)           // Montos no válidos
      );
    });
    
    if (suspiciousTransactions.length > 0) {
      console.log(`❌ Encontradas ${suspiciousTransactions.length} transacciones con montos sospechosos:`);
      suspiciousTransactions.forEach((transaction, index) => {
        console.log(`   ${index + 1}. "${transaction.description}" - Monto: ${transaction.amount}`);
      });
    } else {
      console.log('✅ No se encontraron montos sospechosos');
    }
    
    // Verificar tipos de datos
    console.log('\n🔢 VERIFICACIÓN DE TIPOS DE DATOS:\n');
    
    const amountTypes = transactions.map(t => ({
      description: t.description,
      amount: t.amount,
      type: typeof t.amount,
      isNumber: Number.isFinite(t.amount)
    }));
    
    const nonNumericAmounts = amountTypes.filter(t => !t.isNumber);
    if (nonNumericAmounts.length > 0) {
      console.log(`❌ Encontradas ${nonNumericAmounts.length} transacciones con montos no numéricos:`);
      nonNumericAmounts.forEach((transaction, index) => {
        console.log(`   ${index + 1}. "${transaction.description}" - Monto: ${transaction.amount} (${transaction.type})`);
      });
    } else {
      console.log('✅ Todos los montos son numéricos válidos');
    }
    
    console.log('\n📋 RESUMEN DEL ANÁLISIS:');
    console.log(`   Total transacciones: ${transactions.length}`);
    console.log(`   Montos únicos: ${uniqueAmounts.length}`);
    console.log(`   Transacciones sospechosas: ${suspiciousTransactions.length}`);
    console.log(`   Montos no numéricos: ${nonNumericAmounts.length}`);
    console.log(`   Total créditos: ${totalCredits.toFixed(2)}`);
    console.log(`   Total débitos: ${totalDebits.toFixed(2)}`);
    
    return true;
    
  } catch (error) {
    console.error('[AMOUNTS-DEBUG] ❌ Error:', error);
    return false;
  }
}

// Ejecutar el debug
debugAmounts()
  .then(success => {
    if (success) {
      console.log('\n✅ AMOUNTS DEBUG COMPLETED');
      process.exit(0);
    } else {
      console.log('\n❌ AMOUNTS DEBUG FAILED');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('[AMOUNTS-DEBUG] ❌ Error inesperado:', error);
    process.exit(1);
  });
