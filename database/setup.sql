-- =====================================================
-- StamentAI Database Setup Script
-- MySQL Database Creation and Configuration
-- =====================================================

-- Crear la base de datos
CREATE DATABASE IF NOT EXISTS stamentai 
CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

-- Usar la base de datos
USE stamentai;

-- Crear usuario específico para la aplicación (opcional pero recomendado)
CREATE USER IF NOT EXISTS 'stamentai_user'@'localhost' IDENTIFIED BY 'StamentAI2024!';
CREATE USER IF NOT EXISTS 'stamentai_user'@'%' IDENTIFIED BY 'StamentAI2024!';

-- Otorgar permisos
GRANT ALL PRIVILEGES ON stamentai.* TO 'stamentai_user'@'localhost';
GRANT ALL PRIVILEGES ON stamentai.* TO 'stamentai_user'@'%';
FLUSH PRIVILEGES;

-- =====================================================
-- Crear las tablas (Sequelize las creará automáticamente,
-- pero aquí tienes el SQL manual por si lo necesitas)
-- =====================================================

-- Tabla de usuarios
CREATE TABLE IF NOT EXISTS users (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NULL COMMENT 'NULL para usuarios OAuth',
    name VARCHAR(255) NOT NULL,
    google_id VARCHAR(255) NULL UNIQUE,
    lemon_customer_id VARCHAR(255) NULL,
    lemon_checkout_id VARCHAR(255) NULL,
    email_verified BOOLEAN DEFAULT FALSE,
    verification_token VARCHAR(255) NULL,
    reset_token VARCHAR(255) NULL,
    reset_token_expires DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_users_email (email),
    INDEX idx_users_google_id (google_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de suscripciones
CREATE TABLE IF NOT EXISTS subscriptions (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id CHAR(36) NOT NULL UNIQUE,
    plan ENUM('free', 'basic', 'pro', 'enterprise') DEFAULT 'free',
    pages_remaining INT DEFAULT 10,
    renewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    next_reset DATETIME DEFAULT (DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 30 DAY)),
    status ENUM('active', 'cancelled', 'expired') DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_subscriptions_user_id (user_id),
    INDEX idx_subscriptions_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de documentos
CREATE TABLE IF NOT EXISTS documents (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id CHAR(36) NOT NULL,
    job_id VARCHAR(255) NOT NULL UNIQUE,
    original_file_name VARCHAR(255) NOT NULL,
    file_size INT NULL,
    page_count INT NULL,
    status ENUM('processing', 'completed', 'failed') DEFAULT 'processing',
    step VARCHAR(255) NULL,
    progress INT DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    provider ENUM('docling', 'traditional') DEFAULT 'docling',
    transactions JSON NULL,
    metadata JSON NULL,
    error_message TEXT NULL,
    original_credit DECIMAL(10,2) NULL COMMENT 'Original credit amount from PDF',
    original_debit DECIMAL(10,2) NULL COMMENT 'Original debit amount from PDF',
    original_amount DECIMAL(10,2) NULL COMMENT 'Original amount value from PDF',
    sign_detection_method VARCHAR(20) NULL COMMENT 'Method used for sign detection: columns, heuristics, hybrid',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_documents_user_id (user_id),
    INDEX idx_documents_job_id (job_id),
    INDEX idx_documents_status (status),
    INDEX idx_documents_created_at (created_at),
    INDEX idx_documents_sign_detection_method (sign_detection_method)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de logs del sistema
CREATE TABLE IF NOT EXISTS system_logs (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id CHAR(36) NULL,
    level ENUM('info', 'warning', 'error') DEFAULT 'info',
    message TEXT NOT NULL,
    endpoint VARCHAR(255) NULL,
    method VARCHAR(10) NULL,
    status_code INT NULL,
    details JSON NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_system_logs_user_id (user_id),
    INDEX idx_system_logs_level (level),
    INDEX idx_system_logs_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de logs de pagos
CREATE TABLE IF NOT EXISTS payment_logs (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    event_type VARCHAR(100) NOT NULL,
    customer_id VARCHAR(255) NULL,
    checkout_id VARCHAR(255) NULL,
    plan VARCHAR(50) NULL,
    details JSON NULL,
    processed BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_payment_logs_customer_id (customer_id),
    INDEX idx_payment_logs_checkout_id (checkout_id),
    INDEX idx_payment_logs_processed (processed),
    INDEX idx_payment_logs_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de sesiones de usuario
CREATE TABLE IF NOT EXISTS user_sessions (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id CHAR(36) NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    expires_at DATETIME NOT NULL,
    last_used DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_sessions_user_id (user_id),
    INDEX idx_user_sessions_token_hash (token_hash),
    INDEX idx_user_sessions_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- Datos iniciales (opcional)
-- =====================================================

-- Insertar usuario administrador por defecto
INSERT IGNORE INTO users (
    id, 
    email, 
    password_hash, 
    name, 
    email_verified
) VALUES (
    UUID(),
    'admin@stamentai.com',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/VcSAg/9qm', -- password: admin123
    'Administrator',
    TRUE
);

-- Crear suscripción enterprise para el admin
INSERT IGNORE INTO subscriptions (
    id,
    user_id,
    plan,
    pages_remaining
) VALUES (
    UUID(),
    (SELECT id FROM users WHERE email = 'admin@stamentai.com' LIMIT 1),
    'enterprise',
    999999
);

-- =====================================================
-- Procedimientos almacenados útiles
-- =====================================================

DELIMITER //

-- Procedimiento para resetear páginas mensuales
CREATE PROCEDURE IF NOT EXISTS ResetMonthlyPages()
BEGIN
    DECLARE done INT DEFAULT FALSE;
    DECLARE v_user_id CHAR(36);
    DECLARE v_plan VARCHAR(20);
    DECLARE v_new_pages INT;
    
    DECLARE cur CURSOR FOR 
        SELECT user_id, plan 
        FROM subscriptions 
        WHERE next_reset <= NOW() AND status = 'active';
    
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;
    
    OPEN cur;
    
    read_loop: LOOP
        FETCH cur INTO v_user_id, v_plan;
        IF done THEN
            LEAVE read_loop;
        END IF;
        
        -- Determinar páginas según el plan
        CASE v_plan
            WHEN 'free' THEN SET v_new_pages = 10;
            WHEN 'basic' THEN SET v_new_pages = 50;
            WHEN 'pro' THEN SET v_new_pages = 200;
            WHEN 'enterprise' THEN SET v_new_pages = 999999;
            ELSE SET v_new_pages = 10;
        END CASE;
        
        -- Actualizar suscripción
        UPDATE subscriptions 
        SET 
            pages_remaining = v_new_pages,
            renewed_at = NOW(),
            next_reset = DATE_ADD(NOW(), INTERVAL 30 DAY),
            updated_at = NOW()
        WHERE user_id = v_user_id;
        
    END LOOP;
    
    CLOSE cur;
    
    -- Retornar número de suscripciones actualizadas
    SELECT ROW_COUNT() as updated_subscriptions;
END //

-- Función para limpiar sesiones expiradas
CREATE PROCEDURE IF NOT EXISTS CleanupExpiredSessions()
BEGIN
    DELETE FROM user_sessions WHERE expires_at < NOW();
    SELECT ROW_COUNT() as deleted_sessions;
END //

DELIMITER ;

-- =====================================================
-- Eventos programados (opcional)
-- =====================================================

-- Habilitar el programador de eventos
SET GLOBAL event_scheduler = ON;

-- Evento para limpiar sesiones expiradas cada hora
CREATE EVENT IF NOT EXISTS cleanup_expired_sessions
ON SCHEDULE EVERY 1 HOUR
STARTS CURRENT_TIMESTAMP
DO
    CALL CleanupExpiredSessions();

-- Evento para resetear páginas mensuales cada día a las 2 AM
CREATE EVENT IF NOT EXISTS reset_monthly_pages
ON SCHEDULE EVERY 1 DAY
STARTS (TIMESTAMP(CURRENT_DATE) + INTERVAL 1 DAY + INTERVAL 2 HOUR)
DO
    CALL ResetMonthlyPages();

-- =====================================================
-- Verificación final
-- =====================================================

-- Mostrar las tablas creadas
SHOW TABLES;

-- Mostrar información de la base de datos
SELECT 
    'Database created successfully!' as status,
    DATABASE() as current_database,
    USER() as current_user,
    NOW() as created_at;

-- Mostrar estadísticas iniciales
SELECT 
    (SELECT COUNT(*) FROM users) as total_users,
    (SELECT COUNT(*) FROM subscriptions) as total_subscriptions,
    (SELECT COUNT(*) FROM documents) as total_documents;

COMMIT;