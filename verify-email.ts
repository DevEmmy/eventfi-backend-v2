import 'dotenv/config';
import { EmailService } from './src/v1/services/email.service';

/**
 * Verification Script to test Email Service
 */
async function testEmail() {
    console.log('🧪 Testing Email Service...');

    const testEmailAddress =  'eolaosebikan60@gmail.com';

    console.log(`Sending test welcome email to ${testEmailAddress}...`);
    const result = await EmailService.sendWelcomeEmail(testEmailAddress, 'Test User');

    if (result) {
        console.log('✅ Success! Check console for Ethereal link if using default config.');
    } else {
        console.log('❌ Failed to send email.');
    }
}

testEmail().catch(console.error);
