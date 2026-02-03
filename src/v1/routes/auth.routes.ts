import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

router.post('/signup', AuthController.signup);
router.post('/login', AuthController.login);
router.post('/google', AuthController.googleAuth);  // Google OAuth
router.post('/forgot-password', AuthController.forgotPassword);
router.post('/reset-password', AuthController.resetPassword);

router.patch('/profile', authenticate, AuthController.updateProfile);
router.get('/profile', authenticate, AuthController.getProfile);
router.get('/me', authenticate, AuthController.getMe);

// Security endpoints
router.post('/change-password', authenticate, AuthController.changePassword);
router.post('/delete-account', authenticate, AuthController.deleteAccount);
router.post('/logout', authenticate, AuthController.logout);
router.post('/logout-all', authenticate, AuthController.logoutAll);

export default router;

