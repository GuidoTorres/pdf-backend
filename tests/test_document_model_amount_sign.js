/**
 * Test script for Document model amount sign detection fields
 * This script tests the new fields and methods added for amount sign detection
 */

import Document from './src/models/Document.js';

async function testDocumentModelAmountSign() {
  console.log('🧪 Testing Document model amount sign detection fields...\n');
  
  try {
    // Test 1: Verify model definition includes new fields
    console.log('✅ Test 1: Model definition');
    const modelAttributes = Document.getTableName ? Document.rawAttributes : Document.attributes;
    
    const requiredFields = ['original_credit', 'original_debit', 'original_amount', 'sign_detection_method'];
    const missingFields = requiredFields.filter(field => !modelAttributes[field]);
    
    if (missingFields.length === 0) {
      console.log('   ✓ All required fields are defined in the model');
      requiredFields.forEach(field => {
        console.log(`   ✓ ${field}: ${modelAttributes[field].type.constructor.name}`);
      });
    } else {
      console.log('   ❌ Missing fields:', missingFields);
      return false;
    }
    
    // Test 2: Verify field validation
    console.log('\n✅ Test 2: Field validation');
    const signDetectionField = modelAttributes.sign_detection_method;
    if (signDetectionField.validate && signDetectionField.validate.isIn) {
      const allowedValues = signDetectionField.validate.isIn[0];
      console.log('   ✓ sign_detection_method validation:', allowedValues);
      
      if (allowedValues.includes('columns') && allowedValues.includes('heuristics') && allowedValues.includes('hybrid')) {
        console.log('   ✓ All expected values are allowed');
      } else {
        console.log('   ❌ Missing expected validation values');
        return false;
      }
    } else {
      console.log('   ❌ sign_detection_method validation not found');
      return false;
    }
    
    // Test 3: Verify helper methods exist
    console.log('\n✅ Test 3: Helper methods');
    const documentInstance = Document.build({
      user_id: '12345678-1234-1234-1234-123456789012',
      job_id: 'test-job-123',
      original_file_name: 'test.pdf'
    });
    
    if (typeof documentInstance.updateAmountSignData === 'function') {
      console.log('   ✓ updateAmountSignData method exists');
    } else {
      console.log('   ❌ updateAmountSignData method not found');
      return false;
    }
    
    if (typeof documentInstance.getAmountSignData === 'function') {
      console.log('   ✓ getAmountSignData method exists');
    } else {
      console.log('   ❌ getAmountSignData method not found');
      return false;
    }
    
    // Test 4: Test helper method functionality
    console.log('\n✅ Test 4: Helper method functionality');
    
    // Set some test data
    documentInstance.original_credit = 1500.50;
    documentInstance.original_debit = null;
    documentInstance.original_amount = 1500.50;
    documentInstance.sign_detection_method = 'columns';
    
    const amountSignData = documentInstance.getAmountSignData();
    console.log('   ✓ getAmountSignData result:', amountSignData);
    
    if (amountSignData.original_credit === 1500.50 &&
        amountSignData.original_debit === null &&
        amountSignData.original_amount === 1500.50 &&
        amountSignData.sign_detection_method === 'columns') {
      console.log('   ✓ getAmountSignData returns correct data');
    } else {
      console.log('   ❌ getAmountSignData returns incorrect data');
      return false;
    }
    
    console.log('\n🎉 All tests passed! Document model is ready for amount sign detection.');
    return true;
    
  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    return false;
  }
}

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testDocumentModelAmountSign()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test execution failed:', error);
      process.exit(1);
    });
}

export { testDocumentModelAmountSign };