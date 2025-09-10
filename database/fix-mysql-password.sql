-- =====================================================
-- Solución para problemas de contraseña MySQL
-- =====================================================

-- OPCIÓN 1: Resetear contraseña de root
-- Ejecutar como administrador del sistema

-- Para MySQL 8.0+
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'nueva_password';

-- Para MySQL 5.7
-- UPDATE mysql.user SET authentication_string = PASSWORD('nueva_password') WHERE User = 'root' AND Host = 'localhost';

-- Aplicar cambios
FLUSH PRIVILEGES;

-- =====================================================
-- OPCIÓN 2: Crear nuevo usuario administrador
-- =====================================================

-- Crear usuario con todos los permisos
CREATE USER IF NOT EXISTS 'admin'@'localhost' IDENTIFIED BY 'admin123';
GRANT ALL PRIVILEGES ON *.* TO 'admin'@'localhost' WITH GRANT OPTION;

-- Crear usuario específico para StamentAI
CREATE USER IF NOT EXISTS 'stamentai_user'@'localhost' IDENTIFIED BY 'StamentAI2024!';
CREATE USER IF NOT EXISTS 'stamentai_user'@'%' IDENTIFIED BY 'StamentAI2024!';

-- Otorgar permisos específicos
GRANT ALL PRIVILEGES ON stamentai.* TO 'stamentai_user'@'localhost';
GRANT ALL PRIVILEGES ON stamentai.* TO 'stamentai_user'@'%';

FLUSH PRIVILEGES;

-- =====================================================
-- Verificar usuarios creados
-- =====================================================

SELECT User, Host, authentication_string FROM mysql.user WHERE User IN ('root', 'admin', 'stamentai_user');

-- =====================================================
-- Crear base de datos si no existe
-- =====================================================

CREATE DATABASE IF NOT EXISTS stamentai 
CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

-- Mostrar bases de datos
SHOW DATABASES;