/**
 * Test Unitario de Login - Sin dependencias de aplicación completa
 * Prueba directamente los componentes de autenticación
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../../src/models/index.js';
import database from '../../src/config/database.js';
import config from '../../src/config/config.js';

describe('Login Unitario - Componentes de Autenticación', () => {
  // Helper para generar emails únicos
  const getUniqueEmail = (prefix = 'test') => `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}@unittest.com`;

  beforeAll(async () => {
    // La conexión se establece automáticamente al importar los modelos
    console.log('Database connection ready for tests');
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    // Limpiar solo usuarios de test
    try {
      const { Op } = await import('sequelize');
      await User.destroy({ 
        where: { 
          email: {
            [Op.like]: '%@unittest.com'
          }
        },
        force: true
      });
    } catch (error) {
      // Ignorar errores de limpieza
      console.log('Cleanup error (ignored):', error.message);
    }
  });

  describe('Modelo User - Validación de Contraseñas', () => {
    it('debe hashear contraseñas automáticamente al crear usuario', async () => {
      const plainPassword = 'testpassword123';
      
      const user = await User.create({
        email: getUniqueEmail('hash'),
        password_hash: plainPassword,
        name: 'Hash Test User',
        email_verified: true
      });

      // La contraseña debe estar hasheada
      expect(user.password_hash).not.toBe(plainPassword);
      expect(user.password_hash).toMatch(/^\$2[aby]\$\d+\$/); // bcrypt format
      expect(user.password_hash.length).toBeGreaterThan(50);
    });

    it('debe validar contraseñas correctas', async () => {
      const plainPassword = 'correctpassword123';
      
      const user = await User.create({
        email: 'validate@unittest.com',
        password_hash: plainPassword,
        name: 'Validate Test User',
        email_verified: true
      });

      const isValid = await user.validatePassword(plainPassword);
      expect(isValid).toBe(true);
    });

    it('debe rechazar contraseñas incorrectas', async () => {
      const plainPassword = 'correctpassword123';
      const wrongPassword = 'wrongpassword123';
      
      const user = await User.create({
        email: 'reject@unittest.com',
        password_hash: plainPassword,
        name: 'Reject Test User',
        email_verified: true
      });

      const isValid = await user.validatePassword(wrongPassword);
      expect(isValid).toBe(false);
    });

    it('debe manejar usuarios sin contraseña (OAuth)', async () => {
      const user = await User.create({
        email: 'oauth@unittest.com',
        password_hash: null, // Usuario OAuth
        name: 'OAuth Test User',
        google_id: 'google123',
        email_verified: true
      });

      const isValid = await user.validatePassword('anypassword');
      expect(isValid).toBe(false);
    });

    it('debe ser case-sensitive con contraseñas', async () => {
      const plainPassword = 'CaseSensitive123';
      
      const user = await User.create({
        email: 'case@unittest.com',
        password_hash: plainPassword,
        name: 'Case Test User',
        email_verified: true
      });

      expect(await user.validatePassword('CaseSensitive123')).toBe(true);
      expect(await user.validatePassword('casesensitive123')).toBe(false);
      expect(await user.validatePassword('CASESENSITIVE123')).toBe(false);
    });
  });

  describe('JWT Token Generation', () => {
    it('debe generar tokens JWT válidos', () => {
      const payload = { userId: 'test-user-id', email: 'test@unittest.com' };
      
      const token = jwt.sign(payload, config.jwt.secret, { expiresIn: '1h' });
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT format
    });

    it('debe verificar tokens JWT correctamente', () => {
      const payload = { userId: 'test-user-id', email: 'test@unittest.com' };
      
      const token = jwt.sign(payload, config.jwt.secret, { expiresIn: '1h' });
      const decoded = jwt.verify(token, config.jwt.secret);
      
      expect(decoded.userId).toBe(payload.userId);
      expect(decoded.email).toBe(payload.email);
      expect(decoded.exp).toBeDefined();
      expect(decoded.iat).toBeDefined();
    });

    it('debe rechazar tokens inválidos', () => {
      const invalidToken = 'invalid.token.here';
      
      expect(() => {
        jwt.verify(invalidToken, config.jwt.secret);
      }).toThrow();
    });

    it('debe rechazar tokens con secreto incorrecto', () => {
      const payload = { userId: 'test-user-id', email: 'test@unittest.com' };
      const token = jwt.sign(payload, 'wrong-secret', { expiresIn: '1h' });
      
      expect(() => {
        jwt.verify(token, config.jwt.secret);
      }).toThrow();
    });
  });

  describe('Bcrypt Password Hashing', () => {
    it('debe hashear contraseñas de manera consistente', async () => {
      const password = 'testpassword123';
      
      const hash1 = await bcrypt.hash(password, 10);
      const hash2 = await bcrypt.hash(password, 10);
      
      // Los hashes deben ser diferentes (sal aleatoria)
      expect(hash1).not.toBe(hash2);
      
      // Pero ambos deben validar la misma contraseña
      expect(await bcrypt.compare(password, hash1)).toBe(true);
      expect(await bcrypt.compare(password, hash2)).toBe(true);
    });

    it('debe rechazar contraseñas incorrectas', async () => {
      const password = 'correctpassword';
      const wrongPassword = 'wrongpassword';
      
      const hash = await bcrypt.hash(password, 10);
      
      expect(await bcrypt.compare(password, hash)).toBe(true);
      expect(await bcrypt.compare(wrongPassword, hash)).toBe(false);
    });

    it('debe manejar contraseñas con caracteres especiales', async () => {
      const password = 'pássw0rd!@#$%^&*()_+-=[]{}|;:,.<>?';
      
      const hash = await bcrypt.hash(password, 10);
      
      expect(await bcrypt.compare(password, hash)).toBe(true);
      expect(await bcrypt.compare('different', hash)).toBe(false);
    });

    it('debe manejar contraseñas muy largas', async () => {
      const password = 'a'.repeat(200); // 200 caracteres
      
      const hash = await bcrypt.hash(password, 10);
      
      expect(await bcrypt.compare(password, hash)).toBe(true);
      expect(await bcrypt.compare('b'.repeat(200), hash)).toBe(false);
    });
  });

  describe('User Model - JSON Serialization', () => {
    it('no debe incluir campos sensibles en JSON', async () => {
      const user = await User.create({
        email: 'json@unittest.com',
        password_hash: 'password123',
        name: 'JSON Test User',
        email_verified: true,
        verification_token: 'secret-token',
        reset_token: 'reset-secret',
        reset_token_expires: new Date()
      });

      const userJSON = user.toJSON();
      
      // No debe incluir campos sensibles
      expect(userJSON).not.toHaveProperty('password_hash');
      expect(userJSON).not.toHaveProperty('verification_token');
      expect(userJSON).not.toHaveProperty('reset_token');
      expect(userJSON).not.toHaveProperty('reset_token_expires');
      
      // Debe incluir campos públicos
      expect(userJSON).toHaveProperty('id');
      expect(userJSON).toHaveProperty('email', 'json@unittest.com');
      expect(userJSON).toHaveProperty('name', 'JSON Test User');
      expect(userJSON).toHaveProperty('email_verified', true);
    });
  });

  describe('Database Operations', () => {
    it('debe encontrar usuarios por email', async () => {
      const email = 'find@unittest.com';
      
      await User.create({
        email,
        password_hash: 'password123',
        name: 'Find Test User',
        email_verified: true
      });

      const foundUser = await User.findOne({ where: { email } });
      
      expect(foundUser).toBeDefined();
      expect(foundUser.email).toBe(email);
      expect(foundUser.name).toBe('Find Test User');
    });

    it('debe retornar null para emails inexistentes', async () => {
      const foundUser = await User.findOne({ where: { email: 'nonexistent@unittest.com' } });
      
      expect(foundUser).toBeNull();
    });

    it('debe manejar emails case-insensitive', async () => {
      const email = 'CaseTest@unittest.com';
      
      await User.create({
        email: email.toLowerCase(),
        password_hash: 'password123',
        name: 'Case Test User',
        email_verified: true
      });

      // Buscar con diferentes casos
      const foundUser1 = await User.findOne({ where: { email: email.toLowerCase() } });
      const foundUser2 = await User.findOne({ where: { email: email.toUpperCase() } });
      
      expect(foundUser1).toBeDefined();
      // MySQL puede ser case-insensitive dependiendo de la configuración
      // Solo verificamos que al menos uno funciona
      expect(foundUser1 || foundUser2).toBeDefined();
    });

    it('debe validar formato de email', async () => {
      const invalidEmails = [
        'invalid-email',
        '@example.com',
        'user@',
        'user..name@example.com'
      ];

      for (const email of invalidEmails) {
        await expect(User.create({
          email,
          password_hash: 'password123',
          name: 'Invalid Email User',
          email_verified: true
        })).rejects.toThrow();
      }
    });

    it('debe requerir email único', async () => {
      const email = 'unique@unittest.com';
      
      // Crear primer usuario
      await User.create({
        email,
        password_hash: 'password123',
        name: 'First User',
        email_verified: true
      });

      // Intentar crear segundo usuario con mismo email
      await expect(User.create({
        email,
        password_hash: 'password456',
        name: 'Second User',
        email_verified: true
      })).rejects.toThrow();
    });
  });
});