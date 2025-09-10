# Base de Datos StamentAI - Configuración Local

## Instalación de MySQL

### Ubuntu/Debian

```bash
sudo apt update
sudo apt install mysql-server
sudo systemctl start mysql
sudo systemctl enable mysql
```

### macOS

```bash
brew install mysql
brew services start mysql
```

### Windows

Descargar desde: https://dev.mysql.com/downloads/mysql/

## Configuración Inicial

### 1. Acceder a MySQL como root

```bash
mysql -u root -p
```

### 2. Ejecutar el script de configuración

```bash
# Desde la carpeta backend/
mysql -u root -p < database/setup.sql
```

### 3. Verificar la instalación

```sql
-- Conectar con el nuevo usuario
mysql -u stamentai_user -p

-- Verificar tablas
USE stamentai;
SHOW TABLES;

-- Ver datos iniciales
SELECT * FROM users;
SELECT * FROM subscriptions;
```

## Configuración de Variables de Entorno

Crear archivo `.env` en la carpeta `backend/`:

```env
# Base de datos
DB_HOST=localhost
DB_PORT=3306
DB_NAME=stamentai
DB_USER=stamentai_user
DB_PASSWORD=StamentAI2024!

# JWT
JWT_SECRET=tu-clave-secreta-muy-segura-cambia-esto-en-produccion
JWT_EXPIRES_IN=7d

# Otros...
PORT=3000
NODE_ENV=development
```

## Credenciales por Defecto

### Usuario Administrador

- **Email**: admin@stamentai.com
- **Password**: admin123
- **Plan**: Enterprise (páginas ilimitadas)

### Usuario de Base de Datos

- **Usuario**: stamentai_user
- **Password**: StamentAI2024!
- **Base de datos**: stamentai

## Comandos Útiles

### Inicializar con Sequelize (Recomendado)

```bash
npm run db:init
```

### Resetear base de datos

```bash
npm run db:reset
```

### Backup manual

```bash
mysqldump -u stamentai_user -p stamentai > backup_$(date +%Y%m%d).sql
```

### Restaurar backup

```bash
mysql -u stamentai_user -p stamentai < backup_20241216.sql
```

### Conectar desde línea de comandos

```bash
mysql -u stamentai_user -p stamentai
```

## Estructura de Tablas

### users

- Información básica de usuarios
- Soporte para OAuth (Google)
- Hash de contraseñas con bcrypt

### subscriptions

- Planes de suscripción
- Control de páginas restantes
- Reset automático mensual

### documents

- Historial de documentos procesados
- Estado de procesamiento
- Metadatos y transacciones extraídas

### system_logs

- Logs de la aplicación
- Requests de API
- Errores del sistema

### payment_logs

- Eventos de Lemon Squeezy
- Historial de pagos
- Webhooks procesados

### user_sessions

- Sesiones JWT activas
- Control de expiración
- Revocación de tokens

## Mantenimiento Automático

El script incluye eventos programados para:

1. **Limpiar sesiones expiradas** (cada hora)
2. **Resetear páginas mensuales** (diario a las 2 AM)

### Verificar eventos

```sql
SHOW EVENTS;
SELECT * FROM information_schema.EVENTS WHERE EVENT_SCHEMA = 'stamentai';
```

### Habilitar/deshabilitar eventos

```sql
SET GLOBAL event_scheduler = ON;   -- Habilitar
SET GLOBAL event_scheduler = OFF;  -- Deshabilitar
```

## Troubleshooting

### Error de conexión

```bash
# Verificar que MySQL esté corriendo
sudo systemctl status mysql

# Reiniciar MySQL
sudo systemctl restart mysql
```

### Error de permisos

```sql
-- Recrear usuario
DROP USER IF EXISTS 'stamentai_user'@'localhost';
CREATE USER 'stamentai_user'@'localhost' IDENTIFIED BY 'StamentAI2024!';
GRANT ALL PRIVILEGES ON stamentai.* TO 'stamentai_user'@'localhost';
FLUSH PRIVILEGES;
```

### Error de charset

```sql
-- Verificar charset de la base de datos
SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME
FROM information_schema.SCHEMATA
WHERE SCHEMA_NAME = 'stamentai';

-- Cambiar charset si es necesario
ALTER DATABASE stamentai CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

## Próximos Pasos

1. ✅ Ejecutar `database/setup.sql`
2. ✅ Configurar `.env`
3. ✅ Ejecutar `npm install`
4. ✅ Ejecutar `npm run db:init`
5. ✅ Probar con `npm run dev`

¡Tu base de datos MySQL está lista para StamentAI! 🚀
