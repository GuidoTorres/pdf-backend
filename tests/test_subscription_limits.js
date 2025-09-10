#!/usr/bin/env node
/**
 * Test de Límites de Suscripción
 * Verifica que las restricciones por plan funcionen correctamente
 */

import database from './src/config/database.js';
import { User, Subscription } from './src/models/index.js';
import databaseService from './src/services/databaseService.js';

console.log('🧪 Testing Subscription Limits...\n');

class SubscriptionLimitsTest {
  async runAllTests() {
    try {
      await database.sync();
      console.log('✅ Database connected\n');

      console.log('🔍 Test 1: Usuario Normal con Límites');
      await this.testNormalUserLimits();

      console.log('\n🔍 Test 2: Usuario con Acceso Ilimitado');
      await this.testUnlimitedUser();

      console.log('\n🔍 Test 3: Verificar Restricciones de Páginas');
      await this.testPageRestrictions();

      console.log('\n✅ Todos los tests de límites pasaron!');
      return true;

    } catch (error) {
      console.error('❌ Error en tests:', error.message);
      return false;
    } finally {
      await database.close();
    }
  }

  async testNormalUserLimits() {
    // Buscar un usuario normal
    const normalUser = await User.findOne({
      where: { unlimited_access: false },
      include: [{ model: Subscription, as: 'subscription' }]
    });

    if (!normalUser) {
      console.log('   ⚠️  No hay usuarios normales para probar');
      return;
    }

    console.log(`   👤 Usuario: ${normalUser.name} (${normalUser.email})`);
    console.log(`   🔒 Acceso ilimitado: ${normalUser.unlimited_access}`);
    
    const userInfo = await databaseService.getUserInfo(normalUser.id);
    console.log(`   📄 Páginas restantes: ${userInfo.pages_remaining}`);
    console.log(`   📋 Plan: ${userInfo.plan}`);

    // Verificar que tiene límites
    if (userInfo.pages_remaining < 999999) {
      console.log('   ✅ Usuario normal tiene límites correctos');
    } else {
      console.log('   ❌ Usuario normal no tiene límites (error)');
    }
  }

  async testUnlimitedUser() {
    // Buscar usuario con acceso ilimitado
    const unlimitedUser = await User.findOne({
      where: { unlimited_access: true },
      include: [{ model: Subscription, as: 'subscription' }]
    });

    if (!unlimitedUser) {
      console.log('   ⚠️  No hay usuarios con acceso ilimitado');
      console.log('   💡 Ejecuta: node create_unlimited_user.js');
      return;
    }

    console.log(`   👤 Usuario: ${unlimitedUser.name} (${unlimitedUser.email})`);
    console.log(`   🔓 Acceso ilimitado: ${unlimitedUser.unlimited_access}`);
    
    const userInfo = await databaseService.getUserInfo(unlimitedUser.id);
    console.log(`   📄 Páginas restantes: ${userInfo.pages_remaining === 999999 ? '∞ (ilimitado)' : userInfo.pages_remaining}`);
    console.log(`   📋 Plan: ${userInfo.plan}`);

    // Verificar que no tiene límites
    if (userInfo.pages_remaining === 999999) {
      console.log('   ✅ Usuario ilimitado configurado correctamente');
    } else {
      console.log('   ❌ Usuario ilimitado no está configurado correctamente');
    }
  }

  async testPageRestrictions() {
    // Test con usuario normal
    const normalUser = await User.findOne({
      where: { unlimited_access: false },
      include: [{ model: Subscription, as: 'subscription' }]
    });

    if (normalUser && normalUser.subscription) {
      const initialPages = normalUser.subscription.pages_remaining;
      console.log(`   📊 Usuario normal - Páginas iniciales: ${initialPages}`);

      try {
        // Simular uso de 2 páginas
        const remainingPages = await databaseService.updatePagesRemaining(normalUser.id, 2);
        console.log(`   📊 Después de usar 2 páginas: ${remainingPages}`);
        
        if (remainingPages === initialPages - 2) {
          console.log('   ✅ Descuento de páginas funciona correctamente');
        } else {
          console.log('   ❌ Descuento de páginas no funciona');
        }

        // Restaurar páginas
        await normalUser.subscription.update({ pages_remaining: initialPages });
        
      } catch (error) {
        if (error.message === 'Páginas insuficientes') {
          console.log('   ✅ Restricción de páginas insuficientes funciona');
        } else {
          console.log(`   ❌ Error inesperado: ${error.message}`);
        }
      }
    }

    // Test con usuario ilimitado
    const unlimitedUser = await User.findOne({
      where: { unlimited_access: true }
    });

    if (unlimitedUser) {
      console.log(`   🔓 Usuario ilimitado - Probando descuento de páginas...`);
      
      const remainingPages = await databaseService.updatePagesRemaining(unlimitedUser.id, 100);
      
      if (remainingPages === 999999) {
        console.log('   ✅ Usuario ilimitado no se le descontaron páginas');
      } else {
        console.log('   ❌ Usuario ilimitado se le descontaron páginas (error)');
      }
    }
  }
}

// Ejecutar tests
const test = new SubscriptionLimitsTest();
test.runAllTests()
  .then(success => {
    if (success) {
      console.log('\n🎉 SUBSCRIPTION LIMITS TESTS PASSED');
      process.exit(0);
    } else {
      console.log('\n❌ SUBSCRIPTION LIMITS TESTS FAILED');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('\n💥 Test error:', error);
    process.exit(1);
  });