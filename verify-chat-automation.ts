import 'dotenv/config';
import { EventService } from './src/v1/services/event.service';
import { BookingService } from './src/v1/services/booking.service';
import { prisma } from './src/v1/config/database';
import { EventCategory, EventPrivacy, TicketType } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

async function verifyChatAutomation() {
    console.log('🧪 Verifying Chat Automation...');
    let eventId: string | undefined;
    let userId: string | undefined;

    try {
        // 1. Create a dummy user (Organizer)
        const organizer = await prisma.user.create({
            data: {
                email: `organizer-${Date.now()}@test.com`,
                passwordHash: 'hash',
                displayName: 'Chat Automation Organizer',
                isVerified: true
            }
        });
        console.log(`Created Organizer: ${organizer.id}`);

        // 2. Create an event
        console.log('Creating Event...');
        const event = await EventService.create(organizer.id, {
            title: `Chat Auto Test ${Date.now()}`,
            description: 'Testing chat automation',
            category: EventCategory.MUSIC,
            privacy: EventPrivacy.PUBLIC,
            location: { type: 'ONLINE', onlineUrl: 'http://test.com' },
            schedule: {
                startDate: new Date(Date.now() + 86400000).toISOString(),
                endDate: new Date(Date.now() + 172800000).toISOString(),
                startTime: '10:00',
                endTime: '12:00',
                timezone: 'UTC'
            },
            media: { coverImage: 'http://test.com/image.jpg' },
            tickets: [{
                name: 'General Admission',
                type: TicketType.PAID,
                price: 0, // Free for instant confirmation
                currency: 'USD',
                quantity: 100
            }]
        });
        eventId = event.id;
        console.log(`Created Event: ${eventId}`);

        // 3. Verify Chat exists
        const chat = await prisma.eventChat.findUnique({
            where: { eventId },
            include: { _count: { select: { members: true } } }
        });

        if (chat) {
            console.log(`✅ Chat auto-created: ${chat.id}`);
            // Verify organizer is a member (ORGANIZER role)
            const membership = await prisma.chatMember.findUnique({
                where: { chatId_userId: { chatId: chat.id, userId: organizer.id } }
            });
            if (membership && membership.role === 'ORGANIZER') {
                console.log('✅ Organizer added to chat with role ORGANIZER');
            } else {
                console.error('❌ Organizer NOT found in chat or wrong role');
            }
        } else {
            console.error('❌ Chat NOT created for event');
        }

        // 4. Create another user (Attendee)
        const attendeeUser = await prisma.user.create({
            data: {
                email: `attendee-${Date.now()}@test.com`,
                passwordHash: 'hash',
                displayName: 'Chat Auto Attendee',
                isVerified: true
            }
        });
        userId = attendeeUser.id;
        console.log(`Created Attendee User: ${userId}`);

        // 5. Book a ticket
        console.log('Booking Ticket...');
        const ticketTypeId = event.tickets[0].id;
        const orderInit = await BookingService.initiateOrder(userId, eventId, [
            { ticketTypeId, quantity: 1 }
        ]);

        console.log(`Order Initiated: ${orderInit.id}`);

        // 6. Confirm Order
        await BookingService.confirmOrder(orderInit.id, userId);
        console.log('Order Confirmed');

        // 7. Verify Attendee added to chat
        if (chat) {
            const member = await prisma.chatMember.findUnique({
                where: { chatId_userId: { chatId: chat.id, userId } }
            });

            if (member) {
                console.log(`✅ Attendee auto-added to chat: ${member.id} (Role: ${member.role})`);
            } else {
                console.error('❌ Attendee NOT added to chat');
            }
        }

    } catch (error: any) {
        console.error('❌ Verification Failed:', error);
        require('fs').writeFileSync('verify-chat-error.json', JSON.stringify({ message: error.message, stack: error.stack, error }, null, 2));
    } finally {
        // Cleanup
        if (eventId) {
            // Delete chat members first
            const chat = await prisma.eventChat.findUnique({ where: { eventId } });
            if (chat) {
                await prisma.chatMessage.deleteMany({ where: { chatId: chat.id } });
                await prisma.chatMember.deleteMany({ where: { chatId: chat.id } });
                await prisma.eventChat.delete({ where: { id: chat.id } });
            }
            await EventService.delete(eventId, (await prisma.event.findUnique({ where: { id: eventId } }))!.organizerId); // This deletes tickets too
        }
        // Cleanup users? Maybe leave them or complex cleanup
        await prisma.$disconnect();
    }
}

verifyChatAutomation();
