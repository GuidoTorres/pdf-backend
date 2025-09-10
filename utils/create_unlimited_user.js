#!/usr/bin/env node
/**
 * Script para crear o convertir un usuario a acceso ilimitado
 */

import database from './src/config/database.js';
import { User, Subscription } from './src/models/index.js';

async function createUnlimitedUser() {
  try {
    await database.sync();
    console.log('🔍 Buscando usuario para convertir a ilimitado...\n');

    // Buscar el usuario actual (Guido Torres)
    const user = await User.findOne({
      where: { email: 'hectortorresdurand@gmail.com' },
      include: [{
        model: Subscription,
        as: 'subscription'
      }]
    });

    if (!user) {
      console.log('❌ Usuario no encontrado');
      console.log('📧 Email buscado: hectortorresdurand@gmail.com');
      
      // Mostrar usuarios disponibles
      const allUsers = await User.findAll({
        attributes: ['email', 'name']
      });
      
      console.log('\n👥 Usuarios disponibles:');
      allUsers.forEach(u => {
        console.log(`   - ${u.email} (${u.name})`);
      });
      
      return false;
    }

    console.log('👤 Usuario encontrado:');
    console.log(`   📧 Email: ${user.email}`);
    console.log(`   👨‍💼 Nombre: ${user.name}`);
    console.log(`   🆔 ID: ${user.id}`);
    console.log(`   🔓 Acceso ilimitado actual: ${user.unlimited_access ? 'SÍ' : 'NO'}`);
    
    if (user.subscription) {
      console.log(`   📋 Plan actual: ${user.subscription.plan}`);
      console.log(`   📄 Páginas restantes: ${user.subscription.pages_remaining}`);
    }

    if (user.unlimited_access) {
      console.log('\n✅ Este usuario ya tiene acceso ilimitado!');
      return true;
    }

    // Convertir a usuario ilimitado
    console.log('\n🔄 Convirtiendo a usuario con acceso ilimitado...');
    
    await user.update({
      unlimited_access: true
    });

    // Actualizar suscripción para mostrar plan unlimited
    if (user.subscription) {
      await user.subscription.update({
        plan: 'unlimited',
        pages_remaining: 999999
      });
    } else {
      // Crear suscripción ilimitada si no existe
      await Subscription.create({
        user_id: user.id,
        plan: 'unlimited',
        pages_remaining: 999999
      });
    }

    console.log('✅ Usuario convertido exitosamente!');
    console.log('\n🎉 Resumen:');
    console.log(`   👤 Usuario: ${user.name} (${user.email})`);
    console.log(`   🔓 Acceso: ILIMITADO`);
    console.log(`   📄 Páginas: ∞ (sin límites)`);
    console.log(`   📋 Plan: unlimited`);
    
    console.log('\n💡 Ahora este usuario puede:');
    console.log('   • Procesar PDFs sin límite de páginas');
    console.log('   • No se le descontarán páginas de su suscripción');
    console.log('   • Usar todas las funciones sin restricciones');

    return true;

  } catch (error) {
    console.error('❌ Error:', error.message);
    return false;
  } finally {
    await database.close();
  }
}

// Ejecutar el script
console.log('🚀 Creando usuario con acceso ilimitado...\n');

createUnlimitedUser()
  .then(success => {
    if (success) {
      console.log('\n🎉 PROCESO COMPLETADO EXITOSAMENTE');
      process.exit(0);
    } else {
      console.log('\n❌ PROCESO FALLÓ');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('\n💥 Error inesperado:', error);
    process.exit(1);
  });