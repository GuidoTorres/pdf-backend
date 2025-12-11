import cron from "node-cron";
import databaseService from "./databaseService.js";
import logService from "./logService.js";

let resetTask = null;

const SCHEDULER_DISABLED = process.env.DISABLE_SUBSCRIPTION_SCHEDULER === "true";

export const startSubscriptionScheduler = () => {
  if (SCHEDULER_DISABLED) {
    logService.info("[SUBSCRIPTIONS] Scheduler disabled via environment flag");
    return;
  }

  if (resetTask) {
    return;
  }

  resetTask = cron.schedule(
    "0 3 * * *",
    async () => {
      try {
        const updated = await databaseService.resetSubscriptions();
        if (updated > 0) {
          logService.info("[SUBSCRIPTIONS] Monthly pages reset", { updated });
        }
      } catch (error) {
        logService.error("[SUBSCRIPTIONS] Failed to reset monthly pages", {
          error: error.message,
        });
      }
    },
    {
      timezone: "UTC",
    }
  );

  logService.info("[SUBSCRIPTIONS] Scheduler started");
};

export const stopSubscriptionScheduler = async () => {
  if (resetTask) {
    resetTask.stop();
    resetTask = null;
    logService.info("[SUBSCRIPTIONS] Scheduler stopped");
  }
};
