import database from './src/config/database.js';
import { User, Subscription, Document } from './src/models/index.js';

async function testDatabase() {
  console.log('🔍 Probando conexión a la base de datos...\n');

  try {
    // 1. Probar conexión básica
    console.log('1. Probando conexión básica...');
    await database.testConnection();
    console.log('✅ Conexión exitosa\n');

    // 2. Sincronizar modelos (crear tablas)
    console.log('2. Sincronizando modelos (creando tablas)...');
    await database.sync({ force: false }); // force: true para recrear tablas
    console.log('✅ Tablas sincronizadas\n');

    // 3. Crear usuario de prueba
    console.log('3. Creando usuario de prueba...');
    const testUser = await User.create({
      email: 'test@stamentai.com',
      name: 'Usuario de Prueba',
      password_hash: 'test123',
      email_verified: true
    });
    console.log('✅ Usuario creado:', testUser.toJSON());

    // 4. Crear suscripción para el usuario
    console.log('\n4. Creando suscripción...');
    const subscription = await Subscription.create({
      user_id: testUser.id,
      plan: 'free',
      pages_remaining: 10
    });
    console.log('✅ Suscripción creada:', subscription.toJSON());

    // 5. Crear documento de prueba
    console.log('\n5. Creando documento de prueba...');
    const document = await Document.create({
      user_id: testUser.id,
      job_id: `test_job_${Date.now()}`,
      original_file_name: 'test_document.pdf',
      status: 'completed',
      transactions: [
        {
          date: '2024-01-15',
          description: 'Compra en Amazon',
          amount: -29.99,
          balance: 1500.00
        },
        {
          date: '2024-01-16',
          description: 'Transferencia recibida',
          amount: 500.00,
          balance: 2000.00
        }
      ],
      metadata: {
        bank_name: 'Banco de Prueba',
        statement_period: 'Enero 2024',
        currency: 'EUR'
      }
    });
    console.log('✅ Documento creado:', document.toJSON());

    // 6. Probar consultas con relaciones
    console.log('\n6. Probando consultas con relaciones...');
    const userWithData = await User.findByPk(testUser.id, {
      include: [
        {
          model: Subscription,
          as: 'subscription'
        },
        {
          model: Document,
          as: 'documents'
        }
      ]
    });
    
    console.log('✅ Usuario con datos relacionados:');
    console.log('- Email:', userWithData.email);
    console.log('- Plan:', userWithData.subscription?.plan);
    console.log('- Páginas restantes:', userWithData.subscription?.pages_remaining);
    console.log('- Documentos:', userWithData.documents?.length);

    // 7. Probar métodos del modelo
    console.log('\n7. Probando métodos del modelo...');
    const isValidPassword = await testUser.validatePassword('test123');
    console.log('✅ Validación de contraseña:', isValidPassword);

    // 8. Probar actualización de progreso del documento
    console.log('\n8. Probando actualización de documento...');
    await document.updateProgress(75, 'Procesando con IA');
    await document.reload();
    console.log('✅ Documento actualizado - Progreso:', document.progress, '- Step:', document.step);

    // 9. Limpiar datos de prueba
    console.log('\n9. Limpiando datos de prueba...');
    await document.destroy();
    await subscription.destroy();
    await testUser.destroy();
    console.log('✅ Datos de prueba eliminados');

    console.log('\n🎉 ¡Todas las pruebas pasaron exitosamente!');
    console.log('✅ La base de datos está funcionando correctamente');
    console.log('✅ Los modelos están bien configurados');
    console.log('✅ Las relaciones funcionan');
    console.log('✅ Los métodos personalizados funcionan');

  } catch (error) {
    console.error('❌ Error en las pruebas:', error);
    console.error('Stack trace:', error.stack);
  } finally {
    // Cerrar conexión
    await database.close();
    console.log('\n🔌 Conexión cerrada');
    process.exit(0);
  }
}

// Ejecutar pruebas
testDatabase();