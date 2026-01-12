import { Router, type Request,type Response } from 'express';
import { db } from './db.js'; // Your Drizzle DB instance
import { chatbots, chatbotOptions, conversationStates } from './chatbot_schema.js';
import { eq, and } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import pkg from 'whatsapp-web.js';
import 'dotenv';

const { MessageMedia } = pkg;

const router = Router();

// Helper function to generate unique IDs
function generateId(prefix: string = ''): string {
  return prefix + randomBytes(8).toString('hex');
}

// Normalize greeting messages
function isGreeting(message: string): boolean {
  const greetings = ['hi', 'hello', 'hey', 'hii', 'hiii', 'hiiii', 'helo', 'hola'];
  const normalized = message.toLowerCase().trim();
  return greetings.includes(normalized);
}

// Handle incoming messages for chatbot
export async function handleChatbotMessage(
  userId: string,
  message: any,
  client: any
) {
  try {
    // Ignore messages sent by the bot itself
    // if (message.fromMe) return;

    const chatId = message.from;
    const messageBody = message.body?.trim();

    if (!messageBody) return;

    // Check if chatbot is active for this userId
    const chatbot = await db
      .select()
      .from(chatbots)
      .where(and(eq(chatbots.userId, userId), eq(chatbots.isActive, true)))
      .limit(1);

    if (!chatbot || chatbot.length === 0) {
      console.log(`No active chatbot for userId: ${userId}`);
      return;
    }

    const activeChatbot = chatbot[0];
    if(!activeChatbot) return;
    // Check if it's a greeting
    if (isGreeting(messageBody)) {
      await message.reply(activeChatbot.welcomeMessage);
      
      // Update conversation state
      await db
        .insert(conversationStates)
        .values({
          id: generateId('conv_'),
          userId,
          chatId,
          lastMessageTime: new Date(),
        })
        .onConflictDoUpdate({
          target: [conversationStates.chatId, conversationStates.userId],
          set: {
            lastMessageTime: new Date(),
          },
        });
      
      return;
    }

    // Check if message matches any option key
    const options = await db
      .select()
      .from(chatbotOptions)
      .where(eq(chatbotOptions.chatbotId, activeChatbot.id))
      .orderBy(chatbotOptions.order);

    const matchedOption = options.find(
      (opt) => opt.optionKey.toLowerCase() === messageBody.toLowerCase()
    );

    if (matchedOption) {
      // Send text answer
      if (matchedOption.answer) {
        await message.reply(matchedOption.answer);
      }

      // Send media if available
      if (matchedOption.mediaUrl) {
        try {
          const response = await fetch(matchedOption.mediaUrl);
          if (!response.ok) {
            throw new Error(`Failed to fetch media: ${response.statusText}`);
          }

          const buffer = await response.arrayBuffer();
          const base64 = Buffer.from(buffer).toString('base64');
          const mimeType = response.headers.get('content-type') || 'image/jpeg';

          const media = new MessageMedia(mimeType, base64);
          await client.sendMessage(chatId, media, {
            caption: `${matchedOption.optionLabel}`,
          });
        } catch (error) {
          console.error('Error sending media:', error);
        }
      }

      // Update conversation state
      await db
        .insert(conversationStates)
        .values({
          id: generateId('conv_'),
          userId,
          chatId,
          lastMessageTime: new Date(),
        })
        .onConflictDoUpdate({
          target: [conversationStates.chatId, conversationStates.userId],
          set: {
            lastMessageTime: new Date(),
          },
        });
    }
    // If no match, don't reply (as per requirement #4)
  } catch (error) {
    console.error('Error in chatbot handler:', error);
  }
}

// API ENDPOINTS

// Create or update chatbot
router.post('/chatbot', async (req: Request, res: Response) => {
  try {
    const { userId, welcomeMessage, isActive } = req.body;

    if (!userId || !welcomeMessage) {
      return res.status(400).json({
        error: 'userId and welcomeMessage are required',
      });
    }

    // Check if chatbot exists
    const existing = await db
      .select()
      .from(chatbots)
      .where(eq(chatbots.userId, userId))
      .limit(1);

    let chatbot;
    if (existing && existing.length > 0) {
      // Update existing
      chatbot = await db
        .update(chatbots)
        .set({
          welcomeMessage,
          isActive: isActive !== undefined ? isActive : true,
          updatedAt: new Date(),
        })
        .where(eq(chatbots.userId, userId))
        .returning();
    } else {
      // Create new
      chatbot = await db
        .insert(chatbots)
        .values({
          id: generateId('bot_'),
          userId,
          welcomeMessage,
          isActive: isActive !== undefined ? isActive : true,
        })
        .returning();
    }

    res.json({
      success: true,
      chatbot: chatbot[0],
      message: existing.length > 0 ? 'Chatbot updated' : 'Chatbot created',
    });
  } catch (error: any) {
    console.error('Error creating/updating chatbot:', error);
    res.status(500).json({
      error: 'Failed to create/update chatbot',
      details: error.message,
    });
  }
});

