import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
    signupSchema,
    loginSchema,
    googleAuthSchema,
    forgotPasswordSchema,
    resetPasswordSchema,
    updateProfileSchema,
    changePasswordSchema,
    deleteAccountSchema,
} from '../validations/auth.schema';

const router = Router();

router.post('/signup', validate(signupSchema), AuthController.signup);
router.post('/login', validate(loginSchema), AuthController.login);
router.post('/google', validate(googleAuthSchema), AuthController.googleAuth);
router.post('/forgot-password', validate(forgotPasswordSchema), AuthController.forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), AuthController.resetPassword);
router.post('/verify-email', AuthController.verifyEmail);
router.post('/resend-verification', authenticate, AuthController.resendVerification);

router.patch('/profile', authenticate, validate(updateProfileSchema), AuthController.updateProfile);
router.get('/profile', authenticate, AuthController.getProfile);
router.get('/me', authenticate, AuthController.getMe);

// Security endpoints
router.post('/change-password', authenticate, validate(changePasswordSchema), AuthController.changePassword);
router.post('/delete-account', authenticate, validate(deleteAccountSchema), AuthController.deleteAccount);
router.post('/logout', authenticate, AuthController.logout);
router.post('/logout-all', authenticate, AuthController.logoutAll);

export default router;

