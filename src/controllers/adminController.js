import {
  User,
  Document,
  Subscription,
  SystemLog,
  PaymentLog,
} from "../models/index.js";
import { Op } from "sequelize";
import logService, { getRecentJobMetrics } from "../services/logService.js";
import webSocketManager from "../services/websocketManager.js";
import dashboardService from "../services/dashboardService.js";

class AdminController {
  /**
   * Get admin dashboard overview with key metrics
   */
  async getDashboardOverview(req, res) {
    try {
      const now = new Date();
      const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Parallel queries for better performance
      const [
        totalUsers,
        newUsersLast30Days,
        newUsersLast7Days,
        newUsersToday,
        totalDocuments,
        documentsLast30Days,
        documentsLast7Days,
        documentsToday,
        activeSubscriptions,
        totalRevenue,
        systemHealth,
      ] = await Promise.all([
        User.count(),
        User.count({ where: { createdAt: { [Op.gte]: last30Days } } }),
        User.count({ where: { createdAt: { [Op.gte]: last7Days } } }),
        User.count({ where: { createdAt: { [Op.gte]: yesterday } } }),
        Document.count(),
        Document.count({ where: { createdAt: { [Op.gte]: last30Days } } }),
        Document.count({ where: { createdAt: { [Op.gte]: last7Days } } }),
        Document.count({ where: { createdAt: { [Op.gte]: yesterday } } }),
        Subscription.count({ where: { plan: { [Op.ne]: "free" } } }),
        this.sumPaymentAmount(),
        this.getSystemHealthSummary(),
      ]);

      // Calculate growth rates
      const userGrowthRate =
        newUsersLast7Days > 0
          ? ((newUsersToday / newUsersLast7Days) * 100).toFixed(1)
          : 0;

      const documentGrowthRate =
        documentsLast7Days > 0
          ? ((documentsToday / documentsLast7Days) * 100).toFixed(1)
          : 0;

      const overview = {
        users: {
          total: totalUsers,
          new30Days: newUsersLast30Days,
          new7Days: newUsersLast7Days,
          newToday: newUsersToday,
          growthRate: userGrowthRate,
        },
        documents: {
          total: totalDocuments,
          processed30Days: documentsLast30Days,
          processed7Days: documentsLast7Days,
          processedToday: documentsToday,
          growthRate: documentGrowthRate,
        },
        subscriptions: {
          active: activeSubscriptions,
          free: totalUsers - activeSubscriptions,
          conversionRate:
            totalUsers > 0
              ? ((activeSubscriptions / totalUsers) * 100).toFixed(1)
              : 0,
        },
        revenue: {
          total: totalRevenue,
          monthly: await this.getMonthlyRevenue(),
          averagePerUser:
            totalUsers > 0 ? (totalRevenue / totalUsers).toFixed(2) : 0,
        },
        system: systemHealth,
        lastUpdated: new Date().toISOString(),
      };

      res.json({
        success: true,
        data: overview,
      });
    } catch (error) {
      logService.error("Error getting admin dashboard overview:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get dashboard overview",
      });
    }
  }

  /**
   * Get detailed user statistics
   */
  async getUserStats(req, res) {
    try {
      const { timeRange = "30d" } = req.query;
      const days = this.parseTimeRange(timeRange);
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const [
        totalUsers,
        verifiedUsers,
        googleUsers,
        activeUsers,
        usersByPlan,
        userRegistrationTrend,
      ] = await Promise.all([
        User.count(),
        User.count({ where: { email_verified: true } }),
        User.count({ where: { google_id: { [Op.ne]: null } } }),
        User.count({ where: { updatedAt: { [Op.gte]: startDate } } }),
        this.getUsersByPlan(),
        this.getUserRegistrationTrend(days),
      ]);

      const stats = {
        overview: {
          total: totalUsers,
          verified: verifiedUsers,
          unverified: totalUsers - verifiedUsers,
          googleUsers,
          traditionalUsers: totalUsers - googleUsers,
          active: activeUsers,
          verificationRate:
            totalUsers > 0
              ? ((verifiedUsers / totalUsers) * 100).toFixed(1)
              : 0,
        },
        byPlan: usersByPlan,
        registrationTrend: userRegistrationTrend,
        timeRange,
        generatedAt: new Date().toISOString(),
      };

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logService.error("Error getting user stats:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get user statistics",
      });
    }
  }

  /**
   * Get paginated list of users
   */
  async getUsers(req, res) {
    try {
      const {
        page = 1,
        limit = 10,
        search = "",
        plan = "",
        verified = "",
        sortBy = "createdAt",
        sortOrder = "DESC",
      } = req.query;

      const offset = (parseInt(page) - 1) * parseInt(limit);
      const whereClause = {};

      // Search filter
      if (search) {
        whereClause[Op.or] = [
          { email: { [Op.like]: `%${search}%` } },
          { name: { [Op.like]: `%${search}%` } },
        ];
      }

      // Verified filter
      if (verified !== "") {
        whereClause.email_verified = verified === "true";
      }

      // Include subscription for plan filtering
      const include = [
        {
          model: Subscription,
          as: "subscription",
          required: plan !== "",
          where: plan ? { plan } : undefined,
        },
      ];

      const { count, rows: users } = await User.findAndCountAll({
        where: whereClause,
        include,
        limit: parseInt(limit),
        offset,
        order: [[sortBy, sortOrder.toUpperCase()]],
        distinct: true,
      });

      const totalPages = Math.ceil(count / parseInt(limit));

      res.json({
        success: true,
        data: {
          users: users.map((user) => ({
            id: user.id,
            email: user.email,
            name: user.name,
            email_verified: user.email_verified,
            google_id: user.google_id ? "Yes" : "No",
            plan: user.subscription?.plan || "free",
            pages_remaining: user.subscription?.pages_remaining || 0,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            isAdmin: user.isAdmin,
          })),
          pagination: {
            currentPage: parseInt(page),
            totalPages,
            totalUsers: count,
            hasNext: parseInt(page) < totalPages,
            hasPrev: parseInt(page) > 1,
          },
        },
      });
    } catch (error) {
      logService.error("Error getting users:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get users",
      });
    }
  }

  /**
   * Get specific user details
   */
  async getUserDetails(req, res) {
    try {
      const { userId } = req.params;

      const user = await User.findByPk(userId, {
        include: [
          {
            model: Subscription,
            as: "subscription",
          },
          {
            model: Document,
            as: "documents",
            limit: 10,
            order: [["createdAt", "DESC"]],
          },
        ],
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          error: "User not found",
        });
      }

      // Get user activity stats
      const [totalDocuments, completedDocuments, failedDocuments] =
        await Promise.all([
          Document.count({ where: { user_id: userId } }),
          Document.count({ where: { user_id: userId, status: "completed" } }),
          Document.count({ where: { user_id: userId, status: "failed" } }),
        ]);

      const userDetails = {
        ...user.toJSON(),
        stats: {
          totalDocuments,
          completedDocuments,
          failedDocuments,
          successRate:
            totalDocuments > 0
              ? ((completedDocuments / totalDocuments) * 100).toFixed(1)
              : 0,
        },
      };

      res.json({
        success: true,
        data: userDetails,
      });
    } catch (error) {
      logService.error("Error getting user details:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get user details",
      });
    }
  }

  /**
   * Update user status (activate/deactivate)
   */
  async updateUserStatus(req, res) {
    try {
      const { userId } = req.params;
      const { active, reason } = req.body;

      const user = await User.findByPk(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: "User not found",
        });
      }

      // Update user status (you might want to add an 'active' field to User model)
      await user.update({
        email_verified: active,
        updatedAt: new Date(),
      });

      // Log admin action
      await this.logAdminAction(req.user.id, "user_status_update", {
        targetUserId: userId,
        action: active ? "activate" : "deactivate",
        reason,
      });

      res.json({
        success: true,
        message: `User ${active ? "activated" : "deactivated"} successfully`,
      });
    } catch (error) {
      logService.error("Error updating user status:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update user status",
      });
    }
  }

  /**
   * Delete user
   */
  async deleteUser(req, res) {
    try {
      const { userId } = req.params;
      const { reason } = req.body;

      const user = await User.findByPk(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: "User not found",
        });
      }

      // Don't allow deleting admin users
      if (user.isAdmin) {
        return res.status(403).json({
          success: false,
          error: "Cannot delete admin users",
        });
      }

      // Delete user and related data
      await user.destroy();

      // Log admin action
      await this.logAdminAction(req.user.id, "user_delete", {
        targetUserId: userId,
        targetUserEmail: user.email,
        reason,
      });

      res.json({
        success: true,
        message: "User deleted successfully",
      });
    } catch (error) {
      logService.error("Error deleting user:", error);
      res.status(500).json({
        success: false,
        error: "Failed to delete user",
      });
    }
  }

  /**
   * Get document processing statistics
   */
  async getDocumentStats(req, res) {
    try {
      const { timeRange = "30d" } = req.query;
      const days = this.parseTimeRange(timeRange);
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const [
        totalDocuments,
        completedDocuments,
        failedDocuments,
        processingDocuments,
        documentsByStatus,
        processingTrend,
        averageProcessingTime,
      ] = await Promise.all([
        Document.count(),
        Document.count({ where: { status: "completed" } }),
        Document.count({ where: { status: "failed" } }),
        Document.count({ where: { status: "processing" } }),
        this.getDocumentsByStatus(),
        this.getDocumentProcessingTrend(days),
        this.getAverageProcessingTime(startDate),
      ]);

      const stats = {
        overview: {
          total: totalDocuments,
          completed: completedDocuments,
          failed: failedDocuments,
          processing: processingDocuments,
          pending:
            totalDocuments -
            completedDocuments -
            failedDocuments -
            processingDocuments,
          successRate:
            totalDocuments > 0
              ? ((completedDocuments / totalDocuments) * 100).toFixed(1)
              : 0,
        },
        byStatus: documentsByStatus,
        processingTrend,
        performance: {
          averageProcessingTime: averageProcessingTime || 0,
          totalProcessingTime: await this.getTotalProcessingTime(startDate),
        },
        timeRange,
        generatedAt: new Date().toISOString(),
      };

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logService.error("Error getting document stats:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get document statistics",
      });
    }
  }

  /**
   * Get system analytics
   */
  async getSystemAnalytics(req, res) {
    try {
      const { timeRange = "7d", metric = "usage" } = req.query;
      const days = this.parseTimeRange(timeRange);

      let analytics = {};

      switch (metric) {
        case "usage":
          analytics = await this.getUsageAnalytics(days);
          break;
        case "performance":
          analytics = await this.getPerformanceAnalytics(days);
          break;
        case "errors":
          analytics = await this.getErrorAnalytics(days);
          break;
        default:
          analytics = await this.getUsageAnalytics(days);
      }

      res.json({
        success: true,
        data: {
          ...analytics,
          metric,
          timeRange,
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      logService.error("Error getting system analytics:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get system analytics",
      });
    }
  }

  /**
   * Get paginated list of documents
   */
  async getDocuments(req, res) {
    try {
      const {
        page = 1,
        limit = 10,
        status = "",
        userId = "",
        sortBy = "createdAt",
        sortOrder = "DESC",
      } = req.query;

      const offset = (parseInt(page) - 1) * parseInt(limit);
      const whereClause = {};

      // Status filter
      if (status) {
        whereClause.status = status;
      }

      // User filter
      if (userId) {
        whereClause.user_id = userId;
      }

      const { count, rows: documents } = await Document.findAndCountAll({
        where: whereClause,
        include: [
          {
            model: User,
            as: "user",
            attributes: ["id", "email", "name"],
          },
        ],
        limit: parseInt(limit),
        offset,
        order: [[sortBy, sortOrder.toUpperCase()]],
      });

      const totalPages = Math.ceil(count / parseInt(limit));

      res.json({
        success: true,
        data: {
          documents,
          pagination: {
            currentPage: parseInt(page),
            totalPages,
            totalDocuments: count,
            hasNext: parseInt(page) < totalPages,
            hasPrev: parseInt(page) > 1,
          },
        },
      });
    } catch (error) {
      logService.error("Error getting documents:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get documents",
      });
    }
  }

  /**
   * Get specific document details
   */
  async getDocumentDetails(req, res) {
    try {
      const { documentId } = req.params;

      const document = await Document.findByPk(documentId, {
        include: [
          {
            model: User,
            as: "user",
            attributes: ["id", "email", "name"],
          },
        ],
      });

      if (!document) {
        return res.status(404).json({
          success: false,
          error: "Document not found",
        });
      }

      res.json({
        success: true,
        data: document,
      });
    } catch (error) {
      logService.error("Error getting document details:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get document details",
      });
    }
  }

  /**
   * Delete document
   */
  async deleteDocument(req, res) {
    try {
      const { documentId } = req.params;
      const { reason } = req.body;

      const document = await Document.findByPk(documentId);
      if (!document) {
        return res.status(404).json({
          success: false,
          error: "Document not found",
        });
      }

      await document.destroy();

      // Log admin action
      await this.logAdminAction(req.user.id, "document_delete", {
        documentId,
        reason,
      });

      res.json({
        success: true,
        message: "Document deleted successfully",
      });
    } catch (error) {
      logService.error("Error deleting document:", error);
      res.status(500).json({
        success: false,
        error: "Failed to delete document",
      });
    }
  }

  async getProcessingMetrics(req, res) {
    try {
      const metrics = getRecentJobMetrics();
      res.json({
        success: true,
        data: metrics,
      });
    } catch (error) {
      logService.error("Error retrieving processing metrics:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get processing metrics",
      });
    }
  }

  /**
   * Get revenue statistics
   */
  async getRevenueStats(req, res) {
    try {
      const { timeRange = "30d" } = req.query;
      const days = this.parseTimeRange(timeRange);
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const [totalRevenue, monthlyRevenue, revenueByPlan, revenueTrend] =
        await Promise.all([
          this.sumPaymentAmount(),
          this.getMonthlyRevenue(),
          this.getRevenueByPlan(),
          this.getRevenueTrend(days),
        ]);

      const stats = {
        overview: {
          total: totalRevenue,
          monthly: monthlyRevenue,
          daily: monthlyRevenue / 30,
          growth: await this.getRevenueGrowth(),
        },
        byPlan: revenueByPlan,
        trend: revenueTrend,
        timeRange,
        generatedAt: new Date().toISOString(),
      };

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logService.error("Error getting revenue stats:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get revenue statistics",
      });
    }
  }

  /**
   * Get subscription statistics
   */
  async getSubscriptionStats(req, res) {
    try {
      const [
        totalSubscriptions,
        activeSubscriptions,
        subscriptionsByPlan,
        churnRate,
      ] = await Promise.all([
        Subscription.count(),
        Subscription.count({ where: { plan: { [Op.ne]: "free" } } }),
        this.getUsersByPlan(),
        this.getChurnRate(),
      ]);

      const stats = {
        overview: {
          total: totalSubscriptions,
          active: activeSubscriptions,
          free: totalSubscriptions - activeSubscriptions,
          conversionRate:
            totalSubscriptions > 0
              ? ((activeSubscriptions / totalSubscriptions) * 100).toFixed(1)
              : 0,
          churnRate,
        },
        byPlan: subscriptionsByPlan,
        generatedAt: new Date().toISOString(),
      };

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logService.error("Error getting subscription stats:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get subscription statistics",
      });
    }
  }

  /**
   * Get system health
   */
  async getSystemHealth(req, res) {
    try {
      const health = await this.getSystemHealthSummary();

      res.json({
        success: true,
        data: health,
      });
    } catch (error) {
      logService.error("Error getting system health:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get system health",
      });
    }
  }

  /**
   * Get system logs
   */
  async getSystemLogs(req, res) {
    try {
      const { level = "", limit = 50, page = 1 } = req.query;

      const offset = (parseInt(page) - 1) * parseInt(limit);
      const whereClause = {};

      if (level) {
        whereClause.level = level;
      }

      const { count, rows: logs } = await SystemLog.findAndCountAll({
        where: whereClause,
        limit: parseInt(limit),
        offset,
        order: [["createdAt", "DESC"]],
      });

      res.json({
        success: true,
        data: {
          logs,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(count / parseInt(limit)),
            totalLogs: count,
          },
        },
      });
    } catch (error) {
      logService.error("Error getting system logs:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get system logs",
      });
    }
  }

  /**
   * Get API usage statistics
   */
  async getApiUsage(req, res) {
    try {
      const { timeRange = "7d" } = req.query;
      const days = this.parseTimeRange(timeRange);

      // This would typically come from API logs or metrics
      const usage = {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageResponseTime: 0,
        requestsByEndpoint: [],
        requestsTrend: [],
        timeRange,
        generatedAt: new Date().toISOString(),
      };

      res.json({
        success: true,
        data: usage,
      });
    } catch (error) {
      logService.error("Error getting API usage:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get API usage statistics",
      });
    }
  }

  /**
   * Export data
   */
  async exportData(req, res) {
    try {
      const { type, format = "json" } = req.body;

      let data = {};

      switch (type) {
        case "users":
          data = await User.findAll();
          break;
        case "documents":
          data = await Document.findAll();
          break;
        case "subscriptions":
          data = await Subscription.findAll();
          break;
        default:
          return res.status(400).json({
            success: false,
            error: "Invalid export type",
          });
      }

      // Log admin action
      await this.logAdminAction(req.user.id, "data_export", {
        type,
        format,
        recordCount: data.length,
      });

      res.json({
        success: true,
        data: {
          type,
          format,
          recordCount: data.length,
          data,
          exportedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      logService.error("Error exporting data:", error);
      res.status(500).json({
        success: false,
        error: "Failed to export data",
      });
    }
  }

  /**
   * Send notification to users
   */
  async sendNotification(req, res) {
    try {
      const { title, message, type = "info", targetUsers = "all" } = req.body;

      // This would integrate with your notification system
      // For now, we'll just log it and return success

      await this.logAdminAction(req.user.id, "notification_sent", {
        title,
        message,
        type,
        targetUsers,
      });

      res.json({
        success: true,
        message: "Notification sent successfully",
      });
    } catch (error) {
      logService.error("Error sending notification:", error);
      res.status(500).json({
        success: false,
        error: "Failed to send notification",
      });
    }
  }

  /**
   * Get admin activity log
   */
  async getAdminActivity(req, res) {
    try {
      const { page = 1, limit = 20, adminId = "" } = req.query;

      const offset = (parseInt(page) - 1) * parseInt(limit);
      const whereClause = {
        message: { [Op.like]: "Admin action:%" },
      };

      if (adminId) {
        whereClause.details = { [Op.like]: `%"adminId":"${adminId}"%` };
      }

      const { count, rows: activities } = await SystemLog.findAndCountAll({
        where: whereClause,
        limit: parseInt(limit),
        offset,
        order: [["createdAt", "DESC"]],
      });

      res.json({
        success: true,
        data: {
          activities,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(count / parseInt(limit)),
            totalActivities: count,
          },
        },
      });
    } catch (error) {
      logService.error("Error getting admin activity:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get admin activity",
      });
    }
  }

  // Helper methods
  parseTimeRange(timeRange) {
    const ranges = {
      "1d": 1,
      "7d": 7,
      "30d": 30,
      "90d": 90,
    };
    return ranges[timeRange] || 30;
  }

  async getUsersByPlan() {
    const plans = await Subscription.findAll({
      attributes: [
        "plan",
        [
          Subscription.sequelize.fn(
            "COUNT",
            Subscription.sequelize.col("plan")
          ),
          "count",
        ],
      ],
      group: ["plan"],
    });

    return plans.map((p) => ({
      plan: p.plan,
      count: parseInt(p.dataValues.count),
    }));
  }

  async getUserRegistrationTrend(days) {
    // Implementation for user registration trend
    return [];
  }

  async getDocumentsByStatus() {
    const statuses = await Document.findAll({
      attributes: [
        "status",
        [
          Document.sequelize.fn("COUNT", Document.sequelize.col("status")),
          "count",
        ],
      ],
      group: ["status"],
    });

    return statuses.map((s) => ({
      status: s.status,
      count: parseInt(s.dataValues.count),
    }));
  }

  async getDocumentProcessingTrend(days) {
    // Implementation for document processing trend
    return [];
  }

  async getAverageProcessingTime(startDate) {
    const result = await Document.findOne({
      attributes: [
        [
          Document.sequelize.fn(
            "AVG",
            Document.sequelize.col("processing_time")
          ),
          "avgTime",
        ],
      ],
      where: {
        status: "completed",
        createdAt: { [Op.gte]: startDate },
      },
    });

    return result?.dataValues.avgTime || 0;
  }

  async getTotalProcessingTime(startDate) {
    const result = await Document.findOne({
      attributes: [
        [
          Document.sequelize.fn(
            "SUM",
            Document.sequelize.col("processing_time")
          ),
          "totalTime",
        ],
      ],
      where: {
        status: "completed",
        createdAt: { [Op.gte]: startDate },
      },
    });

    return result?.dataValues.totalTime || 0;
  }

  async getMonthlyRevenue() {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    return this.sumPaymentAmount({
      createdAt: { [Op.gte]: startOfMonth },
    });
  }

  async sumPaymentAmount(where = undefined) {
    const hasAmountColumn =
      PaymentLog?.rawAttributes && "amount" in PaymentLog.rawAttributes;

    if (!hasAmountColumn) {
      return 0;
    }

    try {
      const result = await PaymentLog.sum("amount", {
        where,
      });
      return result || 0;
    } catch (error) {
      logService.warn("Failed to aggregate payment amounts", {
        error: error.message,
      });
      return 0;
    }
  }

  async getSystemHealthSummary() {
    try {
      const dashboardStatus = dashboardService.getStatus();
      const wsStatus = webSocketManager.getConnectedUsersCount();
      const adminMetrics = webSocketManager.getAdminMetrics();

      return {
        status: "healthy",
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        connectedUsers: wsStatus,
        dashboardActive: dashboardStatus.isCollecting,
        metrics: adminMetrics,
        lastCheck: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: "error",
        error: error.message,
        lastCheck: new Date().toISOString(),
      };
    }
  }

  async getUsageAnalytics(days) {
    // Implementation for usage analytics
    return {
      dailyActiveUsers: [],
      documentProcessing: [],
      apiCalls: [],
    };
  }

  async getPerformanceAnalytics(days) {
    // Implementation for performance analytics
    return {
      responseTime: [],
      throughput: [],
      errorRate: [],
    };
  }

  async getErrorAnalytics(days) {
    // Implementation for error analytics
    return {
      errorCount: [],
      errorTypes: [],
      criticalErrors: [],
    };
  }

  async getRevenueByPlan() {
    // Implementation for revenue by plan
    return [];
  }

  async getRevenueTrend(days) {
    // Implementation for revenue trend
    return [];
  }

  async getRevenueGrowth() {
    // Implementation for revenue growth calculation
    return 0;
  }

  async getChurnRate() {
    // Implementation for churn rate calculation
    return 0;
  }

  async logAdminAction(adminId, action, details) {
    try {
      await SystemLog.create({
        level: "info",
        message: `Admin action: ${action}`,
        details: JSON.stringify({
          adminId,
          action,
          ...details,
          timestamp: new Date().toISOString(),
        }),
      });
    } catch (error) {
      logService.error("Error logging admin action:", error);
    }
  }
}

export default new AdminController();
