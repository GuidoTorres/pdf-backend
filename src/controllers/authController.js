import supabaseService from "../services/supabaseService.js";
import logService from "../services/logService.js";

class AuthController {
  async login(req, res) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ 
          success: false, 
          error: "Email y contraseña son requeridos" 
        });
      }

      // Autenticar con Supabase
      const { data, error } = await supabaseService.supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        await logService.logApiRequest({
          endpoint: '/auth/login',
          method: 'POST',
          status: 401,
          details: { action: 'login_failed', email, error: error.message }
        });
        
        return res.status(401).json({ 
          success: false, 
          error: error.message 
        });
      }

      const { user, session } = data;

      // Obtener información completa del usuario
      const userInfo = await supabaseService.getUserInfo(user.id);

      await logService.logApiRequest({
        userId: user.id,
        endpoint: '/auth/login',
        method: 'POST',
        status: 200,
        details: { action: 'login_success', email }
      });

      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: userInfo.name || user.user_metadata?.name || user.email.split('@')[0],
          ...userInfo
        },
        token: session.access_token
      });

    } catch (error) {
      console.error('[AUTH_CONTROLLER] Login error:', error);
      
      await logService.logApiRequest({
        endpoint: '/auth/login',
        method: 'POST',
        status: 500,
        details: { action: 'login_error', error: error.message }
      });

      res.status(500).json({ 
        success: false, 
        error: "Error interno del servidor" 
      });
    }
  }

  async register(req, res) {
    try {
      const { email, password, name } = req.body;

      if (!email || !password) {
        return res.status(400).json({ 
          success: false, 
          error: "Email y contraseña son requeridos" 
        });
      }

      // Registrar con Supabase
      const { data, error } = await supabaseService.supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name: name || email.split('@')[0]
          }
        }
      });

      if (error) {
        await logService.logApiRequest({
          endpoint: '/auth/register',
          method: 'POST',
          status: 400,
          details: { action: 'register_failed', email, error: error.message }
        });
        
        return res.status(400).json({ 
          success: false, 
          error: error.message 
        });
      }

      const { user, session } = data;

      if (!user) {
        return res.status(400).json({ 
          success: false, 
          error: "Error al crear usuario" 
        });
      }

      // Si hay sesión, el usuario se registró y confirmó automáticamente
      if (session) {
        // Crear perfil de usuario en la base de datos
        await supabaseService.createUserProfile(user.id, {
          name: name || email.split('@')[0],
          email: email
        });

        const userInfo = await supabaseService.getUserInfo(user.id);

        await logService.logApiRequest({
          userId: user.id,
          endpoint: '/auth/register',
          method: 'POST',
          status: 201,
          details: { action: 'register_success', email }
        });

        res.status(201).json({
          success: true,
          user: {
            id: user.id,
            email: user.email,
            name: name || email.split('@')[0],
            ...userInfo
          },
          token: session.access_token
        });
      } else {
        // Usuario creado pero necesita confirmar email
        await logService.logApiRequest({
          endpoint: '/auth/register',
          method: 'POST',
          status: 201,
          details: { action: 'register_pending_confirmation', email }
        });

        res.status(201).json({
          success: true,
          message: "Usuario registrado. Por favor, confirma tu email para continuar.",
          requiresConfirmation: true
        });
      }

    } catch (error) {
      console.error('[AUTH_CONTROLLER] Register error:', error);
      
      await logService.logApiRequest({
        endpoint: '/auth/register',
        method: 'POST',
        status: 500,
        details: { action: 'register_error', error: error.message }
      });

      res.status(500).json({ 
        success: false, 
        error: "Error interno del servidor" 
      });
    }
  }

  async googleCallback(req, res) {
    try {
      const { supabaseToken, user } = req.body;

      if (!supabaseToken || !user) {
        return res.status(400).json({ 
          success: false, 
          error: "Token de Supabase y datos de usuario son requeridos" 
        });
      }

      // Verificar el token con Supabase
      const { data: { user: verifiedUser }, error } = await supabaseService.supabase.auth.getUser(supabaseToken);

      if (error || !verifiedUser) {
        await logService.logApiRequest({
          endpoint: '/auth/google-callback',
          method: 'POST',
          status: 401,
          details: { action: 'google_auth_failed', error: error?.message }
        });
        
        return res.status(401).json({ 
          success: false, 
          error: "Token de Google inválido" 
        });
      }

      // Verificar si el usuario ya existe en nuestra base de datos
      let userInfo = await supabaseService.getUserInfo(verifiedUser.id);

      // Si no existe, crear el perfil
      if (!userInfo || Object.keys(userInfo).length === 0) {
        await supabaseService.createUserProfile(verifiedUser.id, {
          name: verifiedUser.user_metadata?.full_name || verifiedUser.user_metadata?.name || verifiedUser.email.split('@')[0],
          email: verifiedUser.email
        });
        
        userInfo = await supabaseService.getUserInfo(verifiedUser.id);
      }

      await logService.logApiRequest({
        userId: verifiedUser.id,
        endpoint: '/auth/google-callback',
        method: 'POST',
        status: 200,
        details: { action: 'google_auth_success', email: verifiedUser.email }
      });

      res.json({
        success: true,
        user: {
          id: verifiedUser.id,
          email: verifiedUser.email,
          name: userInfo.name || verifiedUser.user_metadata?.full_name || verifiedUser.user_metadata?.name || verifiedUser.email.split('@')[0],
          ...userInfo
        },
        token: supabaseToken
      });

    } catch (error) {
      console.error('[AUTH_CONTROLLER] Google callback error:', error);
      
      await logService.logApiRequest({
        endpoint: '/auth/google-callback',
        method: 'POST',
        status: 500,
        details: { action: 'google_auth_error', error: error.message }
      });

      res.status(500).json({ 
        success: false, 
        error: "Error interno del servidor" 
      });
    }
  }

  async logout(req, res) {
    try {
      const token = req.headers.authorization?.split(" ")[1];
      
      if (token) {
        // Invalidar sesión en Supabase
        await supabaseService.supabase.auth.admin.signOut(token);
      }

      await logService.logApiRequest({
        userId: req.user?.id,
        endpoint: '/auth/logout',
        method: 'POST',
        status: 200,
        details: { action: 'logout_success' }
      });

      res.json({ 
        success: true, 
        message: "Sesión cerrada exitosamente" 
      });

    } catch (error) {
      console.error('[AUTH_CONTROLLER] Logout error:', error);
      
      res.status(500).json({ 
        success: false, 
        error: "Error al cerrar sesión" 
      });
    }
  }

  async getCurrentUser(req, res) {
    try {
      const userInfo = await supabaseService.getUserInfo(req.user.id);

      await logService.logApiRequest({
        userId: req.user.id,
        endpoint: '/auth/me',
        method: 'GET',
        status: 200,
        details: { action: 'get_current_user' }
      });

      res.json({
        success: true,
        user: {
          id: req.user.id,
          email: req.user.email,
          name: userInfo.name || req.user.user_metadata?.name || req.user.email.split('@')[0],
          ...userInfo
        }
      });

    } catch (error) {
      console.error('[AUTH_CONTROLLER] Get current user error:', error);
      
      res.status(500).json({ 
        success: false, 
        error: "Error al obtener información del usuario" 
      });
    }
  }
}

export default new AuthController();