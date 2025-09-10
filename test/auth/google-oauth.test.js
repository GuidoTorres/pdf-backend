/**
 * Tests para Google OAuth Authentication
 * Pruebas específicas para autenticación con Google
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import database from '../../src/config/database.js';
import { User } from '../../src/models/index.js';

// Mock de Google OAuth2Client
vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({
    verifyIdToken: vi.fn()
  }))
}));

describe('Google OAuth - Tests de Autenticación', () => {
  // Helper para generar emails únicos
  const getUniqueEmail = (prefix = 'google') => `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}@gmail.com`;

  beforeAll(async () => {
    console.log('Google OAuth tests ready');
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
            [Op.like]: '%@gmail.com'
          }
        },
        force: true
      });
    } catch (error) {
      console.log('Cleanup error (ignored):', error.message);
    }
  });

  describe('Google OAuth Login', () => {
    it('debe crear nuevo usuario con Google OAuth exitoso', async () => {
      const mockGoogleUser = {
        email: getUniqueEmail('newuser'),
        name: 'New Google User',
        google_id: 'google_123456',
        email_verified: true
      };

      // Mock de la verificación de Google
      const { OAuth2Client } = await import('google-auth-library');
      const mockClient = new OAuth2Client();
      mockClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: mockGoogleUser.google_id,
          email: mockGoogleUser.email,
          name: mockGoogleUser.name,
          email_verified: true
        })
      });

      const response = await request(app)
        .post('/api/auth/google')
        .send({
          credential: 'mock_google_token'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('token');
      expect(response.body.user.email).toBe(mockGoogleUser.email);
      expect(response.body.user.name).toBe(mockGoogleUser.name);
      expect(response.body.user.google_id).toBe(mockGoogleUser.google_id);

      // Verificar que el usuario se creó en la base de datos
      const createdUser = await User.findOne({ where: { email: mockGoogleUser.email } });
      expect(createdUser).toBeDefined();
      expect(createdUser.google_id).toBe(mockGoogleUser.google_id);
      expect(createdUser.password_hash).toBeNull();
    });

    it('debe hacer login de usuario existente con Google', async () => {
      const existingEmail = getUniqueEmail('existing');
      const googleId = 'google_existing_123';

      // Crear usuario existente
      await User.create({
        email: existingEmail,
        name: 'Existing Google User',
        google_id: googleId,
        email_verified: true,
        password_hash: null
      });

      // Mock de la verificación de Google
      const { OAuth2Client } = await import('google-auth-library');
      const mockClient = new OAuth2Client();
      mockClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: googleId,
          email: existingEmail,
          name: 'Existing Google User',
          email_verified: true
        })
      });

      const response = await request(app)
        .post('/api/auth/google')
        .send({
          credential: 'mock_google_token'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.user.email).toBe(existingEmail);
      expect(response.body.user.google_id).toBe(googleId);
    });

    it('debe rechazar token de Google inválido', async () => {
      // Mock de verificación fallida
      const { OAuth2Client } = await import('google-auth-library');
      const mockClient = new OAuth2Client();
      mockClient.verifyIdToken.mockRejectedValue(new Error('Invalid token'));

      const response = await request(app)
        .post('/api/auth/google')
        .send({
          credential: 'invalid_google_token'
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Token de Google inválido');
    });

    it('debe manejar email no verificado en Google', async () => {
      const unverifiedEmail = getUniqueEmail('unverified');

      // Mock de Google con email no verificado
      const { OAuth2Client } = await import('google-auth-library');
      const mockClient = new OAuth2Client();
      mockClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: 'google_unverified_123',
          email: unverifiedEmail,
          name: 'Unverified User',
          email_verified: false
        })
      });

      const response = await request(app)
        .post('/api/auth/google')
        .send({
          credential: 'mock_google_token'
        });

      // Dependiendo de la configuración, puede aceptar o rechazar
      expect([200, 400]).toContain(response.status);
    });

    it('debe actualizar información de usuario existente', async () => {
      const userEmail = getUniqueEmail('update');
      const googleId = 'google_update_123';

      // Crear usuario con información antigua
      await User.create({
        email: userEmail,
        name: 'Old Name',
        google_id: googleId,
        email_verified: true,
        password_hash: null
      });

      // Mock de Google con información actualizada
      const { OAuth2Client } = await import('google-auth-library');
      const mockClient = new OAuth2Client();
      mockClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: googleId,
          email: userEmail,
          name: 'Updated Name',
          email_verified: true
        })
      });

      const response = await request(app)
        .post('/api/auth/google')
        .send({
          credential: 'mock_google_token'
        });

      expect(response.status).toBe(200);
      expect(response.body.user.name).toBe('Updated Name');

      // Verificar actualización en base de datos
      const updatedUser = await User.findOne({ where: { email: userEmail } });
      expect(updatedUser.name).toBe('Updated Name');
    });

    it('debe manejar conflicto de email con usuario tradicional', async () => {
      const conflictEmail = getUniqueEmail('conflict');

      // Crear usuario tradicional (con contraseña)
      await User.create({
        email: conflictEmail,
        name: 'Traditional User',
        password_hash: 'hashedpassword',
        email_verified: true,
        google_id: null
      });

      // Intentar login con Google usando el mismo email
      const { OAuth2Client } = await import('google-auth-library');
      const mockClient = new OAuth2Client();
      mockClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: 'google_conflict_123',
          email: conflictEmail,
          name: 'Google User',
          email_verified: true
        })
      });

      const response = await request(app)
        .post('/api/auth/google')
        .send({
          credential: 'mock_google_token'
        });

      // Debe manejar el conflicto apropiadamente
      expect([200, 400, 409]).toContain(response.status);
    });
  });

  describe('Google OAuth Token Validation', () => {
    it('debe rechazar credential vacío', async () => {
      const response = await request(app)
        .post('/api/auth/google')
        .send({
          credential: ''
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('debe rechazar request sin credential', async () => {
      const response = await request(app)
        .post('/api/auth/google')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('debe manejar payload de Google malformado', async () => {
      // Mock de Google con payload inválido
      const { OAuth2Client } = await import('google-auth-library');
      const mockClient = new OAuth2Client();
      mockClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          // Faltan campos requeridos
          sub: 'google_123'
          // email, name faltantes
        })
      });

      const response = await request(app)
        .post('/api/auth/google')
        .send({
          credential: 'mock_google_token'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Google OAuth Security', () => {
    it('debe generar token JWT válido para usuario de Google', async () => {
      const googleEmail = getUniqueEmail('jwt');
      const googleId = 'google_jwt_123';

      // Mock de Google
      const { OAuth2Client } = await import('google-auth-library');
      const mockClient = new OAuth2Client();
      mockClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: googleId,
          email: googleEmail,
          name: 'JWT Test User',
          email_verified: true
        })
      });

      const response = await request(app)
        .post('/api/auth/google')
        .send({
          credential: 'mock_google_token'
        });

      expect(response.status).toBe(200);
      const token = response.body.token;
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT format

      // Usar token para acceder a ruta protegida
      const meResponse = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(meResponse.status).toBe(200);
      expect(meResponse.body.user.email).toBe(googleEmail);
    });

    it('no debe incluir campos sensibles en respuesta de Google OAuth', async () => {
      const googleEmail = getUniqueEmail('secure');

      // Mock de Google
      const { OAuth2Client } = await import('google-auth-library');
      const mockClient = new OAuth2Client();
      mockClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: 'google_secure_123',
          email: googleEmail,
          name: 'Secure User',
          email_verified: true
        })
      });

      const response = await request(app)
        .post('/api/auth/google')
        .send({
          credential: 'mock_google_token'
        });

      expect(response.status).toBe(200);
      const user = response.body.user;

      // No debe incluir campos sensibles
      expect(user).not.toHaveProperty('password_hash');
      expect(user).not.toHaveProperty('verification_token');
      expect(user).not.toHaveProperty('reset_token');

      // Debe incluir campos públicos
      expect(user).toHaveProperty('id');
      expect(user).toHaveProperty('email');
      expect(user).toHaveProperty('name');
      expect(user).toHaveProperty('google_id');
    });
  });

  describe('Google OAuth Edge Cases', () => {
    it('debe manejar múltiples logins simultáneos de Google', async () => {
      const googleEmail = getUniqueEmail('concurrent');
      const googleId = 'google_concurrent_123';

      // Mock de Google
      const { OAuth2Client } = await import('google-auth-library');
      const mockClient = new OAuth2Client();
      mockClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: googleId,
          email: googleEmail,
          name: 'Concurrent User',
          email_verified: true
        })
      });

      const promises = Array(3).fill().map(() =>
        request(app)
          .post('/api/auth/google')
          .send({
            credential: 'mock_google_token'
          })
      );

      const responses = await Promise.all(promises);

      // Todos deberían ser exitosos
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });

      // Solo debe haber un usuario en la base de datos
      const users = await User.findAll({ where: { email: googleEmail } });
      expect(users).toHaveLength(1);
    });

    it('debe manejar caracteres especiales en nombre de Google', async () => {
      const googleEmail = getUniqueEmail('special');
      const specialName = 'José María Ñoño-Pérez';

      // Mock de Google
      const { OAuth2Client } = await import('google-auth-library');
      const mockClient = new OAuth2Client();
      mockClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: 'google_special_123',
          email: googleEmail,
          name: specialName,
          email_verified: true
        })
      });

      const response = await request(app)
        .post('/api/auth/google')
        .send({
          credential: 'mock_google_token'
        });

      expect(response.status).toBe(200);
      expect(response.body.user.name).toBe(specialName);
    });
  });
});