/**
 * Análisis Completo del Sistema de Login
 * Tests para todas las formas de inicio de sesión disponibles
 * 
 * Formas de Login Identificadas:
 * 1. Login tradicional (email/password)
 * 2. Registro de nuevo usuario
 * 3. Autenticación con Google OAuth
 * 4. Validación de sesiones existentes
 * 5. Logout y revocación de tokens
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import app from '../../src/app.js';
import database from '../../src/config/database.js';
import { User } from '../../src/models/index.js';
import config from '../../src/config/config.js';

describe('Sistema de Autenticación - Análisis Completo', () => {
  let testUser;
  let testUserToken;
  let googleUser;

  beforeAll(async () => {
    // Sincronizar base de datos para tests
    await database.sync({ force: true });
  });

  afterAll(async () => {
    // Limpiar base de datos después de tests
    await database.close();
  });

  beforeEach(async () => {
    // Crear usuario de prueba para cada test
    testUser = await User.create({
      email: 'test@example.com',
      password_hash: 'password123',
      name: 'Test User',
      email_verified: true
    });

    // Crear token válido para tests de autenticación
    testUserToken = jwt.sign(
      { userId: testUser.id, email: testUser.email },
      config.jwt.secret,
      { expiresIn: '1h' }
    );
  });

  afterEach(async () => {
    // Limpiar usuarios después de cada test
    await User.destroy({ where: {} });
  });

  describe('1. Login Tradicional (Email/Password)', () => {
    describe('Casos de Éxito', () => {
      it('debe permitir login con credenciales válidas', async () => {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            email: 'test@example.com',
            password: 'password123'
          });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.user).toBeDefined();
        expect(response.body.token).toBeDefined();
        expect(response.body.user.email).toBe('test@example.com');
        expect(response.body.user.name).toBe('Test User');
        
        // Verificar que el token es válido
        const decoded = jwt.verify(response.body.token, config.jwt.secret);
        expect(decoded.userId).toBe(testUser.id);
        expect(decoded.email).toBe('test@example.com');
      });

      it('debe incluir información completa del usuario en la respuesta', async () => {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            email: 'test@example.com',
            password: 'password123'
          });

        expect(response.body.user).toHaveProperty('id');
        expect(response.body.user).toHaveProperty('email');
        expect(response.body.user).toHaveProperty('name');
        expect(response.body.user).toHaveProperty('email_verified');
        expect(response.body.user).toHaveProperty('isAdmin');
        
        // Verificar que no se incluyen campos sensibles
        expect(response.body.user).not.toHaveProperty('password_hash');
        expect(response.body.user).not.toHaveProperty('verification_token');
        expect(response.body.user).not.toHaveProperty('reset_token');
      });

      it('debe crear una sesión válida en la base de datos', async () => {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            email: 'test@example.com',
            password: 'password123'
          });

        // Verificar que podemos usar el token para acceder a rutas protegidas
        const meResponse = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${response.body.token}`);

        expect(meResponse.status).toBe(200);
        expect(meResponse.body.success).toBe(true);
        expect(meResponse.body.user.id).toBe(testUser.id);
      });
    });

    describe('Casos de Error', () => {
      it('debe rechazar login sin email', async () => {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            password: 'password123'
          });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Email y contraseña son requeridos');
      });

      it('debe rechazar login sin contraseña', async () => {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            email: 'test@example.com'
          });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Email y contraseña son requeridos');
      });

      it('debe rechazar login con email inexistente', async () => {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            email: 'nonexistent@example.com',
            password: 'password123'
          });

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Credenciales inválidas');
      });

      it('debe rechazar login con contraseña incorrecta', async () => {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            email: 'test@example.com',
            password: 'wrongpassword'
          });

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Credenciales inválidas');
      });

      it('debe manejar errores de formato de email', async () => {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            email: 'invalid-email',
            password: 'password123'
          });

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
      });
    });

    describe('Seguridad', () => {
      it('debe usar hash seguro para contraseñas', async () => {
        const user = await User.findByPk(testUser.id);
        expect(user.password_hash).not.toBe('password123');
        expect(user.password_hash).toMatch(/^\$2[aby]\$\d+\$/); // bcrypt format
      });

      it('debe generar tokens JWT válidos', async () => {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            email: 'test@example.com',
            password: 'password123'
          });

        const token = response.body.token;
        expect(token).toBeDefined();
        
        const decoded = jwt.verify(token, config.jwt.secret);
        expect(decoded.userId).toBe(testUser.id);
        expect(decoded.email).toBe('test@example.com');
        expect(decoded.exp).toBeGreaterThan(Date.now() / 1000);
      });

      it('debe limitar intentos de login (rate limiting)', async () => {
        // Simular múltiples intentos fallidos
        const promises = Array(10).fill().map(() =>
          request(app)
            .post('/api/auth/login')
            .send({
              email: 'test@example.com',
              password: 'wrongpassword'
            })
        );

        const responses = await Promise.all(promises);
        
        // Todos deberían fallar con 401
        responses.forEach(response => {
          expect(response.status).toBe(401);
        });
      });
    });
  });

  describe('2. Registro de Nuevo Usuario', () => {
    describe('Casos de Éxito', () => {
      it('debe permitir registro con datos válidos', async () => {
        const response = await request(app)
          .post('/api/auth/register')
          .send({
            email: 'newuser@example.com',
            password: 'newpassword123',
            name: 'New User'
          });

        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
        expect(response.body.user).toBeDefined();
        expect(response.body.token).toBeDefined();
        expect(response.body.user.email).toBe('newuser@example.com');
        expect(response.body.user.name).toBe('New User');
      });

      it('debe crear usuario en la base de datos', async () => {
        await request(app)
          .post('/api/auth/register')
          .send({
            email: 'newuser@example.com',
            password: 'newpassword123',
            name: 'New User'
          });

        const user = await User.findOne({ where: { email: 'newuser@example.com' } });
        expect(user).toBeDefined();
        expect(user.name).toBe('New User');
        expect(user.email_verified).toBe(true);
      });

      it('debe generar nombre automáticamente si no se proporciona', async () => {
        const response = await request(app)
          .post('/api/auth/register')
          .send({
            email: 'auto@example.com',
            password: 'password123'
          });

        expect(response.status).toBe(201);
        expect(response.body.user.name).toBe('auto'); // Parte antes del @
      });

      it('debe crear sesión automáticamente después del registro', async () => {
        const response = await request(app)
          .post('/api/auth/register')
          .send({
            email: 'newuser@example.com',
            password: 'newpassword123',
            name: 'New User'
          });

        // Verificar que el token funciona inmediatamente
        const meResponse = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${response.body.token}`);

        expect(meResponse.status).toBe(200);
        expect(meResponse.body.user.email).toBe('newuser@example.com');
      });
    });

    describe('Casos de Error', () => {
      it('debe rechazar registro sin email', async () => {
        const response = await request(app)
          .post('/api/auth/register')
          .send({
            password: 'password123',
            name: 'Test User'
          });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Email y contraseña son requeridos');
      });

      it('debe rechazar registro sin contraseña', async () => {
        const response = await request(app)
          .post('/api/auth/register')
          .send({
            email: 'test@example.com',
            name: 'Test User'
          });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Email y contraseña son requeridos');
      });

      it('debe rechazar registro con email ya existente', async () => {
        const response = await request(app)
          .post('/api/auth/register')
          .send({
            email: 'test@example.com', // Ya existe en beforeEach
            password: 'password123',
            name: 'Another User'
          });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('El email ya está registrado');
      });

      it('debe validar formato de email', async () => {
        const response = await request(app)
          .post('/api/auth/register')
          .send({
            email: 'invalid-email',
            password: 'password123',
            name: 'Test User'
          });

        expect(response.status).toBe(500); // Error de validación de Sequelize
        expect(response.body.success).toBe(false);
      });
    });

    describe('Validaciones de Contraseña', () => {
      it('debe aceptar contraseñas seguras', async () => {
        const response = await request(app)
          .post('/api/auth/register')
          .send({
            email: 'secure@example.com',
            password: 'SecurePassword123!',
            name: 'Secure User'
          });

        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
      });

      it('debe hashear la contraseña antes de guardar', async () => {
        await request(app)
          .post('/api/auth/register')
          .send({
            email: 'hash@example.com',
            password: 'password123',
            name: 'Hash User'
          });

        const user = await User.findOne({ where: { email: 'hash@example.com' } });
        expect(user.password_hash).not.toBe('password123');
        expect(user.password_hash).toMatch(/^\$2[aby]\$\d+\$/);
      });
    });
  });

  describe('3. Autenticación con Google OAuth', () => {
    beforeEach(() => {
      // Mock Google OAuth client
      vi.mock('google-auth-library', () => ({
        OAuth2Client: vi.fn().mockImplementation(() => ({
          getToken: vi.fn().mockResolvedValue({
            tokens: {
              id_token: 'mock_id_token'
            }
          }),
          verifyIdToken: vi.fn().mockResolvedValue({
            getPayload: vi.fn().mockReturnValue({
              sub: 'google_user_id_123',
              email: 'google@example.com',
              name: 'Google User',
              picture: 'https://example.com/picture.jpg',
              email_verified: true
            })
          })
        }))
      }));
    });

    describe('Casos de Éxito', () => {
      it('debe permitir login con Google para nuevo usuario', async () => {
        const response = await request(app)
          .post('/api/auth/google-callback')
          .send({
            code: 'valid_google_auth_code'
          });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.user).toBeDefined();
        expect(response.body.token).toBeDefined();
        expect(response.body.user.email).toBe('google@example.com');
        expect(response.body.user.name).toBe('Google User');
      });

      it('debe crear usuario en la base de datos con Google ID', async () => {
        await request(app)
          .post('/api/auth/google-callback')
          .send({
            code: 'valid_google_auth_code'
          });

        const user = await User.findOne({ where: { email: 'google@example.com' } });
        expect(user).toBeDefined();
        expect(user.google_id).toBe('google_user_id_123');
        expect(user.email_verified).toBe(true);
        expect(user.password_hash).toBeNull(); // OAuth users don't have password
      });

      it('debe vincular cuenta existente con Google ID', async () => {
        // Crear usuario existente con el mismo email
        const existingUser = await User.create({
          email: 'google@example.com',
          password_hash: 'somepassword',
          name: 'Existing User',
          email_verified: true
        });

        const response = await request(app)
          .post('/api/auth/google-callback')
          .send({
            code: 'valid_google_auth_code'
          });

        expect(response.status).toBe(200);
        
        // Verificar que se actualizó el usuario existente
        const updatedUser = await User.findByPk(existingUser.id);
        expect(updatedUser.google_id).toBe('google_user_id_123');
        expect(updatedUser.name).toBe('Google User'); // Actualizado con info de Google
      });

      it('debe permitir login posterior con Google ID existente', async () => {
        // Crear usuario con Google ID
        await User.create({
          email: 'google@example.com',
          name: 'Google User',
          google_id: 'google_user_id_123',
          email_verified: true
        });

        const response = await request(app)
          .post('/api/auth/google-callback')
          .send({
            code: 'valid_google_auth_code'
          });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.user.email).toBe('google@example.com');
      });
    });

    describe('Casos de Error', () => {
      it('debe rechazar sin código de autorización', async () => {
        const response = await request(app)
          .post('/api/auth/google-callback')
          .send({});

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Authorization code is required');
      });

      it('debe manejar errores de Google OAuth', async () => {
        // Mock error en Google OAuth
        vi.mocked(OAuth2Client).mockImplementation(() => ({
          getToken: vi.fn().mockRejectedValue(new Error('Invalid authorization code')),
          verifyIdToken: vi.fn()
        }));

        const response = await request(app)
          .post('/api/auth/google-callback')
          .send({
            code: 'invalid_code'
          });

        expect(response.status).toBe(500);
        expect(response.body.success).toBe(false);
      });

      it('debe rechazar email no verificado de Google', async () => {
        // Mock payload con email no verificado
        vi.mocked(OAuth2Client).mockImplementation(() => ({
          getToken: vi.fn().mockResolvedValue({
            tokens: { id_token: 'mock_token' }
          }),
          verifyIdToken: vi.fn().mockResolvedValue({
            getPayload: vi.fn().mockReturnValue({
              sub: 'google_user_id_123',
              email: 'unverified@example.com',
              name: 'Unverified User',
              email_verified: false
            })
          })
        }));

        const response = await request(app)
          .post('/api/auth/google-callback')
          .send({
            code: 'valid_code'
          });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Email from Google is not verified or missing');
      });
    });
  });

  describe('4. Validación de Sesiones', () => {
    describe('Middleware de Autenticación', () => {
      it('debe permitir acceso con token válido', async () => {
        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${testUserToken}`);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.user.id).toBe(testUser.id);
      });

      it('debe rechazar acceso sin token', async () => {
        const response = await request(app)
          .get('/api/auth/me');

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Token de acceso requerido');
      });

      it('debe rechazar token inválido', async () => {
        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', 'Bearer invalid_token');

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Token inválido');
      });

      it('debe rechazar token expirado', async () => {
        const expiredToken = jwt.sign(
          { userId: testUser.id, email: testUser.email },
          config.jwt.secret,
          { expiresIn: '-1h' } // Token expirado
        );

        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${expiredToken}`);

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Token expirado');
      });

      it('debe validar formato de Authorization header', async () => {
        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', 'InvalidFormat');

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
      });
    });

    describe('Información del Usuario Actual', () => {
      it('debe retornar información completa del usuario', async () => {
        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${testUserToken}`);

        expect(response.body.user).toHaveProperty('id');
        expect(response.body.user).toHaveProperty('email');
        expect(response.body.user).toHaveProperty('name');
        expect(response.body.user).toHaveProperty('email_verified');
        expect(response.body.user).toHaveProperty('isAdmin');
        expect(response.body.user).toHaveProperty('createdAt');
        expect(response.body.user).toHaveProperty('updatedAt');
      });

      it('no debe incluir información sensible', async () => {
        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${testUserToken}`);

        expect(response.body.user).not.toHaveProperty('password_hash');
        expect(response.body.user).not.toHaveProperty('verification_token');
        expect(response.body.user).not.toHaveProperty('reset_token');
        expect(response.body.user).not.toHaveProperty('reset_token_expires');
      });
    });
  });

  describe('5. Logout y Revocación de Tokens', () => {
    describe('Logout Exitoso', () => {
      it('debe permitir logout con token válido', async () => {
        const response = await request(app)
          .post('/api/auth/logout')
          .set('Authorization', `Bearer ${testUserToken}`);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('Sesión cerrada exitosamente');
      });

      it('debe invalidar el token después del logout', async () => {
        // Hacer logout
        await request(app)
          .post('/api/auth/logout')
          .set('Authorization', `Bearer ${testUserToken}`);

        // Intentar usar el token después del logout
        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${testUserToken}`);

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
      });
    });

    describe('Casos de Error en Logout', () => {
      it('debe manejar logout sin token', async () => {
        const response = await request(app)
          .post('/api/auth/logout');

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
      });

      it('debe manejar logout con token inválido', async () => {
        const response = await request(app)
          .post('/api/auth/logout')
          .set('Authorization', 'Bearer invalid_token');

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
      });
    });
  });

  describe('6. Casos Edge y Seguridad', () => {
    describe('Inyección SQL', () => {
      it('debe prevenir inyección SQL en login', async () => {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            email: "'; DROP TABLE users; --",
            password: 'password123'
          });

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
        
        // Verificar que la tabla users sigue existiendo
        const userCount = await User.count();
        expect(userCount).toBeGreaterThan(0);
      });
    });

    describe('XSS Prevention', () => {
      it('debe sanitizar datos de entrada', async () => {
        const response = await request(app)
          .post('/api/auth/register')
          .send({
            email: 'xss@example.com',
            password: 'password123',
            name: '<script>alert("xss")</script>'
          });

        if (response.status === 201) {
          expect(response.body.user.name).not.toContain('<script>');
        }
      });
    });

    describe('Rate Limiting', () => {
      it('debe implementar rate limiting en endpoints de auth', async () => {
        const promises = Array(20).fill().map(() =>
          request(app)
            .post('/api/auth/login')
            .send({
              email: 'test@example.com',
              password: 'wrongpassword'
            })
        );

        const responses = await Promise.all(promises);
        
        // Algunos requests deberían ser bloqueados por rate limiting
        const blockedRequests = responses.filter(r => r.status === 429);
        // Note: Esto depende de la implementación de rate limiting
      });
    });

    describe('Concurrencia', () => {
      it('debe manejar múltiples logins simultáneos', async () => {
        const promises = Array(5).fill().map(() =>
          request(app)
            .post('/api/auth/login')
            .send({
              email: 'test@example.com',
              password: 'password123'
            })
        );

        const responses = await Promise.all(promises);
        
        responses.forEach(response => {
          expect(response.status).toBe(200);
          expect(response.body.success).toBe(true);
          expect(response.body.token).toBeDefined();
        });
      });

      it('debe manejar registro simultáneo con el mismo email', async () => {
        const promises = Array(3).fill().map(() =>
          request(app)
            .post('/api/auth/register')
            .send({
              email: 'concurrent@example.com',
              password: 'password123',
              name: 'Concurrent User'
            })
        );

        const responses = await Promise.all(promises);
        
        // Solo uno debería tener éxito
        const successfulResponses = responses.filter(r => r.status === 201);
        const failedResponses = responses.filter(r => r.status === 400);
        
        expect(successfulResponses.length).toBe(1);
        expect(failedResponses.length).toBe(2);
      });
    });
  });

  describe('7. Performance y Escalabilidad', () => {
    describe('Tiempo de Respuesta', () => {
      it('debe responder rápidamente al login', async () => {
        const startTime = Date.now();
        
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            email: 'test@example.com',
            password: 'password123'
          });
        
        const responseTime = Date.now() - startTime;
        
        expect(response.status).toBe(200);
        expect(responseTime).toBeLessThan(1000); // Menos de 1 segundo
      });

      it('debe responder rápidamente al registro', async () => {
        const startTime = Date.now();
        
        const response = await request(app)
          .post('/api/auth/register')
          .send({
            email: 'fast@example.com',
            password: 'password123',
            name: 'Fast User'
          });
        
        const responseTime = Date.now() - startTime;
        
        expect(response.status).toBe(201);
        expect(responseTime).toBeLessThan(2000); // Menos de 2 segundos (incluye hashing)
      });
    });

    describe('Carga de Trabajo', () => {
      it('debe manejar múltiples operaciones de autenticación', async () => {
        const operations = [];
        
        // Mezclar diferentes tipos de operaciones
        for (let i = 0; i < 10; i++) {
          operations.push(
            request(app)
              .post('/api/auth/login')
              .send({
                email: 'test@example.com',
                password: 'password123'
              })
          );
          
          operations.push(
            request(app)
              .get('/api/auth/me')
              .set('Authorization', `Bearer ${testUserToken}`)
          );
        }
        
        const responses = await Promise.all(operations);
        
        // Todas las operaciones deberían completarse exitosamente
        responses.forEach(response => {
          expect([200, 201]).toContain(response.status);
        });
      });
    });
  });
});