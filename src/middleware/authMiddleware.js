import supabaseService from "../services/supabaseService.js";

const authMiddleware = async (req, res, next) => {
  try {
    // console.log('[AUTH_MIDDLEWARE] Processing authentication...');
    
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      // console.log('[AUTH_MIDDLEWARE] No token provided');
      return res.status(401).json({ error: "Token no proporcionado" });
    }

    // console.log('[AUTH_MIDDLEWARE] Token found, validating session...');
    const user = await supabaseService.validateSession(token);
    // console.log('[AUTH_MIDDLEWARE] Session validated for user:', user.id);
    
    req.user = user;
    next();
  } catch (error) {
    // console.log('[AUTH_MIDDLEWARE] Authentication failed:', error.message);
    res.status(401).json({ error: "No autorizado" });
  }
};

export default authMiddleware;