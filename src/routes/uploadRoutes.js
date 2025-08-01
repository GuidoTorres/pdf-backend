import express from "express";
import multer from "multer";
import uploadController from "../controllers/uploadController.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

// Configurar multer para manejar archivos en memoria
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // Limitar a 5MB
  }
});

// Rutas protegidas
router.use(authMiddleware);

router.post(
  "/upload",
  upload.single("pdf"),
  uploadController.handleUpload.bind(uploadController)
);
router.get(
  "/subscription",
  uploadController.getSubscriptionStatus.bind(uploadController)
);

export default router; 