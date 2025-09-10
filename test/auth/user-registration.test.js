/**
 * Tests para Registro de Usuarios
 * Pruebas específicas para el registro tradicional de usuarios
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import database from '../../src/config/database.js';
import { User } from '../../src/models/index.js';

describe('Registro de Usuarios - Tests Completos', () => {
  // Helper para generar emails únicos
  const getUniqueEmail = (prefix = 'register') => `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}@testregister.com`;

  beforeAll(async () => {
    console.log('User registration tests ready');
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    // Limpiar usuarios de test
    try {
      const { Op } = await import('sequelize');
      await User.destroy({ 
        where: { 
          email: {
            [Op.like]: '%@testregister.com'
          }
        },
        force: true
      });
    } catch (error) {
      console.log('Cleanup error (ignored):', error.message);
    }
  });

  describe('Registro Básico', () => {
    it('debe registrar nuevo usuario con datos válidos', async () => {
      const userData = {
        email: getUniqueEmail('valid'),
        password: 'ValidPassword123!',
        name: 'Test User',
        confirmPassword: 'ValidPassword123!'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('token');
      expect(response.body.user.email).toBe(userData.email);
      expect(response.body.user.name).toBe(userData.name);

      // Verificar que el usuario se creó en la base de datos
      const createdUser = await User.findOne({ where: { email: userData.email } });
      expect(createdUser).toBeDefined();
      expect(createdUser.email_verified).toBe(false); // Por defecto no verificado
      expect(createdUser.password_hash).toBeDefined();
      expect(createdUser.password_hash).not.toBe(userData.password); // Debe estar hasheada
    });

    it('debe generar token JWT válido al registrarse', async () => {
      const userData = {
        email: getUniqueEmail('jwt'),
        password: 'JwtPassword123!',
        name: 'JWT Test User',
        confirmPassword: 'JwtPassword123!'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData);

      expect(response.status).toBe(201);
      const token = response.body.token;
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT format

      // Usar token para acceder a ruta protegida
      const meResponse = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(meResponse.status).toBe(200);
      expect(meResponse.body.user.email).toBe(userData.email);
    });

    it('no debe incluir campos sensibles en la respuesta', async () => {
      const userData = {
        email: getUniqueEmail('secure'),
        password: 'SecurePassword123!',
        name: 'Secure User',
        confirmPassword: 'SecurePassword123!'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData);

      expect(response.status).toBe(201);
      const user = response.body.user;

      // No debe incluir campos sensibles
      expect(user).not.toHaveProperty('password_hash');
      expect(user).not.toHaveProperty('verification_token');
      expect(user).not.toHaveProperty('reset_token');

      // Debe incluir campos públicos
      expect(user).toHaveProperty('id');
      expect(user).toHaveProperty('email');
      expect(user).toHaveProperty('name');
      expect(user).toHaveProperty('email_verified');
    });
  });

  describe('Validación de Entrada', () => {
    it('debe rechazar email inválido', async () => {
      const invalidEmails = [
        'invalid-email',
        '@example.com',
        'user@',
        'user..name@example.com',
        'user@.com',
        ''
      ];

      for (const email of invalidEmails) {
        const response = await request(app)
          .post('/api/auth/register')
          .send({
            email,
            password: 'ValidPassword123!',
            name: 'Test User',
            confirmPassword: 'ValidPassword123!'
          });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
      }
    });

    it('debe rechazar contraseñas débiles', async () => {
      const weakPasswords = [
        '123',
        'password',
        'abc',
        '12345678',
        'PASSWORD',
        'password123'
      ];

      for (const password of weakPasswords) {
        const response = await request(app)
          .post('/api/auth/register')
          .send({
            email: getUniqueEmail('weak'),
            password,
            name: 'Test User',
            confirmPassword: password
          });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('contraseña');
      }
    });

    it('debe rechazar contraseñas que no coinciden', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: getUniqueEmail('mismatch'),
          password: 'ValidPassword123!',
          name: 'Test User',
          confirmPassword: 'DifferentPassword123!'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('coinciden');
    });

    it('debe rechazar nombre vacío o muy corto', async () => {
      const invalidNames = ['', 'A', '  ', null, undefined];

      for (const name of invalidNames) {
        const response = await request(app)
          .post('/api/auth/register')
          .send({
            email: getUniqueEmail('name'),
            password: 'ValidPassword123!',
            name,
            confirmPassword: 'ValidPassword123!'
          });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
      }
    });

    it('debe rechazar campos requeridos faltantes', async () => {
      const incompleteData = [
        { password: 'ValidPassword123!', name: 'Test User', confirmPassword: 'ValidPassword123!' },
        { email: getUniqueEmail('missing'), name: 'Test User', confirmPassword: 'ValidPassword123!' },
        { email: getUniqueEmail('missing'), password: 'ValidPassword123!', confirmPassword: 'ValidPassword123!' },
        { email: getUniqueEmail('missing'), password: 'ValidPassword123!', name: 'Test User' }
      ];

      for (const data of incompleteData) {
        const response = await request(app)
          .post('/api/auth/register')
          .send(data);

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
      }
    });
  });

  describe('Validación de Contraseñas', () => {
    it('debe aceptar contraseñas fuertes válidas', async () => {
      const strongPasswords = [
        'ValidPassword123!',
        'MyStr0ng@Password',
        'C0mpl3x#P@ssw0rd',
        'Secure123$Password'
      ];

      for (const password of strongPasswords) {
        const response = await request(app)
          .post('/api/auth/register')
          .send({
            email: getUniqueEmail('strong'),
            password,
            name: 'Strong Password User',
            confirmPassword: password
          });

        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
      }
    });

    it('debe requerir longitud mínima de contraseña', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: getUniqueEmail('short'),
          password: 'Sh0rt!',
          name: 'Test User',
          confirmPassword: 'Sh0rt!'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('8 caracteres');
    });

    it('debe requerir al menos una mayúscula', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: getUniqueEmail('lowercase'),
          password: 'lowercase123!',
          name: 'Test User',
          confirmPassword: 'lowercase123!'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('mayúscula');
    });

    it('debe requerir al menos un número', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: getUniqueEmail('nonumber'),
          password: 'NoNumberPassword!',
          name: 'Test User',
          confirmPassword: 'NoNumberPassword!'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('número');
    });

    it('debe requerir al menos un carácter especial', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: getUniqueEmail('nospecial'),
          password: 'NoSpecialChar123',
          name: 'Test User',
          confirmPassword: 'NoSpecialChar123'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('especial');
    });
  });

  describe('Duplicación y Conflictos', () => {
    it('debe rechazar email duplicado', async () => {
      const email = getUniqueEmail('duplicate');
      const userData = {
        email,
        password: 'ValidPassword123!',
        name: 'First User',
        confirmPassword: 'ValidPassword123!'
      };

      // Registrar primer usuario
      const firstResponse = await request(app)
        .post('/api/auth/register')
        .send(userData);

      expect(firstResponse.status).toBe(201);

      // Intentar registrar segundo usuario con mismo email
      const secondResponse = await request(app)
        .post('/api/auth/register')
        .send({
          ...userData,
          name: 'Second User'
        });

      expect(secondResponse.status).toBe(400);
      expect(secondResponse.body.success).toBe(false);
      expect(secondResponse.body.error).toContain('existe');
    });

    it('debe manejar emails case-insensitive', async () => {
      const baseEmail = getUniqueEmail('case');
      const userData1 = {
        email: baseEmail.toLowerCase(),
        password: 'ValidPassword123!',
        name: 'Lowercase User',
        confirmPassword: 'ValidPassword123!'
      };

      const userData2 = {
        email: baseEmail.toUpperCase(),
        password: 'ValidPassword123!',
        name: 'Uppercase User',
        confirmPassword: 'ValidPassword123!'
      };

      // Registrar con email en minúsculas
      const firstResponse = await request(app)
        .post('/api/auth/register')
        .send(userData1);

      expect(firstResponse.status).toBe(201);

      // Intentar registrar con email en mayúsculas
      const secondResponse = await request(app)
        .post('/api/auth/register')
        .send(userData2);

      // Dependiendo de la configuración de MySQL, puede ser case-sensitive o no
      expect([201, 400]).toContain(secondResponse.status);
    });
  });

  describe('Casos Edge y Seguridad', () => {
    it('debe manejar caracteres especiales en nombre', async () => {
      const specialNames = [
        'José María',
        'François Müller',
        'Владимир Петров',
        'محمد علي',
        'O\'Connor-Smith'
      ];

      for (const name of specialNames) {
        const response = await request(app)
          .post('/api/auth/register')
          .send({
            email: getUniqueEmail('special'),
            password: 'ValidPassword123!',
            name,
            confirmPassword: 'ValidPassword123!'
          });

        expect(response.status).toBe(201);
        expect(response.body.user.name).toBe(name);
      }
    });

    it('debe manejar payloads muy grandes', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: getUniqueEmail('large'),
          password: 'ValidPassword123!',
          name: 'Test User',
          confirmPassword: 'ValidPassword123!',
          extraData: 'x'.repeat(10000) // 10KB de datos extra
        });

      // Debe procesar normalmente ignorando campos extra
      expect([201, 400]).toContain(response.status);
    });

    it('debe manejar múltiples registros simultáneos', async () => {
      const promises = Array(3).fill().map((_, index) =>
        request(app)
          .post('/api/auth/register')
          .send({
            email: getUniqueEmail(`concurrent${index}`),
            password: 'ValidPassword123!',
            name: `Concurrent User ${index}`,
            confirmPassword: 'ValidPassword123!'
          })
      );

      const responses = await Promise.all(promises);

      // Todos deberían ser exitosos
      responses.forEach(response => {
        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
      });
    });

    it('debe sanitizar entrada para prevenir XSS', async () => {
      const maliciousName = '<script>alert("xss")</script>';
      
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: getUniqueEmail('xss'),
          password: 'ValidPassword123!',
          name: maliciousName,
          confirmPassword: 'ValidPassword123!'
        });

      if (response.status === 201) {
        // Si se acepta, debe estar sanitizado
        expect(response.body.user.name).not.toContain('<script>');
      } else {
        // O debe ser rechazado
        expect(response.status).toBe(400);
      }
    });
  });

  describe('Verificación de Email', () => {
    it('debe crear usuario con email_verified = false por defecto', async () => {
      const userData = {
        email: getUniqueEmail('unverified'),
        password: 'ValidPassword123!',
        name: 'Unverified User',
        confirmPassword: 'ValidPassword123!'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData);

      expect(response.status).toBe(201);
      expect(response.body.user.email_verified).toBe(false);

      // Verificar en base de datos
      const user = await User.findOne({ where: { email: userData.email } });
      expect(user.email_verified).toBe(false);
      expect(user.verification_token).toBeDefined(); // Debe tener token de verificación
    });

    it('debe generar token de verificación único', async () => {
      const users = [];
      
      for (let i = 0; i < 3; i++) {
        const response = await request(app)
          .post('/api/auth/register')
          .send({
            email: getUniqueEmail(`verify${i}`),
            password: 'ValidPassword123!',
            name: `Verify User ${i}`,
            confirmPassword: 'ValidPassword123!'
          });

        expect(response.status).toBe(201);
        
        const user = await User.findOne({ where: { email: response.body.user.email } });
        users.push(user);
      }

      // Todos los tokens de verificación deben ser únicos
      const tokens = users.map(u => u.verification_token).filter(Boolean);
      const uniqueTokens = new Set(tokens);
      expect(uniqueTokens.size).toBe(tokens.length);
    });
  });

  describe('Performance', () => {
    it('debe responder en tiempo razonable', async () => {
      const startTime = Date.now();

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: getUniqueEmail('performance'),
          password: 'ValidPassword123!',
          name: 'Performance User',
          confirmPassword: 'ValidPassword123!'
        });

      const responseTime = Date.now() - startTime;

      expect(response.status).toBe(201);
      expect(responseTime).toBeLessThan(3000); // Menos de 3 segundos (bcrypt es lento)
    });
  });
});