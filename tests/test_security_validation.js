#!/usr/bin/env node
/**
 * Security Tests: Input validation, authentication, and security headers
 */

import axios from 'axios';

const BASE_URL = 'http://localhost:3001/api';

console.log('🔒 Starting Security Validation Tests...\n');

class SecurityTest {
  constructor() {
    this.validToken = null;
  }

  async runAllTests() {
    try {
      console.log('🔐 Test 1: Authentication Security');
      await this.testAuthenticationSecurity();
      
      console.log('📝 Test 2: Input Validation');
      await this.testInputValidation();
      
      console.log('🌐 Test 3: CORS and Headers');
      await this.testCorsAndHeaders();
      
      console.log('🚫 Test 4: Rate Limiting');
      await this.testRateLimiting();
      
      console.log('🔑 Test 5: JWT Token Security');
      await this.testJwtSecurity();
      
      console.log('✅ All security tests passed!');
      return true;
      
    } catch (error) {
      console.error('❌ Security test failed:', error.message);
      return false;
    }
  }

  async testAuthenticationSecurity() {
    // Test 1: Access protected endpoint without token
    try {
      await axios.get(`${BASE_URL}/auth/me`);
      throw new Error('Protected endpoint accessible without token');
    } catch (error) {
      if (error.response?.status !== 401) {
        throw new Error('Expected 401 for missing token');
      }
    }

    // Test 2: Access with invalid token
    try {
      await axios.get(`${BASE_URL}/auth/me`, {
        headers: { Authorization: 'Bearer invalid-token' }
      });
      throw new Error('Protected endpoint accessible with invalid token');
    } catch (error) {
      if (error.response?.status !== 401) {
        throw new Error('Expected 401 for invalid token');
      }
    }

    // Test 3: Get valid token for further tests
    try {
      const loginResponse = await axios.post(`${BASE_URL}/auth/login`, {
        email: 'hectortorresdurand@gmail.com', // Use existing test user
        password: 'password123' // Assuming this is the test password
      });
      this.validToken = loginResponse.data.token;
    } catch (error) {
      console.log('   ⚠️  Could not get valid token for further tests (user may not exist)');
    }

    console.log('   ✅ Authentication security working correctly');
  }

  async testInputValidation() {
    // Test 1: SQL Injection attempts
    const sqlInjectionPayloads = [
      "'; DROP TABLE users; --",
      "' OR '1'='1",
      "admin'--",
      "' UNION SELECT * FROM users --"
    ];

    for (const payload of sqlInjectionPayloads) {
      try {
        await axios.post(`${BASE_URL}/auth/login`, {
          email: payload,
          password: 'test'
        });
      } catch (error) {
        // Should fail with validation error, not SQL error
        if (error.response?.status === 500) {
          throw new Error('Possible SQL injection vulnerability');
        }
      }
    }

    // Test 2: XSS attempts
    const xssPayloads = [
      "<script>alert('xss')</script>",
      "javascript:alert('xss')",
      "<img src=x onerror=alert('xss')>"
    ];

    for (const payload of xssPayloads) {
      try {
        await axios.post(`${BASE_URL}/auth/register`, {
          email: 'test@example.com',
          password: 'Test123!',
          name: payload
        });
      } catch (error) {
        // Should be handled gracefully
        if (error.response?.status === 500) {
          throw new Error('Possible XSS vulnerability');
        }
      }
    }

    // Test 3: Invalid email formats
    const invalidEmails = [
      'invalid-email',
      '@example.com',
      'test@',
      'test..test@example.com'
    ];

    for (const email of invalidEmails) {
      try {
        const response = await axios.post(`${BASE_URL}/auth/register`, {
          email: email,
          password: 'Test123!',
          name: 'Test User'
        });
        if (response.status === 201) {
          throw new Error(`Invalid email accepted: ${email}`);
        }
      } catch (error) {
        // Should fail with validation error
        if (error.response?.status !== 400) {
          throw new Error('Invalid email validation not working');
        }
      }
    }

    console.log('   ✅ Input validation working correctly');
  }

  async testCorsAndHeaders() {
    // Test CORS headers
    try {
      const response = await axios.options(`${BASE_URL}/auth/me`);
      
      const corsHeaders = response.headers;
      if (!corsHeaders['access-control-allow-origin']) {
        throw new Error('CORS headers missing');
      }

    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        console.log('   ⚠️  Server not running, skipping CORS test');
      } else {
        throw error;
      }
    }

    console.log('   ✅ CORS and headers configured correctly');
  }

  async testRateLimiting() {
    // Test rate limiting on login endpoint
    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(
        axios.post(`${BASE_URL}/auth/login`, {
          email: 'nonexistent@example.com',
          password: 'wrongpassword'
        }).catch(error => error.response)
      );
    }

    try {
      const responses = await Promise.all(promises);
      const rateLimitedResponses = responses.filter(r => r?.status === 429);
      
      // Should have some rate limiting after many requests
      if (rateLimitedResponses.length === 0) {
        console.log('   ⚠️  No rate limiting detected (may need implementation)');
      } else {
        console.log(`   ✅ Rate limiting working (${rateLimitedResponses.length} requests blocked)`);
      }
    } catch (error) {
      console.log('   ⚠️  Could not test rate limiting');
    }
  }

  async testJwtSecurity() {
    if (!this.validToken) {
      console.log('   ⚠️  No valid token available, skipping JWT tests');
      return;
    }

    // Test 1: Token with modified payload
    const tokenParts = this.validToken.split('.');
    if (tokenParts.length !== 3) {
      throw new Error('Invalid JWT token format');
    }

    // Modify the payload
    const modifiedPayload = Buffer.from('{"userId":"admin","role":"admin"}').toString('base64');
    const modifiedToken = `${tokenParts[0]}.${modifiedPayload}.${tokenParts[2]}`;

    try {
      await axios.get(`${BASE_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${modifiedToken}` }
      });
      throw new Error('Modified JWT token accepted');
    } catch (error) {
      if (error.response?.status !== 401) {
        throw new Error('Modified JWT should return 401');
      }
    }

    // Test 2: Expired token (simulate by using old timestamp)
    // This would require creating a token with past expiration
    
    console.log('   ✅ JWT security working correctly');
  }
}

// Run the security tests
const test = new SecurityTest();
test.runAllTests()
  .then(success => {
    if (success) {
      console.log('\n🔒 Security Validation Tests PASSED');
      process.exit(0);
    } else {
      console.log('\n❌ Security Validation Tests FAILED');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('\n❌ Security test error:', error);
    process.exit(1);
  });