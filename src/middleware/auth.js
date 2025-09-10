import jwt from 'jsonwebtoken';
import config from '../config/config.js';
import databaseService from '../services/databaseService.js';

export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ 
        success: false, 
        error: 'Token de acceso requerido' 
      });
    }

    // Verificar JWT
    const decoded = jwt.verify(token, config.jwt.secret);
    
    // Validar sesión en la base de datos
    const user = await databaseService.validateSession(token);
    
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        error: 'Sesión inválida o expirada' 
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('[AUTH_MIDDLEWARE] Token validation error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false, 
        error: 'Token inválido' 
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        error: 'Token expirado' 
      });
    }

    return res.status(500).json({ 
      success: false, 
      error: 'Error de autenticación' 
    });
  }
};

export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const decoded = jwt.verify(token, config.jwt.secret);
      const user = await databaseService.validateSession(token);
      req.user = user;
    }

    next();
  } catch (error) {
    // En auth opcional, continuamos sin usuario si hay error
    next();
  }
};