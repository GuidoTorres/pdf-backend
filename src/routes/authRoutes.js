import express from 'express';
import authController from '../controllers/authController.js';
import { authenticateToken } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Rutas públicas
router.post('/login', authLimiter, authController.login);
router.post('/register', authLimiter, authController.register);
router.post('/google-callback', authLimiter, authController.googleCallback);

// Rutas protegidas
router.post('/logout', authenticateToken, authController.logout);
router.get('/me', authenticateToken, authController.getCurrentUser);

export default router;
