# Solución para MySQL Workbench - Problemas de Contraseña

## Problema Común

MySQL Workbench no puede conectar por problemas de autenticación o contraseña olvidada.

## Soluciones Paso a Paso

### Opción 1: Resetear Contraseña de Root (Recomendado)

#### En Windows:

1. **Detener MySQL**

   ```cmd
   net stop mysql80
   ```

2. **Iniciar MySQL en modo seguro**

   ```cmd
   mysqld --skip-grant-tables --skip-networking
   ```

3. **En otra terminal, conectar sin contraseña**

   ```cmd
   mysql -u root
   ```

4. **Cambiar contraseña**

   ```sql
   USE mysql;
   ALTER USER 'root'@'localhost' IDENTIFIED BY 'nueva_password';
   FLUSH PRIVILEGES;
   EXIT;
   ```

5. **Reiniciar MySQL normalmente**
   ```cmd
   net start mysql80
   ```

#### En macOS:

1. **Detener MySQL**

   ```bash
   sudo /usr/local/mysql/support-files/mysql.server stop
   ```

2. **Iniciar en modo seguro**

   ```bash
   sudo mysqld_safe --skip-grant-tables --skip-networking &
   ```

3. **Conectar y cambiar contraseña**

   ```bash
   mysql -u root
   ```

   ```sql
   ALTER USER 'root'@'localhost' IDENTIFIED BY 'nueva_password';
   FLUSH PRIVILEGES;
   EXIT;
   ```

4. **Reiniciar MySQL**
   ```bash
   sudo /usr/local/mysql/support-files/mysql.server start
   ```

#### En Linux:

1. **Detener MySQL**

   ```bash
   sudo systemctl stop mysql
   ```

2. **Iniciar en modo seguro**

   ```bash
   sudo mysqld_safe --skip-grant-tables --skip-networking &
   ```

3. **Conectar y cambiar contraseña**

   ```bash
   mysql -u root
   ```

   ```sql
   ALTER USER 'root'@'localhost' IDENTIFIED BY 'nueva_password';
   FLUSH PRIVILEGES;
   EXIT;
   ```

4. **Reiniciar MySQL**
   ```bash
   sudo systemctl start mysql
   ```

### Opción 2: Usar Usuario Alternativo

Si no puedes resetear root, crea un nuevo usuario:

1. **Conectar como root (si funciona)**

   ```bash
   mysql -u root -p
   ```

2. **Ejecutar el script de solución**

   ```bash
   mysql -u root -p < database/fix-mysql-password.sql
   ```

3. **O crear manualmente**
   ```sql
   CREATE USER 'admin'@'localhost' IDENTIFIED BY 'admin123';
   GRANT ALL PRIVILEGES ON *.* TO 'admin'@'localhost' WITH GRANT OPTION;
   FLUSH PRIVILEGES;
   ```

### Opción 3: Reinstalar MySQL (Última opción)

Si nada funciona:

#### Windows:

1. Desinstalar MySQL desde Panel de Control
2. Eliminar carpeta `C:\ProgramData\MySQL`
3. Reinstalar desde https://dev.mysql.com/downloads/mysql/

#### macOS:

```bash
brew uninstall mysql
brew cleanup
brew install mysql
brew services start mysql
mysql_secure_installation
```

#### Linux:

```bash
sudo apt remove --purge mysql-server mysql-client mysql-common
sudo apt autoremove
sudo apt autoclean
sudo rm -rf /var/lib/mysql
sudo apt install mysql-server
```

## Configurar MySQL Workbench

### 1. Crear Nueva Conexión

- **Connection Name**: StamentAI Local
- **Hostname**: 127.0.0.1 o localhost
- **Port**: 3306
- **Username**: root (o admin si creaste uno nuevo)
- **Password**: [tu nueva contraseña]

### 2. Probar Conexión

Hacer clic en "Test Connection"

### 3. Si funciona, ejecutar setup

```sql
-- Copiar y pegar el contenido de database/setup.sql
-- O ejecutar línea por línea
```

## Credenciales Sugeridas

### Para desarrollo local:

```
Usuario: root
Password: root123

O

Usuario: admin
Password: admin123

O

Usuario: stamentai_user
Password: StamentAI2024!
```

## Configurar .env

Una vez que tengas MySQL funcionando:

```env
DB_HOST=localhost
DB_PORT=3306
DB_NAME=stamentai
DB_USER=root
DB_PASSWORD=root123
```

## Verificar que Funciona

1. **Conectar desde terminal**

   ```bash
   mysql -u root -p
   ```

2. **Mostrar bases de datos**

   ```sql
   SHOW DATABASES;
   ```

3. **Crear base de datos de prueba**
   ```sql
   CREATE DATABASE test_connection;
   DROP DATABASE test_connection;
   ```

## Troubleshooting Común

### Error: "Access denied for user 'root'@'localhost'"

- La contraseña está mal o el usuario no existe
- Usar el método de reset de contraseña

### Error: "Can't connect to MySQL server"

- MySQL no está corriendo
- Verificar puerto (3306 por defecto)
- Verificar firewall

### Error: "Authentication plugin 'caching_sha2_password'"

```sql
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'tu_password';
```

### Error en Workbench: "SSL connection error"

- En la conexión, ir a "SSL" tab
- Cambiar "Use SSL" a "No"

¿Con cuál de estas opciones quieres empezar? Te puedo guiar paso a paso según tu sistema operativo.
