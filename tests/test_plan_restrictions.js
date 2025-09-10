#!/usr/bin/env node
/**
 * Test de Restricciones por Plan
 * Verifica que las restricciones funcionen según el plan del usuario
 */

import database from './src/config/database.js';
import { User, Subscription } from './src/models/index.js';
import databaseService from './src/services/databaseService.js';

console.log('🧪 Testing Plan Restrictions...\n');

class PlanRestrictionsTest {
  async runAllTests() {
    try {
      await database.sync();
      console.log('✅ Database connected\n');

      console.log('🔍 Test 1: Verificar Usuarios y Planes');
      await this.testUserPlans();

      console.log('\n🔍 Test 2: Probar Restricciones por Plan');
      await this.testPlanRestrictions();

      console.log('\n✅ Tests de restricciones completados!');
      return true;

    } catch (error) {
      console.error('❌ Error en tests:', error.message);
      return false;
    } finally {
      await database.close();
    }
  }

  async testUserPlans() {
    const users = await User.findAll({
      include: [{ model: Subscription, as: 'subscription' }],
      limit: 5
    });

    console.log(`   📊 Usuarios encontrados: ${users.length}`);
    
    for (const user of users) {
      const userInfo = await databaseService.getUserInfo(user.id);
      const isUnlimited = userInfo.plan === 'unlimited' || userInfo.plan === 'ilimitado';
      
      console.log(`   👤 ${user.name} (${user.email})`);
      console.log(`      📋 Plan: ${userInfo.plan}`);
      console.log(`      📄 Páginas: ${isUnlimited ? '∞ (ilimitado)' : userInfo.pages_remaining}`);
      console.log(`      🔓 Acceso: ${isUnlimited ? 'ILIMITADO' : 'LIMITADO'}`);
      console.log('');
    }
  }

  async testPlanRestrictions() {
    const users = await User.findAll({
      include: [{ model: Subscription, as: 'subscription' }],
      limit: 3
    });

    for (const user of users) {
      const userInfo = await databaseService.getUserInfo(user.id);
      const isUnlimited = userInfo.plan === 'unlimited' || userInfo.plan === 'ilimitado';
      
      console.log(`   🧪 Probando usuario: ${user.name}`);
      console.log(`      Plan actual: ${userInfo.plan}`);
      
      if (isUnlimited) {
        console.log('      🔓 Usuario con plan ilimitado detectado');
        
        // Probar que no se descuenten páginas
        const initialPages = userInfo.pages_remaining;
        const remainingAfter = await databaseService.updatePagesRemaining(user.id, 5);
        
        if (remainingAfter === 999999) {
          console.log('      ✅ No se descontaron páginas (correcto)');
        } else {
          console.log('      ❌ Se descontaron páginas (error)');
        }
        
      } else {
        console.log('      🔒 Usuario con plan limitado');
        
        // Solo mostrar info, no modificar
        console.log(`      📄 Páginas disponibles: ${userInfo.pages_remaining}`);
        
        if (userInfo.pages_remaining > 0) {
          console.log('      ✅ Tiene páginas disponibles');
        } else {
          console.log('      ⚠️  Sin páginas disponibles');
        }
      }
      
      console.log('');
    }
  }
}

// Ejecutar tests
const test = new PlanRestrictionsTest();
test.runAllTests()
  .then(success => {
    if (success) {
      console.log('🎉 PLAN RESTRICTIONS TESTS COMPLETED');
      console.log('\n💡 Para crear usuario ilimitado:');
      console.log('   1. Abre MySQL Workbench');
      console.log('   2. Conecta a la base de datos "stamentai"');
      console.log('   3. Ejecuta: UPDATE subscriptions SET plan = "unlimited" WHERE user_id = "TU_USER_ID";');
      console.log('   4. O cambia el plan a "ilimitado" en la tabla subscriptions');
      process.exit(0);
    } else {
      console.log('❌ PLAN RESTRICTIONS TESTS FAILED');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('💥 Test error:', error);
    process.exit(1);
  });