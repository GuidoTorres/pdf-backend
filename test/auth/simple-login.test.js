/**
 * Test Simple de Login - Verificación Básica
 * Test simplificado para verificar que el sistema de autenticación funciona
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import database from '../../src/config/database.js';
import { User } from '../../src/models/index.js';

describe('Login Simple - Verificación Básica', () => {
  beforeAll(async () => {
    // Solo sincronizar sin forzar recreación
    await database.sync();
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    // Limpiar solo usuarios de test
    await User.destroy({ 
      where: { 
        email: {
          [database.getSequelize().Op.like]: '%@test.com'
        }
      } 
    });
  });

  describe('Login Básico', () => {
    it('debe permitir login con credenciales válidas', async () => {
      // Crear usuario de test
      const testUser = await User.create({
        email: 'valid@test.com',
        password_hash: 'password123', // El hook del modelo se encargará del hash
        name: 'Test User',
        email_verified: true
      });

      // Intentar login
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'valid@test.com',
          password: 'password123'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('token');
      expect(response.body.user.email).toBe('valid@test.com');
      expect(response.body.user.name).toBe('Test User');
    });

    it('debe rechazar credenciales inválidas', async () => {
      // Crear usuario de test
      await User.create({
        email: 'valid@test.com',
        password_hash: 'password123',
        name: 'Test User',
        email_verified: true
      });

      // Intentar login con contraseña incorrecta
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'valid@test.com',
          password: 'wrongpassword'
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Credenciales inválidas');
    });

    it('debe rechazar email inexistente', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@test.com',
          password: 'password123'
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Credenciales inválidas');
    });

    it('debe rechazar campos vacíos', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: '',
          password: 'password123'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Email y contraseña son requeridos');
    });

    it('debe generar token JWT válido', async () => {
      // Crear usuario de test
      await User.create({
        email: 'token@test.com',
        password_hash: 'password123',
        name: 'Token User',
        email_verified: true
      });

      // Login exitoso
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'token@test.com',
          password: 'password123'
        });

      expect(loginResponse.status).toBe(200);
      const token = loginResponse.body.token;
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT format

      // Usar token para acceder a ruta protegida
      const meResponse = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(meResponse.status).toBe(200);
      expect(meResponse.body.user.email).toBe('token@test.com');
    });

    it('no debe incluir campos sensibles en la respuesta', async () => {
      // Crear usuario de test
      await User.create({
        email: 'secure@test.com',
        password_hash: 'password123',
        name: 'Secure User',
        email_verified: true
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'secure@test.com',
          password: 'password123'
        });

      expect(response.status).toBe(200);
      const user = response.body.user;
      
      // No debe incluir campos sensibles
      expect(user).not.toHaveProperty('password_hash');
      expect(user).not.toHaveProperty('verification_token');
      expect(user).not.toHaveProperty('reset_token');
      expect(user).not.toHaveProperty('reset_token_expires');
      
      // Debe incluir campos públicos
      expect(user).toHaveProperty('id');
      expect(user).toHaveProperty('email');
      expect(user).toHaveProperty('name');
      expect(user).toHaveProperty('email_verified');
    });
  });
});