import express from 'express';
import webhookController from '../controllers/webhookController.js';

const router = express.Router();

// Paddle envía webhooks como x-www-form-urlencoded por defecto
router.post(
  '/paddle',
  express.urlencoded({ extended: false }),
  webhookController.handlePaddleWebhook
);

export default router;
