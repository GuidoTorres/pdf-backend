import express from "express";
import userController from "../controllers/userController.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

router.use(authenticateToken);
router.get("/info", userController.getUserInfo.bind(userController));
router.get("/profile", userController.getUserProfile.bind(userController));
router.put("/profile", userController.updateUserProfile.bind(userController));
router.get("/conversions", userController.getConversions.bind(userController));

export default router;