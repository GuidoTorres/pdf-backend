#!/usr/bin/env node
/**
 * End-to-End Test: Complete User Flow
 * Tests the entire flow from registration to PDF processing
 */

import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'http://localhost:3001/api';
const TEST_EMAIL = `test-e2e-${Date.now()}@example.com`;
const TEST_PASSWORD = 'TestPassword123!';

console.log('🧪 Starting E2E Complete Flow Test...\n');

class E2ETest {
  constructor() {
    this.authToken = null;
    this.userId = null;
  }

  async runAllTests() {
    try {
      console.log('📝 Test 1: User Registration');
      await this.testUserRegistration();
      
      console.log('🔐 Test 2: User Login');
      await this.testUserLogin();
      
      console.log('👤 Test 3: Get User Info');
      await this.testGetUserInfo();
      
      console.log('📄 Test 4: Upload and Process PDF');
      await this.testPdfUploadAndProcessing();
      
      console.log('📊 Test 5: Get Document History');
      await this.testGetDocumentHistory();
      
      console.log('🔄 Test 6: Check Subscription Limits');
      await this.testSubscriptionLimits();
      
      console.log('✅ All E2E tests passed!');
      return true;
      
    } catch (error) {
      console.error('❌ E2E test failed:', error.message);
      return false;
    }
  }

  async testUserRegistration() {
    const response = await axios.post(`${BASE_URL}/auth/register`, {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      name: 'E2E Test User'
    });

    if (response.status !== 201) {
      throw new Error(`Registration failed: ${response.status}`);
    }

    console.log('   ✅ User registered successfully');
  }

  async testUserLogin() {
    const response = await axios.post(`${BASE_URL}/auth/login`, {
      email: TEST_EMAIL,
      password: TEST_PASSWORD
    });

    if (response.status !== 200 || !response.data.token) {
      throw new Error('Login failed or no token received');
    }

    this.authToken = response.data.token;
    this.userId = response.data.user.id;
    console.log('   ✅ User logged in successfully');
  }

  async testGetUserInfo() {
    const response = await axios.get(`${BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${this.authToken}` }
    });

    if (response.status !== 200 || !response.data.user) {
      throw new Error('Failed to get user info');
    }

    const user = response.data.user;
    if (!user.subscription || user.subscription.pages_remaining === undefined) {
      throw new Error('User subscription data missing');
    }

    console.log('   ✅ User info retrieved successfully');
    console.log(`   📊 Pages remaining: ${user.subscription.pages_remaining}`);
  }

  async testPdfUploadAndProcessing() {
    const pdfPath = path.join(__dirname, 'pdf', 'estado_unlocked.pdf');
    
    // Check if test PDF exists
    try {
      await fs.access(pdfPath);
    } catch {
      throw new Error('Test PDF not found');
    }

    const formData = new FormData();
    const pdfBuffer = await fs.readFile(pdfPath);
    const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
    formData.append('pdf', blob, 'test-estado.pdf');

    const uploadResponse = await axios.post(`${BASE_URL}/documents/upload`, formData, {
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        'Content-Type': 'multipart/form-data'
      }
    });

    if (uploadResponse.status !== 200 || !uploadResponse.data.jobId) {
      throw new Error('PDF upload failed');
    }

    const jobId = uploadResponse.data.jobId;
    console.log(`   📤 PDF uploaded, job ID: ${jobId}`);

    // Wait for processing to complete
    let attempts = 0;
    const maxAttempts = 60; // 60 seconds timeout

    while (attempts < maxAttempts) {
      const statusResponse = await axios.get(`${BASE_URL}/documents/status/${jobId}`, {
        headers: { Authorization: `Bearer ${this.authToken}` }
      });

      const status = statusResponse.data.state;
      console.log(`   ⏳ Processing status: ${status} (attempt ${attempts + 1})`);

      if (status === 'completed') {
        const result = statusResponse.data.result;
        if (!result.transactions || result.transactions.length === 0) {
          throw new Error('No transactions found in processed PDF');
        }
        console.log(`   ✅ PDF processed successfully, ${result.transactions.length} transactions found`);
        return jobId;
      } else if (status === 'failed') {
        throw new Error('PDF processing failed');
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    throw new Error('PDF processing timeout');
  }

  async testGetDocumentHistory() {
    const response = await axios.get(`${BASE_URL}/documents/history`, {
      headers: { Authorization: `Bearer ${this.authToken}` }
    });

    if (response.status !== 200 || !Array.isArray(response.data.data)) {
      throw new Error('Failed to get document history');
    }

    const documents = response.data.data;
    if (documents.length === 0) {
      throw new Error('No documents found in history');
    }

    console.log(`   ✅ Document history retrieved, ${documents.length} documents found`);
  }

  async testSubscriptionLimits() {
    // Get current user info to check pages remaining
    const userResponse = await axios.get(`${BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${this.authToken}` }
    });

    const initialPages = userResponse.data.user.subscription.pages_remaining;
    
    // The previous PDF upload should have reduced the pages
    if (initialPages >= 10) { // Free plan starts with 10 pages
      throw new Error('Pages remaining not properly decremented after processing');
    }

    console.log(`   ✅ Subscription limits working correctly, pages remaining: ${initialPages}`);
  }
}

// Run the E2E test
const test = new E2ETest();
test.runAllTests()
  .then(success => {
    if (success) {
      console.log('\n🎉 E2E Complete Flow Test PASSED');
      process.exit(0);
    } else {
      console.log('\n❌ E2E Complete Flow Test FAILED');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('\n❌ E2E test error:', error);
    process.exit(1);
  });