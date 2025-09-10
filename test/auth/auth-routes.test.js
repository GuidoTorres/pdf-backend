/**
 * Tests para Rutas de Autenticación
 * Verificación básica de que las rutas existen y responden
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import database from '../../src/config/database.js';

describe('Rutas de Autenticación - Verificación Básica', () => {
  beforeAll(async () => {
    console.log('Auth routes tests ready');
  });

  afterAll(async () => {
    await database.close();
  });

  describe('Rutas Públicas', () => {
    it('debe responder a POST /api/auth/login', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password123'
        });

      // Debe responder (aunque sea con error de credenciales)
      expect([200, 400, 401]).toContain(response.status);
    });

    it('debe responder a POST /api/auth/register', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'password123',
          name: 'Test User'
        });

      // Debe responder (aunque sea con error de validación)
      expect([200, 201, 400, 409]).toContain(response.status);
    });

    it('debe responder a POST /api/auth/google-callback', async () => {
      const response = await request(app)
        .post('/api/auth/google-callback')
        .send({
          credential: 'invalid_token'
        });

      // Debe responder (aunque sea con error de token inválido)
      expect([200, 400, 401]).toContain(response.status);
    });
  });

  describe('Rutas Protegidas', () => {
    it('debe rechazar GET /api/auth/me sin token', async () => {
      const response = await request(app)
        .get('/api/auth/me');

      expect(response.status).toBe(401);
    });

    it('debe rechazar POST /api/auth/logout sin token', async () => {
      const response = await request(app)
        .post('/api/auth/logout');

      expect(response.status).toBe(401);
    });

    it('debe rechazar GET /api/auth/me con token inválido', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid_token');

      expect(response.status).toBe(401);
    });
  });

  describe('Rutas Inexistentes', () => {
    it('debe retornar 404 para rutas no existentes', async () => {
      const response = await request(app)
        .post('/api/auth/nonexistent');

      expect(response.status).toBe(404);
    });

    it('debe retornar 404 para métodos incorrectos', async () => {
      const response = await request(app)
        .get('/api/auth/login'); // GET en lugar de POST

      expect(response.status).toBe(404);
    });
  });

  describe('Validación de Entrada Básica', () => {
    it('debe validar campos requeridos en login', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('debe validar campos requeridos en registro', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('debe manejar JSON malformado', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": "test@example.com", "password": "incomplete"');

      expect(response.status).toBe(400);
    });
  });

  describe('Headers y CORS', () => {
    it('debe incluir headers CORS apropiados', async () => {
      const response = await request(app)
        .options('/api/auth/login');

      expect(response.headers).toHaveProperty('access-control-allow-origin');
      expect(response.headers).toHaveProperty('access-control-allow-methods');
    });

    it('debe aceptar Content-Type application/json', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({
          email: 'test@example.com',
          password: 'password123'
        }));

      expect([200, 400, 401]).toContain(response.status);
    });
  });
});