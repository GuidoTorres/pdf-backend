import extractorService from "../services/extractorService.js";
import pdfService from "../services/pdfService.js";
import supabaseService from "../services/supabaseService.js";
import logService from "../services/logService.js";

const FREE_UPLOAD_LIMIT = 5;

class UploadController {
  async handleUpload(req, res) {
    const startTime = process.hrtime.bigint();

    try {
      console.log('[UPLOAD_CONTROLLER] Starting upload process...');
      
      // 1. Validar archivo
      const validation = extractorService.validateFile(req.file);
      if (!validation.valid) {
        console.log('[UPLOAD_CONTROLLER] File validation failed:', validation.error);
        return res.status(400).json({ error: validation.error });
      }

      const fileSizeMB = (req.file.size / (1024 * 1024)).toFixed(2);
      console.log('[UPLOAD_CONTROLLER] File validated successfully, size:', fileSizeMB, 'MB');

      // 2. Verificar páginas y suscripción
      const pageCount = await pdfService.getPageCount(req.file.buffer);
      console.log('[UPLOAD_CONTROLLER] Page count:', pageCount);
      
      const subscription = await supabaseService.getSubscription(req.user.id);
      console.log('[UPLOAD_CONTROLLER] Subscription:', subscription);

      // COMENTADO TEMPORALMENTE PARA DESARROLLO - DESCOMENTAR EN PRODUCCIÓN
      /*
      if (subscription && subscription.pages_remaining < pageCount) {
        console.log('[UPLOAD_CONTROLLER] Insufficient pages remaining');
        return res.status(403).json({
          error: 'Sin páginas disponibles. Actualiza tu plan.',
          pages_remaining: subscription.pages_remaining,
          pages_needed: pageCount
        });
      }
      */

      // 3. Procesar documento
      console.log('[UPLOAD_CONTROLLER] Starting document processing...');
      const processingResult = await extractorService.process(
        req.file.buffer,
        req.file.originalname,
        req.user.id
      );
      console.log('[UPLOAD_CONTROLLER] Document processing completed, transactions:', processingResult.transactions?.length || 0);

      // 4. Actualizar páginas restantes o uploads gratuitos
      console.log('[UPLOAD_CONTROLLER] Updating subscription/usage...');
      let pagesRemaining;
      if (subscription) {
        // COMENTADO TEMPORALMENTE PARA DESARROLLO - DESCOMENTAR EN PRODUCCIÓN
        // pagesRemaining = await supabaseService.updatePagesRemaining(req.user.id, pageCount);
        pagesRemaining = subscription.pages_remaining; // Mantener páginas sin cambios durante desarrollo
        console.log('[UPLOAD_CONTROLLER] Pages remaining (development mode):', pagesRemaining);
      } else {
        // COMENTADO TEMPORALMENTE PARA DESARROLLO - DESCOMENTAR EN PRODUCCIÓN
        // await supabaseService.incrementFreeUploadsUsed(req.user.id);
        console.log('[UPLOAD_CONTROLLER] Free uploads (development mode - not incremented)');
      }

      // 5. Preparar respuesta
      console.log('[UPLOAD_CONTROLLER] Preparing response...');
      const responseData = {
        meta: processingResult.meta,
        transactions: processingResult.transactions,
        subscription: {
          pages_remaining: pagesRemaining,
          plan: subscription?.plan || 'free'
        },
        processing: {
          pageCount: processingResult.pageCount,
          metrics: processingResult.metrics
        }
      };

      console.log('[UPLOAD_CONTROLLER] Response data prepared. Transactions count:', responseData.transactions.length);
      console.log('[UPLOAD_CONTROLLER] Full response data:', JSON.stringify(responseData, null, 2));

      // Verificar si la respuesta ya fue enviada
      if (res.headersSent) {
        console.log('[UPLOAD_CONTROLLER] ERROR: Headers already sent!');
        return;
      }

      // 6. Configurar headers de respuesta
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // 7. Enviar respuesta
      console.log('[UPLOAD_CONTROLLER] Sending response...');
      res.status(200).json(responseData);
      console.log('[UPLOAD_CONTROLLER] Response sent successfully');

      // 8. Logging de la solicitud (después de enviar respuesta)
      const endTime = process.hrtime.bigint();
      const totalDurationMs = Number(endTime - startTime) / 1_000_000;

      setImmediate(async () => {
        try {
          await logService.logApiRequest({
            userId: req.user.id,
            endpoint: '/upload',
            method: 'POST',
            status: 200,
            details: {
              action: 'pdf_conversion',
              fileName: req.file.originalname,
              fileSizeMB: fileSizeMB,
              pageCount: pageCount,
              transactionsCount: processingResult.transactions?.length || 0,
              processingTimeMs: totalDurationMs.toFixed(2),
              metrics: processingResult.metrics
            }
          });
        } catch (logError) {
          console.error('[UPLOAD_CONTROLLER] Logging error:', logError);
        }
      });

    } catch (error) {
      console.log('[UPLOAD_CONTROLLER] ERROR occurred:', error.message);
      console.log('[UPLOAD_CONTROLLER] Error stack:', error.stack);
      
      const endTime = process.hrtime.bigint();
      const totalDurationMs = Number(endTime - startTime) / 1_000_000;

      // Verificar si la respuesta ya fue enviada antes de enviar error
      if (res.headersSent) {
        console.log('[UPLOAD_CONTROLLER] ERROR: Cannot send error response, headers already sent');
        return;
      }

      // Logging de error (sin await para no bloquear respuesta)
      setImmediate(async () => {
        try {
          await logService.logApiRequest({
            userId: req.user?.id,
            endpoint: '/upload',
            method: 'POST',
            status: 500,
            error: error.message,
            details: {
              action: 'pdf_conversion_error',
              fileName: req.file?.originalname,
              fileSizeMB: req.file ? (req.file.size / (1024 * 1024)).toFixed(2) : 'N/A',
              processingTimeMs: totalDurationMs.toFixed(2),
              errorMessage: error.message
            }
          });
        } catch (logError) {
          console.error('[UPLOAD_CONTROLLER] Logging error:', logError);
        }
      });

      res.status(500).json({
        error: 'Error al procesar el archivo',
        details: error.message
      });
      console.log('[UPLOAD_CONTROLLER] Error response sent');
    }
  }

  async getSubscriptionStatus(req, res) {
    try {
      const subscription = await supabaseService.getSubscription(req.user.id);
      if (!subscription) {
        const freeUploadsUsed = await supabaseService.getFreeUploadsUsed(req.user.id);
        return res.json({ 
          plan: 'free', 
          free_uploads_used: freeUploadsUsed, 
          free_upload_limit: FREE_UPLOAD_LIMIT 
        });
      }
      res.json(subscription);
    } catch (error) {
      res.status(500).json({ error: 'Error al obtener estado de suscripción' });
    }
  }
}

export default new UploadController();