// Get chatbot by userId
router.get('/chatbot/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const chatbot = await db
      .select()
      .from(chatbots)
      .where(eq(chatbots.userId, userId!))
      .limit(1);

    if (!chatbot || chatbot.length === 0) {
      return res.status(404).json({
        error: 'Chatbot not found',
      });
    }

    const options = await db
      .select()
      .from(chatbotOptions)
      .where(eq(chatbotOptions.chatbotId, chatbot[0]!.id))
      .orderBy(chatbotOptions.order);

    res.json({
      chatbot: chatbot[0],
      options,
    });
  } catch (error: any) {
    console.error('Error fetching chatbot:', error);
    res.status(500).json({
      error: 'Failed to fetch chatbot',
      details: error.message,
    });
  }
});

// Add or update chatbot option
router.post('/chatbot/option', async (req: Request, res: Response) => {
  try {
    const {
      userId,
      optionKey,
      optionLabel,
      answer,
      mediaUrl,
      mediaType,
      order,
    } = req.body;

    if (!userId || !optionKey || !optionLabel || !answer) {
      return res.status(400).json({
        error: 'userId, optionKey, optionLabel, and answer are required',
      });
    }

    // Get chatbot
    const chatbot = await db
      .select()
      .from(chatbots)
      .where(eq(chatbots.userId, userId))
      .limit(1);

    if (!chatbot || chatbot.length === 0) {
      return res.status(404).json({
        error: 'Chatbot not found. Create a chatbot first.',
      });
    }

    const chatbotId = chatbot[0]!.id;

    // Check if option exists
    const existing = await db
      .select()
      .from(chatbotOptions)
      .where(
        and(
          eq(chatbotOptions.chatbotId, chatbotId),
          eq(chatbotOptions.optionKey, optionKey)
        )
      )
      .limit(1);

    let option;
    if (existing && existing.length > 0) {
      // Update
      option = await db
        .update(chatbotOptions)
        .set({
          optionLabel,
          answer,
          mediaUrl: mediaUrl || null,
          mediaType: mediaType || null,
          order: order || 0,
          updatedAt: new Date(),
        })
        .where(eq(chatbotOptions.id, existing[0]!.id))
        .returning();
    } else {
      // Create
      option = await db
        .insert(chatbotOptions)
        .values({
          id: generateId('opt_'),
          chatbotId,
          optionKey,
          optionLabel,
          answer,
          mediaUrl: mediaUrl || null,
          mediaType: mediaType || null,
          order: order || 0,
        })
        .returning();
    }

    res.json({
      success: true,
      option: option[0],
      message: existing.length > 0 ? 'Option updated' : 'Option created',
    });
  } catch (error: any) {
    console.error('Error creating/updating option:', error);
    res.status(500).json({
      error: 'Failed to create/update option',
      details: error.message,
    });
  }
});

// Delete chatbot option
router.delete('/chatbot/option/:userId/:optionKey', async (req: Request, res: Response) => {
  try {
    const { userId, optionKey } = req.params;

    const chatbot = await db
      .select()
      .from(chatbots)
      .where(eq(chatbots.userId, userId!))
      .limit(1);

    if (!chatbot || chatbot.length === 0) {
      return res.status(404).json({
        error: 'Chatbot not found',
      });
    }

    await db
      .delete(chatbotOptions)
      .where(
        and(
          eq(chatbotOptions.chatbotId, chatbot[0]!.id),
          eq(chatbotOptions.optionKey, optionKey!)
        )
      );

    res.json({
      success: true,
      message: 'Option deleted',
    });
  } catch (error: any) {
    console.error('Error deleting option:', error);
    res.status(500).json({
      error: 'Failed to delete option',
      details: error.message,
    });
  }
});

// Toggle chatbot active status
router.patch('/chatbot/:userId/toggle', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { isActive } = req.body;

    const chatbot = await db
      .update(chatbots)
      .set({
        isActive,
        updatedAt: new Date(),
      })
      .where(eq(chatbots.userId, userId!))
      .returning();

    if (!chatbot || chatbot.length === 0) {
      return res.status(404).json({
        error: 'Chatbot not found',
      });
    }

    res.json({
      success: true,
      chatbot: chatbot[0],
      message: `Chatbot ${isActive ? 'activated' : 'deactivated'}`,
    });
  } catch (error: any) {
    console.error('Error toggling chatbot:', error);
    res.status(500).json({
      error: 'Failed to toggle chatbot',
      details: error.message,
    });
  }
});

// Delete entire chatbot
router.delete('/chatbot/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    await db.delete(chatbots).where(eq(chatbots.userId, userId!));

    res.json({
      success: true,
      message: 'Chatbot deleted',
    });
  } catch (error: any) {
    console.error('Error deleting chatbot:', error);
    res.status(500).json({
      error: 'Failed to delete chatbot',
      details: error.message,
    });
  }
});

export default router;