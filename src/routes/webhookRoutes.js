import express from 'express';
import webhookController from '../controllers/webhookController.js';

const router = express.Router();

// Middleware to parse raw body for signature verification
router.post('/lemonsqueezy', express.raw({ type: 'application/json' }), webhookController.handleLemonSqueezyWebhook);

export default router;