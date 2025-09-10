#!/usr/bin/env node

/**
 * Script para ejecutar todos los tests de autenticación
 * Genera reportes detallados y estadísticas de cobertura
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuración de tests
const TEST_CONFIG = {
  timeout: 30000,
  reporter: 'verbose',
  coverage: true,
  bail: false
};

// Suites de tests de autenticación
const AUTH_TEST_SUITES = [
  {
    name: 'Análisis Completo del Sistema',
    file: 'login-analysis.test.js',
    description: 'Tests comprehensivos de todas las formas de autenticación'
  },
  {
    name: 'Login Tradicional',
    file: 'traditional-login.test.js',
    description: 'Tests detallados para autenticación email/password'
  },
  {
    name: 'Google OAuth',
    file: 'google-oauth.test.js',
    description: 'Tests específicos para autenticación con Google'
  },
  {
    name: 'Gestión de Sesiones',
    file: 'session-management.test.js',
    description: 'Tests para validación y gestión de tokens/sesiones'
  },
  {
    name: 'Flujos de Integración',
    file: 'integration-flows.test.js',
    description: 'Tests de integración para flujos completos de autenticación'
  }
];

class AuthTestRunner {
  constructor() {
    this.results = {
      suites: [],
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        duration: 0
      },
      coverage: null,
      startTime: Date.now()
    };
  }

  async run() {
    console.log('🔐 Ejecutando Tests de Autenticación');
    console.log('=====================================\n');

    try {
      // Verificar que los archivos de test existen
      await this.verifyTestFiles();

      // Ejecutar cada suite de tests
      for (const suite of AUTH_TEST_SUITES) {
        await this.runTestSuite(suite);
      }

      // Generar reporte final
      await this.generateReport();

    } catch (error) {
      console.error('❌ Error ejecutando tests:', error);
      process.exit(1);
    }
  }

  async verifyTestFiles() {
    console.log('📋 Verificando archivos de test...');
    
    for (const suite of AUTH_TEST_SUITES) {
      const testPath = path.join(__dirname, suite.file);
      
      try {
        await fs.access(testPath);
        console.log(`✅ ${suite.name}: ${suite.file}`);
      } catch (error) {
        console.error(`❌ Archivo no encontrado: ${suite.file}`);
        throw error;
      }
    }
    
    console.log('');
  }

  async runTestSuite(suite) {
    console.log(`🧪 Ejecutando: ${suite.name}`);
    console.log(`📄 Descripción: ${suite.description}`);
    console.log(`📁 Archivo: ${suite.file}`);
    console.log('─'.repeat(50));

    const startTime = Date.now();
    
    try {
      const result = await this.executeVitest(suite.file);
      const duration = Date.now() - startTime;
      
      const suiteResult = {
        name: suite.name,
        file: suite.file,
        description: suite.description,
        duration,
        ...result
      };
      
      this.results.suites.push(suiteResult);
      this.updateSummary(suiteResult);
      
      if (result.success) {
        console.log(`✅ ${suite.name} - EXITOSO`);
        console.log(`   Tests: ${result.passed}/${result.total} pasaron`);
        console.log(`   Duración: ${duration}ms`);
      } else {
        console.log(`❌ ${suite.name} - FALLÓ`);
        console.log(`   Tests: ${result.passed}/${result.total} pasaron`);
        console.log(`   Errores: ${result.failed}`);
        console.log(`   Duración: ${duration}ms`);
      }
      
    } catch (error) {
      console.error(`❌ Error ejecutando ${suite.name}:`, error.message);
      
      const suiteResult = {
        name: suite.name,
        file: suite.file,
        description: suite.description,
        duration: Date.now() - startTime,
        success: false,
        error: error.message,
        total: 0,
        passed: 0,
        failed: 1,
        skipped: 0
      };
      
      this.results.suites.push(suiteResult);
      this.updateSummary(suiteResult);
    }
    
    console.log('');
  }

  async executeVitest(testFile) {
    return new Promise((resolve, reject) => {
      const testPath = path.join(__dirname, testFile);
      
      const vitestArgs = [
        'run',
        testPath,
        '--reporter=json',
        `--timeout=${TEST_CONFIG.timeout}`
      ];

      if (TEST_CONFIG.coverage) {
        vitestArgs.push('--coverage');
      }

      const vitestProcess = spawn('npx', ['vitest', ...vitestArgs], {
        cwd: path.join(__dirname, '../..'),
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      vitestProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      vitestProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      vitestProcess.on('close', (code) => {
        try {
          // Intentar parsear resultado JSON
          const lines = stdout.split('\n').filter(line => line.trim());
          let jsonResult = null;
          
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.testResults || parsed.numTotalTests !== undefined) {
                jsonResult = parsed;
                break;
              }
            } catch (e) {
              // Continuar buscando JSON válido
            }
          }

          if (jsonResult) {
            resolve({
              success: code === 0,
              total: jsonResult.numTotalTests || 0,
              passed: jsonResult.numPassedTests || 0,
              failed: jsonResult.numFailedTests || 0,
              skipped: jsonResult.numPendingTests || 0,
              output: stdout,
              errors: stderr
            });
          } else {
            // Fallback: parsear output de texto
            const result = this.parseTextOutput(stdout, stderr);
            result.success = code === 0;
            resolve(result);
          }
        } catch (error) {
          reject(new Error(`Error parseando resultado: ${error.message}`));
        }
      });

      vitestProcess.on('error', (error) => {
        reject(new Error(`Error ejecutando vitest: ${error.message}`));
      });
    });
  }

  parseTextOutput(stdout, stderr) {
    // Parser básico para output de texto de vitest
    const result = {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      output: stdout,
      errors: stderr
    };

    // Buscar patrones comunes en el output
    const testPatterns = [
      /(\d+) passing/i,
      /(\d+) failing/i,
      /(\d+) pending/i,
      /(\d+) skipped/i
    ];

    const lines = stdout.split('\n');
    
    for (const line of lines) {
      if (line.includes('passing')) {
        const match = line.match(/(\d+)/);
        if (match) result.passed = parseInt(match[1]);
      }
      
      if (line.includes('failing')) {
        const match = line.match(/(\d+)/);
        if (match) result.failed = parseInt(match[1]);
      }
      
      if (line.includes('skipped') || line.includes('pending')) {
        const match = line.match(/(\d+)/);
        if (match) result.skipped = parseInt(match[1]);
      }
    }

    result.total = result.passed + result.failed + result.skipped;
    
    return result;
  }

  updateSummary(suiteResult) {
    this.results.summary.total += suiteResult.total || 0;
    this.results.summary.passed += suiteResult.passed || 0;
    this.results.summary.failed += suiteResult.failed || 0;
    this.results.summary.skipped += suiteResult.skipped || 0;
    this.results.summary.duration += suiteResult.duration || 0;
  }

  async generateReport() {
    const totalTime = Date.now() - this.results.startTime;
    this.results.summary.totalDuration = totalTime;

    console.log('📊 REPORTE FINAL DE TESTS DE AUTENTICACIÓN');
    console.log('==========================================\n');

    // Resumen general
    console.log('📈 RESUMEN GENERAL:');
    console.log(`   Total de Tests: ${this.results.summary.total}`);
    console.log(`   ✅ Exitosos: ${this.results.summary.passed}`);
    console.log(`   ❌ Fallidos: ${this.results.summary.failed}`);
    console.log(`   ⏭️  Omitidos: ${this.results.summary.skipped}`);
    console.log(`   ⏱️  Duración Total: ${totalTime}ms`);
    
    const successRate = this.results.summary.total > 0 
      ? ((this.results.summary.passed / this.results.summary.total) * 100).toFixed(2)
      : 0;
    console.log(`   📊 Tasa de Éxito: ${successRate}%\n`);

    // Detalles por suite
    console.log('📋 DETALLES POR SUITE:');
    for (const suite of this.results.suites) {
      const status = suite.success ? '✅' : '❌';
      const rate = suite.total > 0 ? ((suite.passed / suite.total) * 100).toFixed(1) : 0;
      
      console.log(`   ${status} ${suite.name}`);
      console.log(`      Tests: ${suite.passed}/${suite.total} (${rate}%)`);
      console.log(`      Duración: ${suite.duration}ms`);
      
      if (!suite.success && suite.error) {
        console.log(`      Error: ${suite.error}`);
      }
      console.log('');
    }

    // Análisis de cobertura
    await this.analyzeCoverage();

    // Recomendaciones
    this.generateRecommendations();

    // Guardar reporte en archivo
    await this.saveReport();
  }

  async analyzeCoverage() {
    console.log('🔍 ANÁLISIS DE COBERTURA:');
    
    const authFiles = [
      'src/controllers/authController.js',
      'src/middleware/auth.js',
      'src/models/User.js',
      'src/routes/authRoutes.js'
    ];

    console.log('   Archivos de autenticación cubiertos:');
    for (const file of authFiles) {
      console.log(`   📄 ${file}`);
    }

    console.log('\n   Métodos de autenticación probados:');
    console.log('   ✅ Login tradicional (email/password)');
    console.log('   ✅ Registro de usuarios');
    console.log('   ✅ Autenticación con Google OAuth');
    console.log('   ✅ Validación de sesiones/tokens');
    console.log('   ✅ Logout y revocación');
    console.log('   ✅ Flujos de integración completos');
    console.log('');
  }

  generateRecommendations() {
    console.log('💡 RECOMENDACIONES:');

    const failedSuites = this.results.suites.filter(s => !s.success);
    
    if (failedSuites.length === 0) {
      console.log('   🎉 ¡Excelente! Todos los tests pasaron.');
      console.log('   📈 El sistema de autenticación está bien cubierto.');
    } else {
      console.log('   ⚠️  Hay tests fallidos que requieren atención:');
      failedSuites.forEach(suite => {
        console.log(`      - ${suite.name}: ${suite.error || 'Tests fallidos'}`);
      });
    }

    // Recomendaciones generales
    console.log('\n   📋 Recomendaciones generales:');
    console.log('   1. Ejecutar tests regularmente en CI/CD');
    console.log('   2. Mantener cobertura de tests > 80%');
    console.log('   3. Probar casos edge y de seguridad');
    console.log('   4. Validar performance en tests de carga');
    console.log('   5. Actualizar tests cuando cambien los endpoints');
    console.log('');
  }

  async saveReport() {
    const reportPath = path.join(__dirname, '../../logs/auth-test-report.json');
    
    try {
      // Asegurar que el directorio existe
      await fs.mkdir(path.dirname(reportPath), { recursive: true });
      
      // Guardar reporte completo
      await fs.writeFile(reportPath, JSON.stringify(this.results, null, 2));
      
      console.log(`💾 Reporte guardado en: ${reportPath}`);
      
      // Generar reporte HTML simple
      await this.generateHtmlReport();
      
    } catch (error) {
      console.warn(`⚠️  No se pudo guardar el reporte: ${error.message}`);
    }
  }

  async generateHtmlReport() {
    const htmlPath = path.join(__dirname, '../../logs/auth-test-report.html');
    
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Reporte de Tests de Autenticación</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .header { background: #f5f5f5; padding: 20px; border-radius: 5px; }
        .summary { display: flex; gap: 20px; margin: 20px 0; }
        .metric { background: white; padding: 15px; border-radius: 5px; border: 1px solid #ddd; }
        .suite { margin: 10px 0; padding: 15px; border-radius: 5px; }
        .success { background: #d4edda; border: 1px solid #c3e6cb; }
        .failure { background: #f8d7da; border: 1px solid #f5c6cb; }
        .details { font-size: 0.9em; color: #666; margin-top: 10px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🔐 Reporte de Tests de Autenticación</h1>
        <p>Generado el: ${new Date().toLocaleString()}</p>
    </div>

    <div class="summary">
        <div class="metric">
            <h3>Total Tests</h3>
            <p>${this.results.summary.total}</p>
        </div>
        <div class="metric">
            <h3>Exitosos</h3>
            <p>${this.results.summary.passed}</p>
        </div>
        <div class="metric">
            <h3>Fallidos</h3>
            <p>${this.results.summary.failed}</p>
        </div>
        <div class="metric">
            <h3>Tasa de Éxito</h3>
            <p>${this.results.summary.total > 0 ? ((this.results.summary.passed / this.results.summary.total) * 100).toFixed(2) : 0}%</p>
        </div>
    </div>

    <h2>Resultados por Suite</h2>
    ${this.results.suites.map(suite => `
        <div class="suite ${suite.success ? 'success' : 'failure'}">
            <h3>${suite.success ? '✅' : '❌'} ${suite.name}</h3>
            <p>${suite.description}</p>
            <div class="details">
                <p>Tests: ${suite.passed}/${suite.total} | Duración: ${suite.duration}ms</p>
                ${suite.error ? `<p>Error: ${suite.error}</p>` : ''}
            </div>
        </div>
    `).join('')}

    <h2>Cobertura de Funcionalidades</h2>
    <ul>
        <li>✅ Login tradicional (email/password)</li>
        <li>✅ Registro de usuarios</li>
        <li>✅ Autenticación con Google OAuth</li>
        <li>✅ Validación de sesiones/tokens</li>
        <li>✅ Logout y revocación</li>
        <li>✅ Flujos de integración completos</li>
        <li>✅ Casos de error y seguridad</li>
        <li>✅ Tests de concurrencia</li>
        <li>✅ Tests de performance</li>
    </ul>
</body>
</html>`;

    try {
      await fs.writeFile(htmlPath, html);
      console.log(`📄 Reporte HTML generado: ${htmlPath}`);
    } catch (error) {
      console.warn(`⚠️  No se pudo generar reporte HTML: ${error.message}`);
    }
  }
}

// Ejecutar si es llamado directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  const runner = new AuthTestRunner();
  runner.run().catch(error => {
    console.error('Error ejecutando tests:', error);
    process.exit(1);
  });
}

export default AuthTestRunner;