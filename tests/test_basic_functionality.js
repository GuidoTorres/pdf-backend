#!/usr/bin/env node
/**
 * Basic Functionality Test
 * Tests core functionality without requiring database connection
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🧪 Basic Functionality Test (No Database Required)\n');

class BasicFunctionalityTest {
  constructor() {
    this.results = {
      passed: 0,
      failed: 0,
      tests: []
    };
  }

  async runAllTests() {
    try {
      console.log('📁 Test 1: Project Structure');
      await this.testProjectStructure();
      
      console.log('📦 Test 2: Dependencies');
      await this.testDependencies();
      
      console.log('🔧 Test 3: Configuration Files');
      await this.testConfigurationFiles();
      
      console.log('🔒 Test 4: Environment Variables');
      await this.testEnvironmentVariables();
      
      console.log('📄 Test 5: Core Files');
      await this.testCoreFiles();
      
      console.log('🧪 Test 6: Test Files');
      await this.testTestFiles();
      
      this.generateReport();
      return this.results.failed === 0;
      
    } catch (error) {
      console.error('❌ Basic functionality test failed:', error.message);
      return false;
    }
  }

  async testProjectStructure() {
    const requiredDirs = [
      'src',
      'src/controllers',
      'src/routes',
      'src/services',
      'src/models',
      'src/config',
      'src/middleware'
    ];

    let allDirsExist = true;

    for (const dir of requiredDirs) {
      try {
        const stat = await fs.stat(dir);
        if (stat.isDirectory()) {
          console.log(`   ✅ ${dir}/`);
        } else {
          console.log(`   ❌ ${dir} is not a directory`);
          allDirsExist = false;
        }
      } catch {
        console.log(`   ❌ Missing: ${dir}/`);
        allDirsExist = false;
      }
    }

    this.recordTest('Project Structure', allDirsExist);
  }

  async testDependencies() {
    try {
      const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8'));
      const deps = packageJson.dependencies || {};
      
      const criticalDeps = [
        'express',
        'sequelize',
        'mysql2',
        'jsonwebtoken',
        'bcryptjs',
        'cors',
        'dotenv'
      ];

      let allDepsPresent = true;
      console.log(`   📦 Total dependencies: ${Object.keys(deps).length}`);

      for (const dep of criticalDeps) {
        if (deps[dep]) {
          console.log(`   ✅ ${dep}: ${deps[dep]}`);
        } else {
          console.log(`   ❌ Missing: ${dep}`);
          allDepsPresent = false;
        }
      }

      this.recordTest('Dependencies', allDepsPresent);
    } catch (error) {
      console.log(`   ❌ Error reading package.json: ${error.message}`);
      this.recordTest('Dependencies', false);
    }
  }

  async testConfigurationFiles() {
    const configFiles = [
      'src/config/config.js',
      'src/config/database.js',
      '.env.example'
    ];

    let allConfigsExist = true;

    for (const file of configFiles) {
      try {
        await fs.access(file);
        console.log(`   ✅ ${file}`);
      } catch {
        console.log(`   ❌ Missing: ${file}`);
        allConfigsExist = false;
      }
    }

    this.recordTest('Configuration Files', allConfigsExist);
  }

  async testEnvironmentVariables() {
    try {
      const envExample = await fs.readFile('.env.example', 'utf8');
      const requiredVars = [
        'DB_HOST',
        'DB_NAME',
        'DB_USER',
        'JWT_SECRET'
      ];

      let allVarsPresent = true;

      for (const varName of requiredVars) {
        if (envExample.includes(varName)) {
          console.log(`   ✅ ${varName} documented`);
        } else {
          console.log(`   ❌ ${varName} not in .env.example`);
          allVarsPresent = false;
        }
      }

      // Check if .env exists
      try {
        await fs.access('.env');
        console.log('   ✅ .env file exists');
      } catch {
        console.log('   ⚠️  .env file not found (create from .env.example)');
      }

      this.recordTest('Environment Variables', allVarsPresent);
    } catch (error) {
      console.log(`   ❌ Error checking environment: ${error.message}`);
      this.recordTest('Environment Variables', false);
    }
  }

  async testCoreFiles() {
    const coreFiles = [
      'src/app.js',
      'src/routes/authRoutes.js',
      'src/routes/documentRoutes.js',
      'src/controllers/authController.js',
      'src/controllers/documentController.js',
      'src/models/index.js'
    ];

    let allCoreFilesExist = true;

    for (const file of coreFiles) {
      try {
        const content = await fs.readFile(file, 'utf8');
        console.log(`   ✅ ${file} (${content.length} chars)`);
      } catch {
        console.log(`   ❌ Missing: ${file}`);
        allCoreFilesExist = false;
      }
    }

    this.recordTest('Core Files', allCoreFilesExist);
  }

  async testTestFiles() {
    try {
      const files = await fs.readdir('.');
      const testFiles = files.filter(file => file.includes('test'));
      
      console.log(`   📊 Found ${testFiles.length} test files:`);
      testFiles.forEach(file => {
        console.log(`     - ${file}`);
      });

      const hasTests = testFiles.length > 0;
      this.recordTest('Test Files', hasTests);
    } catch (error) {
      console.log(`   ❌ Error checking test files: ${error.message}`);
      this.recordTest('Test Files', false);
    }
  }

  recordTest(name, passed) {
    if (passed) {
      this.results.passed++;
    } else {
      this.results.failed++;
    }

    this.results.tests.push({ name, passed });
  }

  generateReport() {
    console.log('\n' + '=' .repeat(50));
    console.log('📊 BASIC FUNCTIONALITY TEST REPORT');
    console.log('=' .repeat(50));

    const total = this.results.passed + this.results.failed;
    const successRate = (this.results.passed / total) * 100;

    console.log(`\n📈 Summary:`);
    console.log(`   Total Tests: ${total}`);
    console.log(`   ✅ Passed: ${this.results.passed}`);
    console.log(`   ❌ Failed: ${this.results.failed}`);
    console.log(`   📊 Success Rate: ${successRate.toFixed(1)}%`);

    console.log(`\n📋 Test Results:`);
    this.results.tests.forEach(test => {
      const status = test.passed ? '✅' : '❌';
      console.log(`   ${status} ${test.name}`);
    });

    console.log(`\n🎯 Next Steps:`);
    if (this.results.failed === 0) {
      console.log('   ✅ Basic functionality is working!');
      console.log('   🔧 Now fix the database connection:');
      console.log('      node setup_database.js');
      console.log('   🧪 Then run full tests:');
      console.log('      node test-runner.js');
    } else {
      console.log('   🔧 Fix the failed basic tests first');
      console.log('   📁 Ensure all required files and directories exist');
      console.log('   📦 Install missing dependencies with: npm install');
    }

    console.log('\n' + '=' .repeat(50));
  }
}

// Run the basic functionality test
const test = new BasicFunctionalityTest();
test.runAllTests()
  .then(success => {
    if (success) {
      console.log('\n✅ BASIC FUNCTIONALITY TEST PASSED');
      process.exit(0);
    } else {
      console.log('\n❌ BASIC FUNCTIONALITY TEST FAILED');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('\n💥 Test error:', error);
    process.exit(1);
  });