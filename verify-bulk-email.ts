import 'dotenv/config';
import { ManageService } from './src/v1/services/manage.service';
import { prisma } from './src/v1/config/database';

async function testBulkEmail() {
    console.log('🧪 Testing Bulk Email Service...');

    try {
        // 1. Find an event and its organizer
        const event = await prisma.event.findFirst({
            include: { organizer: true }
        });

        if (!event) {
            console.log('No event found to test with.');
            return;
        }

        const organizerId = event.organizerId;
        const eventId = event.id;

        // 2. Ensure we have at least one confirmed attendee for this event
        const testEmailAddress = process.env.TEST_EMAIL || 'test@example.com';

        // Find a ticket for the event
        const ticket = await prisma.ticket.findFirst({ where: { eventId } });
        if (!ticket) {
            console.log(`No ticket found for event ${event.title}.`);
            return;
        }

        // Find or create a confirmed order
        let order = await prisma.bookingOrder.findFirst({
            where: { eventId, status: 'CONFIRMED' }
        });

        if (!order) {
            order = await prisma.bookingOrder.create({
                data: {
                    eventId,
                    userId: organizerId,
                    total: 0,
                    status: 'CONFIRMED',
                    paymentStatus: 'PAID'
                }
            });
        }

        // Create attendee if none exists
        let attendee = await prisma.attendee.findFirst({
            where: { orderId: order.id }
        });

        if (!attendee) {
            attendee = await prisma.attendee.create({
                data: {
                    orderId: order.id,
                    ticketId: ticket.id,
                    name: 'Test Attendee',
                    email: testEmailAddress,
                    ticketCode: 'BK-' + Math.random().toString(36).substring(7).toUpperCase()
                }
            });
        } else {
            // Update existing attendee email
            await prisma.attendee.update({
                where: { id: attendee.id },
                data: { email: testEmailAddress }
            });
        }

        console.log(`Preparing to send bulk email for "${event.title}" to ${testEmailAddress}...`);

        // 3. Trigger bulk email
        const result = await ManageService.sendBulkEmail(
            eventId,
            organizerId,
            'all',
            undefined,
            'Schedule Update',
            'Hello! The event schedule has been updated. Please check the website for details.'
        );

        console.log('✅ Bulk Email Result:', result);
        require('fs').writeFileSync('bulk-email-results.json', JSON.stringify(result, null, 2));

    } catch (error: any) {
        console.error('❌ Error during testing:', error.message || error);
        if (error.stack) console.error(error.stack);
    }
}

testBulkEmail()
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
    });
