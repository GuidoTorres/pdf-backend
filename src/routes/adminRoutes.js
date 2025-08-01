import express from "express";
import supabaseService from "../services/supabaseService.js";

const router = express.Router();

router.post("/reset-subscriptions", async (req, res) => {
  try {
    // Validar secreto para cron job
    const cronSecret = req.headers["x-cron-secret"];
    if (cronSecret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: "No autorizado" });
    }

    await supabaseService.resetSubscriptions();
    res.json({ message: "Suscripciones reiniciadas exitosamente" });
  } catch (error) {
    console.error("Error resetting subscriptions:", error);
    res.status(500).json({ error: "Error al reiniciar suscripciones" });
  }
});

export default router; 