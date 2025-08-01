import supabaseService from "../services/supabaseService.js";
import logService from "../services/logService.js";

class UserController {
  async getUserInfo(req, res) {
    try {
      const userInfo = await supabaseService.getUserInfo(req.user.id);

      await logService.logApiRequest({
        userId: req.user.id,
        endpoint: '/user-info',
        method: 'GET',
        status: 200,
        details: { action: 'get_user_info' }
      });

      res.json(userInfo);
    } catch (error) {
      console.error('Error getting user info:', error);

      await logService.logApiRequest({
        userId: req.user?.id,
        endpoint: '/user-info',
        method: 'GET',
        status: 500,
        error: error.message,
        details: { action: 'get_user_info' }
      });

      res.status(500).json({
        error: 'Error al obtener información del usuario',
        details: error.message
      });
    }
  }

  async getUserProfile(req, res) {
    try {
      const userProfile = await supabaseService.getUserProfile(req.user.id);
      await logService.logApiRequest({
        userId: req.user.id,
        endpoint: '/user/profile',
        method: 'GET',
        status: 200,
        details: { action: 'get_user_profile' }
      });
      res.json(userProfile);
    } catch (error) {
      console.error('Error getting user profile:', error);
      await logService.logApiRequest({
        userId: req.user?.id,
        endpoint: '/user/profile',
        method: 'GET',
        status: 500,
        error: error.message,
        details: { action: 'get_user_profile' }
      });
      res.status(500).json({ error: 'Error al obtener el perfil del usuario', details: error.message });
    }
  }

  async updateUserProfile(req, res) {
    try {
      const updatedProfile = await supabaseService.updateUserProfile(req.user.id, req.body);
      await logService.logApiRequest({
        userId: req.user.id,
        endpoint: '/user/profile',
        method: 'PUT',
        status: 200,
        details: { action: 'update_user_profile', payload: req.body }
      });
      res.json(updatedProfile);
    } catch (error) {
      console.error('Error updating user profile:', error);
      await logService.logApiRequest({
        userId: req.user?.id,
        endpoint: '/user/profile',
        method: 'PUT',
        status: 500,
        error: error.message,
        details: { action: 'update_user_profile', payload: req.body }
      });
      res.status(500).json({ error: 'Error al actualizar el perfil del usuario', details: error.message });
    }
  }

  async getConversions(req, res) {
    try {
      const conversions = await supabaseService.getConversions(req.user.id);
      await logService.logApiRequest({
        userId: req.user.id,
        endpoint: '/user/conversions',
        method: 'GET',
        status: 200,
        details: { action: 'get_user_conversions' }
      });
      res.json(conversions);
    } catch (error) {
      console.error('Error getting user conversions:', error); // Log the full error object
      await logService.logApiRequest({
        userId: req.user?.id,
        endpoint: '/user/conversions',
        method: 'GET',
        status: 500,
        error: error.message,
        details: { action: 'get_user_conversions' }
      });
      res.status(500).json({ error: 'Error al obtener las conversiones del usuario', details: error.message });
    }
  }
}

export default new UserController();