import databaseService from "../services/databaseService.js";
import logService from "../services/logService.js";
import jwt from 'jsonwebtoken';
import config from '../config/config.js';
import { User } from '../models/index.js';

import { OAuth2Client } from 'google-auth-library';

const client = new OAuth2Client(
  config.google.clientId,
  config.google.clientSecret,
  'postmessage'
);

class AuthController {
  async login(req, res) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ 
          success: false, 
          error: "Email y contraseña son requeridos" 
        });
      }

      // Buscar usuario por email
      const user = await databaseService.findUserByEmail(email);

      if (!user || !(await user.validatePassword(password))) {
        await databaseService.logApiRequest({
          endpoint: '/auth/login',
          method: 'POST',
          status: 401,
          details: { action: 'login_failed', email }
        });
        
        return res.status(401).json({ 
          success: false, 
          error: "Credenciales inválidas" 
        });
      }

      // Generar JWT token
      const token = jwt.sign(
        { userId: user.id, email: user.email },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn }
      );

      // Crear sesión en la base de datos
      await databaseService.createSession(user.id, token);

      // Obtener información completa del usuario
      const userInfo = await databaseService.getUserInfo(user.id);

      await databaseService.logApiRequest({
        userId: user.id,
        endpoint: '/auth/login',
        method: 'POST',
        status: 200,
        details: { action: 'login_success', email }
      });

      res.json({
        success: true,
        user: userInfo,
        token
      });

    } catch (error) {
      console.error('[AUTH_CONTROLLER] Login error:', error);
      
      await databaseService.logApiRequest({
        endpoint: '/auth/login',
        method: 'POST',
        status: 500,
        details: { action: 'login_error', error: error.message }
      });

      res.status(500).json({ 
        success: false, 
        error: "Error interno del servidor" 
      });
    }
  }

  async register(req, res) {
    try {
      const { email, password, name } = req.body;

      if (!email || !password) {
        return res.status(400).json({ 
          success: false, 
          error: "Email y contraseña son requeridos" 
        });
      }

      // Verificar si el usuario ya existe
      const existingUser = await databaseService.findUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ 
          success: false, 
          error: "El email ya está registrado" 
        });
      }

      // Crear usuario
      const user = await databaseService.createUserProfile({
        email,
        password,
        name: name || email.split('@')[0],
        email_verified: true // Por simplicidad, no requerimos verificación de email
      });

      // Generar JWT token
      const token = jwt.sign(
        { userId: user.id, email: user.email },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn }
      );

      // Crear sesión en la base de datos
      await databaseService.createSession(user.id, token);

      // Obtener información completa del usuario
      const userInfo = await databaseService.getUserInfo(user.id);

      await databaseService.logApiRequest({
        userId: user.id,
        endpoint: '/auth/register',
        method: 'POST',
        status: 201,
        details: { action: 'register_success', email }
      });

      res.status(201).json({
        success: true,
        user: userInfo,
        token
      });

    } catch (error) {
      console.error('[AUTH_CONTROLLER] Register error:', error);
      
      await databaseService.logApiRequest({
        endpoint: '/auth/register',
        method: 'POST',
        status: 500,
        details: { action: 'register_error', error: error.message }
      });

      res.status(500).json({ 
        success: false, 
        error: "Error interno del servidor" 
      });
    }
  }

  async googleCallback(req, res) {
    try {
      const { code } = req.body;
      if (!code) {
        return res.status(400).json({ 
          success: false, 
          error: "Authorization code is required" 
        });
      }

      const { tokens } = await client.getToken(code);
      const idToken = tokens.id_token;

      if (!idToken) {
        return res.status(400).json({ 
          success: false, 
          error: "Failed to retrieve ID token from Google" 
        });
      }

      const ticket = await client.verifyIdToken({
        idToken,
        audience: config.google.clientId,
      });

      const payload = ticket.getPayload();
      if (!payload) {
        return res.status(400).json({ 
          success: false, 
          error: "Failed to verify ID token" 
        });
      }

      const { sub: googleId, email, name, picture, email_verified } = payload;

      if (!email || !email_verified) {
        return res.status(400).json({ 
          success: false, 
          error: "Email from Google is not verified or missing"
        });
      }

      let user = await databaseService.findUserByGoogleId(googleId);

      if (!user) {
        user = await databaseService.findUserByEmail(email);
        
        if (user) {
          await databaseService.updateUserProfile(user.id, { 
            google_id: googleId,
            name: name || user.name
          });
          user = await databaseService.findUserByGoogleId(googleId);
        }
      }

      if (!user) {
        user = await databaseService.createUserProfile({
          email,
          name: name || email.split('@')[0],
          google_id: googleId,
          email_verified: true
        });
      }

      const token = jwt.sign(
        { userId: user.id, email: user.email },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn }
      );

      await databaseService.createSession(user.id, token);

      const userInfo = await databaseService.getUserInfo(user.id);

      await databaseService.logApiRequest({
        userId: user.id,
        endpoint: '/auth/google-callback',
        method: 'POST',
        status: 200,
        details: { action: 'google_auth_success', email, provider: 'google' }
      });

      res.json({
        success: true,
        user: userInfo,
        token,
        message: 'Google authentication successful'
      });

    } catch (error) {
      console.error('[AUTH_CONTROLLER] Google callback error:', error);
      
      await databaseService.logApiRequest({
        endpoint: '/auth/google-callback',
        method: 'POST',
        status: 500,
        details: { action: 'google_auth_error', error: error.message }
      });

      res.status(500).json({ 
        success: false, 
        error: "Error interno del servidor" 
      });
    }
  }

  async logout(req, res) {
    try {
      const token = req.headers.authorization?.split(" ")[1];
      
      if (token) {
        await databaseService.revokeSession(token);
      }

      await databaseService.logApiRequest({
        userId: req.user?.id,
        endpoint: '/auth/logout',
        method: 'POST',
        status: 200,
        details: { action: 'logout_success' }
      });

      res.json({ 
        success: true, 
        message: "Sesión cerrada exitosamente" 
      });

    } catch (error) {
      console.error('[AUTH_CONTROLLER] Logout error:', error);
      
      res.status(500).json({ 
        success: false, 
        error: "Error al cerrar sesión" 
      });
    }
  }

  async getCurrentUser(req, res) {
    try {
      const userInfo = await databaseService.getUserInfo(req.user.id);

      await databaseService.logApiRequest({
        userId: req.user.id,
        endpoint: '/auth/me',
        method: 'GET',
        status: 200,
        details: { action: 'get_current_user' }
      });

      res.json({
        success: true,
        user: userInfo
      });

    } catch (error) {
      console.error('[AUTH_CONTROLLER] Get current user error:', error);
      
      res.status(500).json({ 
        success: false, 
        error: "Error al obtener información del usuario" 
      });
    }
  }
}

export default new AuthController();