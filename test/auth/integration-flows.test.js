/**
 * Tests de Integración para Flujos Completos de Autenticación
 * Prueba todos los métodos de login trabajando juntos
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/app.js';
import database from '../../src/config/database.js';
import { User } from '../../src/models/index.js';
import config from '../../src/config/config.js';

// Mock Google OAuth
const mockOAuth2Client = {
  getToken: vi.fn(),
  verifyIdToken: vi.fn()
};

vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn(() => mockOAuth2Client)
}));

describe('Flujos de Autenticación - Integración Completa', () => {
  beforeAll(async () => {
    await database.sync({ force: true });
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await User.destroy({ where: {} });
    vi.clearAllMocks();
  });

  describe('Flujo Completo: Registro → Login → Uso → Logout', () => {
    it('debe completar el flujo tradicional completo', async () => {
      // 1. Registro
      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'fullflow@example.com',
          password: 'SecurePassword123',
          name: 'Full Flow User'
        });

      expect(registerResponse.status).toBe(201);
      expect(registerResponse.body.success).toBe(true);
      expect(registerResponse.body.token).toBeDefined();

      const registerToken = registerResponse.body.token;

      // 2. Usar token de registro para acceder a información
      const meAfterRegister = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${registerToken}`);

      expect(meAfterRegister.status).toBe(200);
      expect(meAfterRegister.body.user.email).toBe('fullflow@example.com');

      // 3. Logout del registro
      const logoutRegister = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${registerToken}`);

      expect(logoutRegister.status).toBe(200);

      // 4. Verificar que el token está revocado
      const meAfterLogout = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${registerToken}`);

      expect(meAfterLogout.status).toBe(401);

      // 5. Login tradicional
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'fullflow@example.com',
          password: 'SecurePassword123'
        });

      expect(loginResponse.status).toBe(200);
      expect(loginResponse.body.success).toBe(true);
      expect(loginResponse.body.token).toBeDefined();
      expect(loginResponse.body.token).not.toBe(registerToken); // Nuevo token

      const loginToken = loginResponse.body.token;

      // 6. Usar nuevo token
      const meAfterLogin = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${loginToken}`);

      expect(meAfterLogin.status).toBe(200);
      expect(meAfterLogin.body.user.email).toBe('fullflow@example.com');

      // 7. Logout final
      const finalLogout = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${loginToken}`);

      expect(finalLogout.status).toBe(200);

      // 8. Verificar revocación final
      const finalCheck = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${loginToken}`);

      expect(finalCheck.status).toBe(401);
    });

    it('debe completar el flujo con Google OAuth', async () => {
      // Mock Google OAuth exitoso
      mockOAuth2Client.getToken.mockResolvedValue({
        tokens: { id_token: 'google_token_123' }
      });

      mockOAuth2Client.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: 'google_user_123',
          email: 'googleflow@example.com',
          name: 'Google Flow User',
          email_verified: true
        })
      });

      // 1. Login con Google (primer uso - crea usuario)
      const googleLoginResponse = await request(app)
        .post('/api/auth/google-callback')
        .send({
          code: 'google_auth_code'
        });

      expect(googleLoginResponse.status).toBe(200);
      expect(googleLoginResponse.body.success).toBe(true);
      expect(googleLoginResponse.body.token).toBeDefined();

      const googleToken = googleLoginResponse.body.token;

      // 2. Verificar que se creó el usuario
      const user = await User.findOne({ where: { email: 'googleflow@example.com' } });
      expect(user).toBeDefined();
      expect(user.google_id).toBe('google_user_123');
      expect(user.password_hash).toBeNull();

      // 3. Usar token de Google
      const meResponse = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${googleToken}`);

      expect(meResponse.status).toBe(200);
      expect(meResponse.body.user.email).toBe('googleflow@example.com');
      expect(meResponse.body.user.google_id).toBe('google_user_123');

      // 4. Logout
      const logoutResponse = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${googleToken}`);

      expect(logoutResponse.status).toBe(200);

      // 5. Login con Google nuevamente (usuario existente)
      const secondGoogleLogin = await request(app)
        .post('/api/auth/google-callback')
        .send({
          code: 'google_auth_code_2'
        });

      expect(secondGoogleLogin.status).toBe(200);
      expect(secondGoogleLogin.body.success).toBe(true);
      expect(secondGoogleLogin.body.token).not.toBe(googleToken); // Nuevo token
    });
  });

  describe('Flujos Híbridos: Tradicional + Google', () => {
    it('debe permitir vincular cuenta tradicional con Google', async () => {
      // 1. Registro tradicional
      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'hybrid@example.com',
          password: 'HybridPassword123',
          name: 'Hybrid User'
        });

      expect(registerResponse.status).toBe(201);

      // 2. Logout del registro
      await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${registerResponse.body.token}`);

      // 3. Mock Google OAuth con el mismo email
      mockOAuth2Client.getToken.mockResolvedValue({
        tokens: { id_token: 'hybrid_google_token' }
      });

      mockOAuth2Client.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: 'hybrid_google_id',
          email: 'hybrid@example.com', // Mismo email
          name: 'Hybrid Google User',
          email_verified: true
        })
      });

      // 4. Login con Google (debería vincular cuenta existente)
      const googleLinkResponse = await request(app)
        .post('/api/auth/google-callback')
        .send({
          code: 'hybrid_link_code'
        });

      expect(googleLinkResponse.status).toBe(200);
      expect(googleLinkResponse.body.success).toBe(true);

      // 5. Verificar que se vinculó la cuenta
      const user = await User.findOne({ where: { email: 'hybrid@example.com' } });
      expect(user.google_id).toBe('hybrid_google_id');
      expect(user.password_hash).not.toBeNull(); // Mantiene password tradicional

      // 6. Logout de Google
      await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${googleLinkResponse.body.token}`);

      // 7. Login tradicional debería seguir funcionando
      const traditionalLoginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'hybrid@example.com',
          password: 'HybridPassword123'
        });

      expect(traditionalLoginResponse.status).toBe(200);
      expect(traditionalLoginResponse.body.success).toBe(true);

      // 8. Logout tradicional
      await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${traditionalLoginResponse.body.token}`);

      // 9. Login con Google debería seguir funcionando
      const secondGoogleLogin = await request(app)
        .post('/api/auth/google-callback')
        .send({
          code: 'hybrid_second_google'
        });

      expect(secondGoogleLogin.status).toBe(200);
      expect(secondGoogleLogin.body.success).toBe(true);
    });

    it('debe manejar conflicto cuando Google intenta crear usuario con email existente', async () => {
      // 1. Crear usuario tradicional
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'conflict@example.com',
          password: 'ConflictPassword123',
          name: 'Conflict User'
        });

      // 2. Mock Google OAuth con email existente pero diferente Google ID
      mockOAuth2Client.getToken.mockResolvedValue({
        tokens: { id_token: 'conflict_token' }
      });

      mockOAuth2Client.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: 'different_google_id',
          email: 'conflict@example.com',
          name: 'Different Google User',
          email_verified: true
        })
      });

      // 3. Login con Google debería vincular la cuenta existente
      const googleResponse = await request(app)
        .post('/api/auth/google-callback')
        .send({
          code: 'conflict_code'
        });

      expect(googleResponse.status).toBe(200);
      expect(googleResponse.body.success).toBe(true);

      // 4. Verificar que se vinculó correctamente
      const user = await User.findOne({ where: { email: 'conflict@example.com' } });
      expect(user.google_id).toBe('different_google_id');
      expect(user.name).toBe('Different Google User'); // Actualizado con datos de Google
    });
  });

  describe('Múltiples Sesiones y Concurrencia', () => {
    it('debe manejar múltiples sesiones activas del mismo usuario', async () => {
      // 1. Registro
      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'multisession@example.com',
          password: 'MultiPassword123',
          name: 'Multi Session User'
        });

      const token1 = registerResponse.body.token;

      // 2. Login adicional (nueva sesión)
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'multisession@example.com',
          password: 'MultiPassword123'
        });

      const token2 = loginResponse.body.token;

      // 3. Mock Google OAuth para tercera sesión
      mockOAuth2Client.getToken.mockResolvedValue({
        tokens: { id_token: 'multi_google_token' }
      });

      mockOAuth2Client.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: 'multi_google_id',
          email: 'multisession@example.com',
          name: 'Multi Google User',
          email_verified: true
        })
      });

      const googleResponse = await request(app)
        .post('/api/auth/google-callback')
        .send({
          code: 'multi_google_code'
        });

      const token3 = googleResponse.body.token;

      // 4. Todos los tokens deberían funcionar
      const tokens = [token1, token2, token3];
      for (const token of tokens) {
        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.body.user.email).toBe('multisession@example.com');
      }

      // 5. Logout de una sesión no debería afectar las otras
      await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token1}`);

      // token1 revocado
      const check1 = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token1}`);
      expect(check1.status).toBe(401);

      // token2 y token3 siguen funcionando
      const check2 = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token2}`);
      expect(check2.status).toBe(200);

      const check3 = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token3}`);
      expect(check3.status).toBe(200);
    });

    it('debe manejar logins concurrentes del mismo usuario', async () => {
      // Crear usuario
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'concurrent@example.com',
          password: 'ConcurrentPassword123',
          name: 'Concurrent User'
        });

      // Múltiples logins simultáneos
      const loginPromises = Array(5).fill().map(() =>
        request(app)
          .post('/api/auth/login')
          .send({
            email: 'concurrent@example.com',
            password: 'ConcurrentPassword123'
          })
      );

      const responses = await Promise.all(loginPromises);

      // Todos deberían ser exitosos
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.token).toBeDefined();
      });

      // Todos los tokens deberían ser únicos
      const tokens = responses.map(r => r.body.token);
      const uniqueTokens = new Set(tokens);
      expect(uniqueTokens.size).toBe(tokens.length);

      // Todos los tokens deberían funcionar
      for (const token of tokens) {
        const meResponse = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${token}`);

        expect(meResponse.status).toBe(200);
        expect(meResponse.body.user.email).toBe('concurrent@example.com');
      }
    });
  });

  describe('Flujos de Error y Recuperación', () => {
    it('debe manejar errores de Google OAuth y permitir login tradicional', async () => {
      // 1. Crear usuario tradicional
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'errorrecovery@example.com',
          password: 'RecoveryPassword123',
          name: 'Error Recovery User'
        });

      // 2. Mock error en Google OAuth
      mockOAuth2Client.getToken.mockRejectedValue(new Error('Google OAuth error'));

      // 3. Intento de login con Google debería fallar
      const googleErrorResponse = await request(app)
        .post('/api/auth/google-callback')
        .send({
          code: 'error_code'
        });

      expect(googleErrorResponse.status).toBe(500);
      expect(googleErrorResponse.body.success).toBe(false);

      // 4. Login tradicional debería seguir funcionando
      const traditionalResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'errorrecovery@example.com',
          password: 'RecoveryPassword123'
        });

      expect(traditionalResponse.status).toBe(200);
      expect(traditionalResponse.body.success).toBe(true);
    });

    it('debe manejar usuario eliminado durante sesión activa', async () => {
      // 1. Registro y obtener token
      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'deleted@example.com',
          password: 'DeletedPassword123',
          name: 'Deleted User'
        });

      const token = registerResponse.body.token;

      // 2. Verificar que el token funciona
      const beforeDelete = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(beforeDelete.status).toBe(200);

      // 3. Eliminar usuario de la base de datos
      await User.destroy({ where: { email: 'deleted@example.com' } });

      // 4. Token debería ser inválido ahora
      const afterDelete = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(afterDelete.status).toBe(401);
      expect(afterDelete.body.error).toBe('Sesión inválida o expirada');

      // 5. Logout debería manejar gracefully el usuario inexistente
      const logoutResponse = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`);

      expect([200, 401]).toContain(logoutResponse.status);
    });
  });

  describe('Flujos de Actualización de Datos', () => {
    it('debe reflejar cambios de usuario en sesiones activas', async () => {
      // 1. Crear usuario y obtener token
      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'updates@example.com',
          password: 'UpdatesPassword123',
          name: 'Updates User'
        });

      const token = registerResponse.body.token;

      // 2. Verificar datos iniciales
      const initialData = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(initialData.body.user.name).toBe('Updates User');
      expect(initialData.body.user.isAdmin).toBe(false);

      // 3. Actualizar datos del usuario
      const user = await User.findOne({ where: { email: 'updates@example.com' } });
      await user.update({
        name: 'Updated Name',
        isAdmin: true
      });

      // 4. Los cambios deberían reflejarse en la sesión activa
      const updatedData = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(updatedData.status).toBe(200);
      expect(updatedData.body.user.name).toBe('Updated Name');
      expect(updatedData.body.user.isAdmin).toBe(true);
    });

    it('debe manejar vinculación de Google en sesión activa', async () => {
      // 1. Login tradicional
      const loginResponse = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'livelink@example.com',
          password: 'LiveLinkPassword123',
          name: 'Live Link User'
        });

      const traditionalToken = loginResponse.body.token;

      // 2. Verificar que no tiene Google ID
      const beforeLink = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${traditionalToken}`);

      expect(beforeLink.body.user.google_id).toBeNull();

      // 3. Vincular con Google desde otra sesión
      mockOAuth2Client.getToken.mockResolvedValue({
        tokens: { id_token: 'livelink_token' }
      });

      mockOAuth2Client.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: 'livelink_google_id',
          email: 'livelink@example.com',
          name: 'Live Link Google User',
          email_verified: true
        })
      });

      const googleLinkResponse = await request(app)
        .post('/api/auth/google-callback')
        .send({
          code: 'livelink_code'
        });

      expect(googleLinkResponse.status).toBe(200);

      // 4. La sesión tradicional debería reflejar la vinculación
      const afterLink = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${traditionalToken}`);

      expect(afterLink.status).toBe(200);
      expect(afterLink.body.user.google_id).toBe('livelink_google_id');
      expect(afterLink.body.user.name).toBe('Live Link Google User');
    });
  });

  describe('Performance en Flujos Complejos', () => {
    it('debe manejar flujo completo en tiempo razonable', async () => {
      const startTime = Date.now();

      // Flujo completo: Registro → Logout → Login → Google Link → Logout → Login
      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'performance@example.com',
          password: 'PerformancePassword123',
          name: 'Performance User'
        });

      await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${registerResponse.body.token}`);

      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'performance@example.com',
          password: 'PerformancePassword123'
        });

      mockOAuth2Client.getToken.mockResolvedValue({
        tokens: { id_token: 'performance_token' }
      });

      mockOAuth2Client.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: 'performance_google_id',
          email: 'performance@example.com',
          name: 'Performance Google User',
          email_verified: true
        })
      });

      const googleResponse = await request(app)
        .post('/api/auth/google-callback')
        .send({
          code: 'performance_code'
        });

      await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${googleResponse.body.token}`);

      const finalLoginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'performance@example.com',
          password: 'PerformancePassword123'
        });

      const totalTime = Date.now() - startTime;

      // Verificar que todo funcionó
      expect(registerResponse.status).toBe(201);
      expect(loginResponse.status).toBe(200);
      expect(googleResponse.status).toBe(200);
      expect(finalLoginResponse.status).toBe(200);

      // Tiempo total razonable
      expect(totalTime).toBeLessThan(5000); // Menos de 5 segundos
    });
  });
});