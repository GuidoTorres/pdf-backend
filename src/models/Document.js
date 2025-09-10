import { DataTypes } from "sequelize";
import database from "../config/database.js";

const sequelize = database.getSequelize();

const Document = sequelize.define(
  "Document",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "id",
      },
    },
    job_id: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    original_file_name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    file_size: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    page_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("processing", "completed", "failed"),
      defaultValue: "processing",
    },
    step: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    progress: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: {
        min: 0,
        max: 100,
      },
    },
    provider: {
      type: DataTypes.ENUM("docling", "traditional"),
      defaultValue: "docling",
    },
    transactions: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    originalTransactions: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Original transactions data from PDF processing',
    },
    originalTable: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Original table structure with headers and rows from PDF',
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    error_message: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    original_credit: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      comment: 'Original credit amount from PDF',
    },
    original_debit: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      comment: 'Original debit amount from PDF',
    },
    original_amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      comment: 'Original amount value from PDF',
    },
    sign_detection_method: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: 'Method used for sign detection: columns, heuristics, hybrid',
      validate: {
        isIn: [['columns', 'heuristics', 'hybrid']],
      },
    },
    // Flexible data extraction fields
    original_structure: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Original document structure metadata',
    },
    column_mappings: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Dynamic column mappings for this document',
    },
    extract_type: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Classified extract type (bank_statement, credit_card, etc.)',
    },
    bank_type: {
      type: DataTypes.STRING(30),
      allowNull: true,
      comment: 'Detected bank type',
    },
    format_version: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: 'Document format version',
    },
    preservation_metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Metadata about data preservation and transformations',
    },
  },
  {
    tableName: "documents",
    indexes: [
      {
        fields: ["user_id"],
      },
      {
        fields: ["job_id"],
      },
      {
        fields: ["status"],
      },
      {
        fields: ["created_at"],
      },
      {
        fields: ["sign_detection_method"],
      },
      {
        fields: ["extract_type"],
      },
      {
        fields: ["bank_type"],
      },
      {
        fields: ["format_version"],
      },
    ],
  }
);

// Instance methods
Document.prototype.updateProgress = async function (progress, step = null) {
  const updateData = { progress };
  if (step) updateData.step = step;

  return await this.update(updateData);
};

Document.prototype.markCompleted = async function (transactions, metadata, originalTransactions = null, originalTable = null) {
  const updateData = {
    status: "completed",
    progress: 100,
    step: "Completed",
    transactions,
    metadata,
  };
  
  if (originalTransactions) {
    updateData.originalTransactions = originalTransactions;
  }
  
  if (originalTable) {
    updateData.originalTable = originalTable;
  }
  
  return await this.update(updateData);
};

Document.prototype.markFailed = async function (errorMessage) {
  return await this.update({
    status: "failed",
    progress: 0,
    step: "Failed",
    error_message: errorMessage,
  });
};

// Amount sign detection helper methods
Document.prototype.updateAmountSignData = async function (amountSignData) {
  const updateData = {};
  
  if (amountSignData.original_credit !== undefined) {
    updateData.original_credit = amountSignData.original_credit;
  }
  
  if (amountSignData.original_debit !== undefined) {
    updateData.original_debit = amountSignData.original_debit;
  }
  
  if (amountSignData.original_amount !== undefined) {
    updateData.original_amount = amountSignData.original_amount;
  }
  
  if (amountSignData.sign_detection_method) {
    updateData.sign_detection_method = amountSignData.sign_detection_method;
  }
  
  return await this.update(updateData);
};

Document.prototype.getAmountSignData = function () {
  return {
    original_credit: this.original_credit,
    original_debit: this.original_debit,
    original_amount: this.original_amount,
    sign_detection_method: this.sign_detection_method,
  };
};

// Flexible data extraction helper methods
Document.prototype.updateFlexibleExtractionData = async function (flexibleData) {
  const updateData = {};
  
  if (flexibleData.original_structure !== undefined) {
    updateData.original_structure = flexibleData.original_structure;
  }
  
  if (flexibleData.column_mappings !== undefined) {
    updateData.column_mappings = flexibleData.column_mappings;
  }
  
  if (flexibleData.extract_type !== undefined) {
    updateData.extract_type = flexibleData.extract_type;
  }
  
  if (flexibleData.bank_type !== undefined) {
    updateData.bank_type = flexibleData.bank_type;
  }
  
  if (flexibleData.format_version !== undefined) {
    updateData.format_version = flexibleData.format_version;
  }
  
  if (flexibleData.preservation_metadata !== undefined) {
    updateData.preservation_metadata = flexibleData.preservation_metadata;
  }
  
  return await this.update(updateData);
};

Document.prototype.getFlexibleExtractionData = function () {
  return {
    original_structure: this.original_structure,
    column_mappings: this.column_mappings,
    extract_type: this.extract_type,
    bank_type: this.bank_type,
    format_version: this.format_version,
    preservation_metadata: this.preservation_metadata,
  };
};

Document.prototype.hasOriginalStructure = function () {
  return this.original_structure !== null && this.original_structure !== undefined;
};

export default Document;
