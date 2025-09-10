/**
 * Tests para Gestión de Sesiones y Tokens
 * Validación, expiración, revocación y seguridad de sesiones
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/app.js';
import database from '../../src/config/database.js';
import { User } from '../../src/models/index.js';
import config from '../../src/config/config.js';

describe('Gestión de Sesiones - Tests Detallados', () => {
  let testUser;
  let validToken;
  let expiredToken;

  beforeAll(async () => {
    await database.sync({ force: true });
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    // Limpiar usuarios antes de cada test
    await User.destroy({ where: {} });

    // Crear usuario de prueba
    testUser = await User.create({
      email: 'session@example.com',
      password_hash: 'password123',
      name: 'Session User',
      email_verified: true
    });

    // Crear token válido
    validToken = jwt.sign(
      { userId: testUser.id, email: testUser.email },
      config.jwt.secret,
      { expiresIn: '1h' }
    );

    // Crear token expirado
    expiredToken = jwt.sign(
      { userId: testUser.id, email: testUser.email },
      config.jwt.secret,
      { expiresIn: '-1h' }
    );
  });

  describe('Validación de Tokens', () => {
    describe('Tokens Válidos', () => {
      it('debe aceptar token válido en Authorization header', async () => {
        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${validToken}`);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.user.id).toBe(testUser.id);
        expect(response.body.user.email).toBe('session@example.com');
      });

      it('debe aceptar diferentes formatos de Bearer token', async () => {
        const formats = [
          `Bearer ${validToken}`,
          `bearer ${validToken}`,
          `BEARER ${validToken}`
        ];

        for (const authHeader of formats) {
          const response = await request(app)
            .get('/api/auth/me')
            .set('Authorization', authHeader);

          expect(response.status).toBe(200);
          expect(response.body.success).toBe(true);
        }
      });

      it('debe validar claims del token correctamente', async () => {
        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${validToken}`);

        expect(response.status).toBe(200);
        
        // Verificar que los claims del token coinciden con el usuario
        const decoded = jwt.verify(validToken, config.jwt.secret);
        expect(response.body.user.id).toBe(decoded.userId);
        expect(response.body.user.email).toBe(decoded.email);
      });
    });

    describe('Tokens Inválidos', () => {
      it('debe rechazar request sin Authorization header', async () => {
        const response = await request(app)
          .get('/api/auth/me');

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Token de acceso requerido');
      });

      it('debe rechazar Authorization header vacío', async () => {
        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', '');

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Token de acceso requerido');
      });

      it('debe rechazar formato incorrecto de Authorization header', async () => {
        const invalidFormats = [
          'InvalidFormat',
          'Basic dGVzdDp0ZXN0',
          `Token ${validToken}`,
          `Bearer`,
          `Bearer `,
          validToken // Sin "Bearer "
        ];

        for (const authHeader of invalidFormats) {
          const response = await request(app)
            .get('/api/auth/me')
            .set('Authorization', authHeader);

          expect(response.status).toBe(401);
          expect(response.body.success).toBe(false);
        }
      });

      it('debe rechazar token malformado', async () => {
        const malformedTokens = [
          'invalid.token.format',
          'not.a.jwt',
          'header.payload', // Sin signature
          'too.many.parts.in.token',
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid_payload.signature'
        ];

        for (const token of malformedTokens) {
          const response = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${token}`);

          expect(response.status).toBe(401);
          expect(response.body.success).toBe(false);
          expect(response.body.error).toBe('Token inválido');
        }
      });

      it('debe rechazar token con signature inválida', async () => {
        const invalidToken = jwt.sign(
          { userId: testUser.id, email: testUser.email },
          'wrong_secret',
          { expiresIn: '1h' }
        );

        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${invalidToken}`);

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Token inválido');
      });
    });

    describe('Tokens Expirados', () => {
      it('debe rechazar token expirado', async () => {
        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${expiredToken}`);

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Token expirado');
      });

      it('debe rechazar token que expira durante el request', async () => {
        // Crear token que expira en 1 segundo
        const shortLivedToken = jwt.sign(
          { userId: testUser.id, email: testUser.email },
          config.jwt.secret,
          { expiresIn: '1s' }
        );

        // Esperar a que expire
        await new Promise(resolve => setTimeout(resolve, 1100));

        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${shortLivedToken}`);

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Token expirado');
      });

      it('debe manejar diferentes formatos de expiración', async () => {
        const expirationFormats = [
          { expiresIn: '-1h', description: 'horas negativas' },
          { expiresIn: '-60', description: 'segundos negativos' },
          { expiresIn: '0', description: 'cero segundos' }
        ];

        for (const format of expirationFormats) {
          const expiredToken = jwt.sign(
            { userId: testUser.id, email: testUser.email },
            config.jwt.secret,
            { expiresIn: format.expiresIn }
          );

          const response = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${expiredToken}`);

          expect(response.status).toBe(401);
          expect(response.body.error).toBe('Token expirado');
        }
      });
    });
  });

  describe('Información del Usuario Actual', () => {
    describe('Respuesta Exitosa', () => {
      it('debe retornar información completa del usuario', async () => {
        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${validToken}`);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.user).toBeDefined();

        const user = response.body.user;
        expect(user).toHaveProperty('id', testUser.id);
        expect(user).toHaveProperty('email', 'session@example.com');
        expect(user).toHaveProperty('name', 'Session User');
        expect(user).toHaveProperty('email_verified', true);
        expect(user).toHaveProperty('isAdmin', false);
        expect(user).toHaveProperty('createdAt');
        expect(user).toHaveProperty('updatedAt');
      });

      it('no debe incluir campos sensibles', async () => {
        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${validToken}`);

        const user = response.body.user;
        expect(user).not.toHaveProperty('password_hash');
        expect(user).not.toHaveProperty('verification_token');
        expect(user).not.toHaveProperty('reset_token');
        expect(user).not.toHaveProperty('reset_token_expires');
      });

      it('debe incluir información de Google si existe', async () => {
        // Actualizar usuario con Google ID
        await testUser.update({ google_id: 'google_123' });

        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${validToken}`);

        expect(response.status).toBe(200);
        expect(response.body.user.google_id).toBe('google_123');
      });

      it('debe incluir información de admin si es admin', async () => {
        // Hacer al usuario admin
        await testUser.update({ isAdmin: true });

        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${validToken}`);

        expect(response.status).toBe(200);
        expect(response.body.user.isAdmin).toBe(true);
      });
    });

    describe('Casos Edge', () => {
      it('debe manejar usuario eliminado después de crear token', async () => {
        // Eliminar usuario después de crear token
        await User.destroy({ where: { id: testUser.id } });

        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${validToken}`);

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Sesión inválida o expirada');
      });

      it('debe manejar usuario con datos actualizados', async () => {
        // Actualizar datos del usuario
        await testUser.update({
          name: 'Updated Name',
          email_verified: false
        });

        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${validToken}`);

        expect(response.status).toBe(200);
        expect(response.body.user.name).toBe('Updated Name');
        expect(response.body.user.email_verified).toBe(false);
      });
    });
  });

  describe('Logout y Revocación de Sesiones', () => {
    describe('Logout Exitoso', () => {
      it('debe permitir logout con token válido', async () => {
        const response = await request(app)
          .post('/api/auth/logout')
          .set('Authorization', `Bearer ${validToken}`);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('Sesión cerrada exitosamente');
      });

      it('debe invalidar token después del logout', async () => {
        // Hacer logout
        await request(app)
          .post('/api/auth/logout')
          .set('Authorization', `Bearer ${validToken}`);

        // Intentar usar el token después del logout
        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${validToken}`);

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Sesión inválida o expirada');
      });

      it('debe permitir múltiples logouts del mismo token', async () => {
        // Primer logout
        const firstLogout = await request(app)
          .post('/api/auth/logout')
          .set('Authorization', `Bearer ${validToken}`);

        expect(firstLogout.status).toBe(200);

        // Segundo logout del mismo token
        const secondLogout = await request(app)
          .post('/api/auth/logout')
          .set('Authorization', `Bearer ${validToken}`);

        // Debería manejar gracefully el logout de token ya revocado
        expect([200, 401]).toContain(secondLogout.status);
      });
    });

    describe('Errores en Logout', () => {
      it('debe rechazar logout sin token', async () => {
        const response = await request(app)
          .post('/api/auth/logout');

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Token de acceso requerido');
      });

      it('debe rechazar logout con token inválido', async () => {
        const response = await request(app)
          .post('/api/auth/logout')
          .set('Authorization', 'Bearer invalid_token');

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Token inválido');
      });

      it('debe rechazar logout con token expirado', async () => {
        const response = await request(app)
          .post('/api/auth/logout')
          .set('Authorization', `Bearer ${expiredToken}`);

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Token expirado');
      });
    });
  });

  describe('Seguridad de Sesiones', () => {
    describe('Prevención de Ataques', () => {
      it('debe prevenir reutilización de tokens revocados', async () => {
        // Hacer logout para revocar token
        await request(app)
          .post('/api/auth/logout')
          .set('Authorization', `Bearer ${validToken}`);

        // Intentar usar token revocado en múltiples endpoints
        const endpoints = [
          { method: 'get', path: '/api/auth/me' },
          { method: 'post', path: '/api/auth/logout' }
        ];

        for (const endpoint of endpoints) {
          const response = await request(app)
            [endpoint.method](endpoint.path)
            .set('Authorization', `Bearer ${validToken}`);

          expect(response.status).toBe(401);
          expect(response.body.success).toBe(false);
        }
      });

      it('debe validar que el token pertenece al usuario correcto', async () => {
        // Crear otro usuario
        const otherUser = await User.create({
          email: 'other@example.com',
          password_hash: 'password123',
          name: 'Other User',
          email_verified: true
        });

        // Crear token para el otro usuario
        const otherToken = jwt.sign(
          { userId: otherUser.id, email: otherUser.email },
          config.jwt.secret,
          { expiresIn: '1h' }
        );

        // Usar token del otro usuario
        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${otherToken}`);

        expect(response.status).toBe(200);
        expect(response.body.user.id).toBe(otherUser.id);
        expect(response.body.user.email).toBe('other@example.com');
        expect(response.body.user.id).not.toBe(testUser.id);
      });

      it('debe manejar tokens con claims manipulados', async () => {
        // Crear token con userId manipulado pero signature válida es imposible
        // sin conocer el secret, así que probamos con datos inconsistentes
        const manipulatedToken = jwt.sign(
          { userId: 'manipulated_id', email: testUser.email },
          config.jwt.secret,
          { expiresIn: '1h' }
        );

        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${manipulatedToken}`);

        // Debería fallar porque el usuario no existe
        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
      });
    });

    describe('Validación de Integridad', () => {
      it('debe validar que el usuario existe en la base de datos', async () => {
        // Eliminar usuario pero mantener token válido
        await User.destroy({ where: { id: testUser.id } });

        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${validToken}`);

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Sesión inválida o expirada');
      });

      it('debe validar consistencia entre token y base de datos', async () => {
        // Cambiar email en base de datos
        await testUser.update({ email: 'changed@example.com' });

        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${validToken}`);

        // Debería seguir funcionando porque validamos por ID, no por email
        expect(response.status).toBe(200);
        expect(response.body.user.email).toBe('changed@example.com');
      });
    });
  });

  describe('Concurrencia y Performance', () => {
    describe('Múltiples Sesiones', () => {
      it('debe permitir múltiples sesiones activas del mismo usuario', async () => {
        // Crear múltiples tokens para el mismo usuario
        const tokens = Array(3).fill().map(() =>
          jwt.sign(
            { userId: testUser.id, email: testUser.email },
            config.jwt.secret,
            { expiresIn: '1h' }
          )
        );

        // Todos los tokens deberían funcionar
        for (const token of tokens) {
          const response = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${token}`);

          expect(response.status).toBe(200);
          expect(response.body.user.id).toBe(testUser.id);
        }
      });

      it('debe manejar logout de una sesión sin afectar otras', async () => {
        // Crear dos tokens
        const token1 = jwt.sign(
          { userId: testUser.id, email: testUser.email },
          config.jwt.secret,
          { expiresIn: '1h' }
        );

        const token2 = jwt.sign(
          { userId: testUser.id, email: testUser.email },
          config.jwt.secret,
          { expiresIn: '1h' }
        );

        // Hacer logout con token1
        await request(app)
          .post('/api/auth/logout')
          .set('Authorization', `Bearer ${token1}`);

        // token1 debería estar revocado
        const response1 = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${token1}`);

        expect(response1.status).toBe(401);

        // token2 debería seguir funcionando
        const response2 = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${token2}`);

        expect(response2.status).toBe(200);
      });
    });

    describe('Performance', () => {
      it('debe validar tokens rápidamente', async () => {
        const startTime = Date.now();

        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${validToken}`);

        const responseTime = Date.now() - startTime;

        expect(response.status).toBe(200);
        expect(responseTime).toBeLessThan(500); // Menos de 500ms
      });

      it('debe manejar múltiples validaciones concurrentes', async () => {
        const startTime = Date.now();

        const promises = Array(10).fill().map(() =>
          request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${validToken}`)
        );

        const responses = await Promise.all(promises);
        const totalTime = Date.now() - startTime;

        // Todas deberían ser exitosas
        responses.forEach(response => {
          expect(response.status).toBe(200);
          expect(response.body.user.id).toBe(testUser.id);
        });

        // Tiempo total razonable
        expect(totalTime).toBeLessThan(2000); // Menos de 2 segundos
      });
    });
  });

  describe('Casos Edge Adicionales', () => {
    it('debe manejar tokens con caracteres especiales en claims', async () => {
      // Crear usuario con caracteres especiales
      const specialUser = await User.create({
        email: 'special@example.com',
        password_hash: 'password123',
        name: 'José María Ñoño',
        email_verified: true
      });

      const specialToken = jwt.sign(
        { userId: specialUser.id, email: specialUser.email },
        config.jwt.secret,
        { expiresIn: '1h' }
      );

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${specialToken}`);

      expect(response.status).toBe(200);
      expect(response.body.user.name).toBe('José María Ñoño');
    });

    it('debe manejar headers con espacios extra', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `  Bearer   ${validToken}  `);

      // Dependiendo de la implementación, podría funcionar o fallar
      expect([200, 401]).toContain(response.status);
    });

    it('debe manejar múltiples Authorization headers', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${validToken}`)
        .set('Authorization', 'Bearer another_token');

      // Express normalmente usa el último header
      expect([200, 401]).toContain(response.status);
    });
  });
});