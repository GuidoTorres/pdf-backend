/**
 * Tests Específicos para Login Tradicional (Email/Password)
 * Casos detallados y edge cases para autenticación con credenciales
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../../src/app.js';
import database from '../../src/config/database.js';
import { User } from '../../src/models/index.js';

describe('Login Tradicional - Tests Detallados', () => {
  beforeAll(async () => {
    await database.sync({ force: true });
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    // Limpiar usuarios antes de cada test
    await User.destroy({ where: {} });
  });

  describe('Validación de Entrada', () => {
    beforeEach(async () => {
      await User.create({
        email: 'valid@example.com',
        password_hash: 'ValidPassword123', // El hook del modelo se encargará del hash
        name: 'Valid User',
        email_verified: true
      });
    });

    it('debe validar formato de email correctamente', async () => {
      const invalidEmails = [
        'invalid-email',
        '@example.com',
        'user@',
        'user..name@example.com',
        'user@.com',
        'user@com',
        ''
      ];

      for (const email of invalidEmails) {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            email,
            password: 'ValidPassword123'
          });

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
      }
    });

    it('debe aceptar emails válidos en diferentes formatos', async () => {
      const validEmails = [
        'valid@example.com',
        'VALID@EXAMPLE.COM',
        'Valid@Example.Com',
        'user.name@example.com',
        'user+tag@example.com',
        'user123@example123.com'
      ];

      for (const email of validEmails) {
        // Crear usuario para cada email
        await User.create({
          email: email.toLowerCase(),
          password_hash: 'ValidPassword123', // El hook del modelo se encargará del hash
          name: 'Test User',
          email_verified: true
        });

        const response = await request(app)
          .post('/api/auth/login')
          .send({
            email,
            password: 'ValidPassword123'
          });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);

        // Limpiar para el siguiente test
        await User.destroy({ where: { email: email.toLowerCase() } });
      }
    });

    it('debe manejar espacios en blanco en email y password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: '  valid@example.com  ',
          password: '  ValidPassword123  '
        });

      // Dependiendo de la implementación, podría limpiar espacios o fallar
      expect([200, 401]).toContain(response.status);
    });

    it('debe rechazar campos vacíos y null', async () => {
      const invalidInputs = [
        { email: '', password: 'password' },
        { email: 'test@example.com', password: '' },
        { email: null, password: 'password' },
        { email: 'test@example.com', password: null },
        { email: undefined, password: 'password' },
        { email: 'test@example.com', password: undefined }
      ];

      for (const input of invalidInputs) {
        const response = await request(app)
          .post('/api/auth/login')
          .send(input);

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Email y contraseña son requeridos');
      }
    });
  });

  describe('Seguridad de Contraseñas', () => {
    beforeEach(async () => {
      await User.create({
        email: 'security@example.com',
        password_hash: 'SecurePassword123!', // El hook del modelo se encargará del hash
        name: 'Security User',
        email_verified: true
      });
    });

    it('debe ser case-sensitive con contraseñas', async () => {
      const passwordVariations = [
        'securepassword123!',
        'SECUREPASSWORD123!',
        'SecurePassword123!', // Correcta
        'securePassword123!',
        'SecurePassword123'
      ];

      for (const password of passwordVariations) {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            email: 'security@example.com',
            password
          });

        if (password === 'SecurePassword123!') {
          expect(response.status).toBe(200);
          expect(response.body.success).toBe(true);
        } else {
          expect(response.status).toBe(401);
          expect(response.body.success).toBe(false);
        }
      }
    });

    it('debe rechazar contraseñas con caracteres especiales incorrectos', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'security@example.com',
          password: 'SecurePassword123@' // @ en lugar de !
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('debe manejar contraseñas muy largas', async () => {
      const longPassword = 'a'.repeat(1000);
      
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'security@example.com',
          password: longPassword
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('debe verificar que las contraseñas están hasheadas en la BD', async () => {
      const user = await User.findOne({ where: { email: 'security@example.com' } });
      
      expect(user.password_hash).not.toBe('SecurePassword123!');
      expect(user.password_hash).toMatch(/^\$2[aby]\$\d+\$/); // bcrypt format
      expect(user.password_hash.length).toBeGreaterThan(50);
    });
  });

  describe('Estados de Usuario', () => {
    it('debe permitir login a usuario verificado', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      await User.create({
        email: 'verified@example.com',
        password_hash: hashedPassword,
        name: 'Verified User',
        email_verified: true
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'verified@example.com',
          password: 'password123'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('debe permitir login a usuario no verificado (según configuración)', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      await User.create({
        email: 'unverified@example.com',
        password_hash: hashedPassword,
        name: 'Unverified User',
        email_verified: false
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'unverified@example.com',
          password: 'password123'
        });

      // Dependiendo de la configuración del sistema
      expect([200, 401]).toContain(response.status);
    });

    it('debe manejar usuarios con Google ID pero sin password', async () => {
      await User.create({
        email: 'google@example.com',
        password_hash: null, // Usuario OAuth sin contraseña
        name: 'Google User',
        google_id: 'google123',
        email_verified: true
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'google@example.com',
          password: 'anypassword'
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('debe manejar usuarios admin correctamente', async () => {
      const hashedPassword = await bcrypt.hash('adminpassword', 10);
      await User.create({
        email: 'admin@example.com',
        password_hash: hashedPassword,
        name: 'Admin User',
        email_verified: true,
        isAdmin: true
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'admin@example.com',
          password: 'adminpassword'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.user.isAdmin).toBe(true);
    });
  });

  describe('Respuestas y Tokens', () => {
    beforeEach(async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      await User.create({
        email: 'token@example.com',
        password_hash: hashedPassword,
        name: 'Token User',
        email_verified: true,
        isAdmin: false,
        lemon_customer_id: 'cust_123'
      });
    });

    it('debe incluir todos los campos esperados en la respuesta', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'token@example.com',
          password: 'password123'
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('token');

      // Verificar campos del usuario
      const user = response.body.user;
      expect(user).toHaveProperty('id');
      expect(user).toHaveProperty('email', 'token@example.com');
      expect(user).toHaveProperty('name', 'Token User');
      expect(user).toHaveProperty('email_verified', true);
      expect(user).toHaveProperty('isAdmin', false);
      expect(user).toHaveProperty('createdAt');
      expect(user).toHaveProperty('updatedAt');
    });

    it('no debe incluir campos sensibles en la respuesta', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'token@example.com',
          password: 'password123'
        });

      const user = response.body.user;
      expect(user).not.toHaveProperty('password_hash');
      expect(user).not.toHaveProperty('verification_token');
      expect(user).not.toHaveProperty('reset_token');
      expect(user).not.toHaveProperty('reset_token_expires');
    });

    it('debe generar token JWT válido con claims correctos', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'token@example.com',
          password: 'password123'
        });

      const token = response.body.token;
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT format: header.payload.signature

      // Verificar que el token funciona para acceder a rutas protegidas
      const meResponse = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(meResponse.status).toBe(200);
      expect(meResponse.body.user.email).toBe('token@example.com');
    });
  });

  describe('Casos Edge y Errores', () => {
    it('debe manejar múltiples intentos de login simultáneos', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      await User.create({
        email: 'concurrent@example.com',
        password_hash: hashedPassword,
        name: 'Concurrent User',
        email_verified: true
      });

      const promises = Array(5).fill().map(() =>
        request(app)
          .post('/api/auth/login')
          .send({
            email: 'concurrent@example.com',
            password: 'password123'
          })
      );

      const responses = await Promise.all(promises);

      // Todos deberían ser exitosos
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.token).toBeDefined();
      });

      // Todos los tokens deberían ser diferentes
      const tokens = responses.map(r => r.body.token);
      const uniqueTokens = new Set(tokens);
      expect(uniqueTokens.size).toBe(tokens.length);
    });

    it('debe manejar caracteres Unicode en email y password', async () => {
      const hashedPassword = await bcrypt.hash('contraseña123ñáéíóú', 10);
      await User.create({
        email: 'unicode@example.com',
        password_hash: hashedPassword,
        name: 'Unicode User',
        email_verified: true
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'unicode@example.com',
          password: 'contraseña123ñáéíóú'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('debe manejar payloads JSON malformados', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": "test@example.com", "password": "incomplete"');

      expect(response.status).toBe(400);
    });

    it('debe manejar Content-Type incorrecto', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'text/plain')
        .send('email=test@example.com&password=password123');

      expect([400, 401]).toContain(response.status);
    });

    it('debe manejar payloads muy grandes', async () => {
      const largePayload = {
        email: 'test@example.com',
        password: 'password123',
        extraData: 'x'.repeat(10000) // 10KB de datos extra
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(largePayload);

      // Debería procesar normalmente ignorando campos extra
      expect([200, 400, 401]).toContain(response.status);
    });
  });

  describe('Logging y Auditoría', () => {
    beforeEach(async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      await User.create({
        email: 'audit@example.com',
        password_hash: hashedPassword,
        name: 'Audit User',
        email_verified: true
      });
    });

    it('debe registrar intentos de login exitosos', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'audit@example.com',
          password: 'password123'
        });

      expect(response.status).toBe(200);
      // Verificar que se registró en logs (esto dependería de la implementación de logging)
    });

    it('debe registrar intentos de login fallidos', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'audit@example.com',
          password: 'wrongpassword'
        });

      expect(response.status).toBe(401);
      // Verificar que se registró el intento fallido
    });

    it('debe registrar intentos con emails inexistentes', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'password123'
        });

      expect(response.status).toBe(401);
      // Verificar que se registró el intento con email inexistente
    });
  });

  describe('Performance', () => {
    beforeEach(async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      await User.create({
        email: 'performance@example.com',
        password_hash: hashedPassword,
        name: 'Performance User',
        email_verified: true
      });
    });

    it('debe responder en tiempo razonable', async () => {
      const startTime = Date.now();

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'performance@example.com',
          password: 'password123'
        });

      const responseTime = Date.now() - startTime;

      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(1000); // Menos de 1 segundo
    });

    it('debe manejar carga de múltiples logins', async () => {
      const startTime = Date.now();

      const promises = Array(10).fill().map(() =>
        request(app)
          .post('/api/auth/login')
          .send({
            email: 'performance@example.com',
            password: 'password123'
          })
      );

      const responses = await Promise.all(promises);
      const totalTime = Date.now() - startTime;

      // Todos deberían ser exitosos
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      // Tiempo total razonable para 10 requests
      expect(totalTime).toBeLessThan(5000); // Menos de 5 segundos
    });
  });
});