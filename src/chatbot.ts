import { Router, type Request, type Response } from 'express';
import { db } from './db.js'; // Your Drizzle DB instance
import { chatbots, chatbotOptions, conversationStates } from './chatbot_schema.js';
import { eq, and, asc } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { auth } from "./middleware/auth.js";
import pkg from 'whatsapp-web.js';
import 'dotenv';
import { users } from './user_schema.js';

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

      if(activeChatbot.mediaUrl) {
         const response = await fetch(activeChatbot.mediaUrl);
          if (!response.ok) {
            throw new Error(`Failed to fetch media: ${response.statusText}`);
          }

          const buffer = await response.arrayBuffer();
          const base64 = Buffer.from(buffer).toString('base64');
          const mimeType = response.headers.get('content-type') || 'image/jpeg';

          const media = new MessageMedia(mimeType, base64);
          await client.sendMessage(chatId, media, {
            caption: `${activeChatbot.welcomeMessage}`,
          });
      } else {
        await message.reply(activeChatbot.welcomeMessage);
      }
    
      // Update conversation state - MySQL doesn't support onConflictDoUpdate the same way
      // We need to use INSERT ... ON DUPLICATE KEY UPDATE syntax
      const existingConv = await db
        .select()
        .from(conversationStates)
        .where(
          and(
            eq(conversationStates.chatId, chatId),
            eq(conversationStates.userId, userId)
          )
        )
        .limit(1);

      if (existingConv && existingConv.length > 0) {
        await db
          .update(conversationStates)
          .set({
            lastMessageTime: new Date(),
          })
          .where(eq(conversationStates.id, existingConv[0]!.id));
      } else {
        await db
          .insert(conversationStates)
          .values({
            id: generateId('conv_'),
            userId,
            chatId,
            lastMessageTime: new Date(),
          });
      }
      
      return;
    }

    // Check if message matches any option key
    const options = await db
      .select()
      .from(chatbotOptions)
      .where(eq(chatbotOptions.chatbotId, activeChatbot.id))
      .orderBy(asc(chatbotOptions.order));

    const matchedOption = options.find(
      (opt) => opt.optionKey.toLowerCase() === messageBody.toLowerCase()
    );

    if (matchedOption) {
      // Send text answer
      if (matchedOption.answer && matchedOption.mediaUrl) {
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
            caption: `${matchedOption.answer}`,
          });
        } catch (error) {
          console.error('Error sending media:', error);
        }
      }
      else if (matchedOption.answer) {
        await message.reply(matchedOption.answer);
      }

      // Send media if available
      

      // Update conversation state - MySQL doesn't support onConflictDoUpdate
      const existingConv = await db
        .select()
        .from(conversationStates)
        .where(
          and(
            eq(conversationStates.chatId, chatId),
            eq(conversationStates.userId, userId)
          )
        )
        .limit(1);

      if (existingConv && existingConv.length > 0) {
        await db
          .update(conversationStates)
          .set({
            lastMessageTime: new Date(),
          })
          .where(eq(conversationStates.id, existingConv[0]!.id));
      } else {
        await db
          .insert(conversationStates)
          .values({
            id: generateId('conv_'),
            userId,
            chatId,
            lastMessageTime: new Date(),
          });
      }
    }
    // If no match, don't reply (as per requirement #4)
  } catch (error) {
    console.error('Error in chatbot handler:', error);
  }
}

export async function setChatbotInactive(userId: string) {
   let existing;
   if(userId) {
      existing = await db
        .select()
        .from(chatbots)
        .where(eq(chatbots.userId, userId))
        .limit(1);
   }
    // Check if chatbot exists
    if (existing && existing.length > 0) {
      await db
        .update(chatbots)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(chatbots.id, existing[0]!.id!));
      
      // Fetch updated chatbot if needed
      const chatbot = await db
        .select()
        .from(chatbots)
        .where(eq(chatbots.id, existing[0]!.id!))
        .limit(1);
      
      return chatbot;
    }
}

// API ENDPOINTS

// Create or update chatbot -> creates new chatbot if user doesn't have one, updates existing one, also takes care of whatsapp userId update.
router.post('/chatbot', auth, async (req: Request, res: Response) => {
  try {
    const { userId, welcomeMessage, isActive, mediaUrl } = req.body;
    const { chatbotId } = req.user!;
    const accountUserId = req.user?.id;

    if (!userId || !welcomeMessage) {
      return res.status(400).json({
        error: 'userId and welcomeMessage are required',
      });
    }
    let existing;
    if(chatbotId) {
      existing = await db
        .select()
        .from(chatbots)
        .where(eq(chatbots.id, chatbotId))
        .limit(1);
        
    }
    // Check if chatbot exists
    let chatbot;
    if (existing && existing.length > 0 && chatbotId) {
      await db
        .update(chatbots)
        .set({
          welcomeMessage,
          userId,
          mediaUrl,
          isActive: isActive !== undefined ? isActive : true,
          updatedAt: new Date(),
        })
        .where(eq(chatbots.id, chatbotId));

      // Fetch updated chatbot
      chatbot = await db
        .select()
        .from(chatbots)
        .where(eq(chatbots.id, chatbotId))
        .limit(1);

    } else {
      // Create new
      const newChatbotId = generateId('bot_');
      await db.transaction(async (txn) => {
        // insert
        await txn
          .insert(chatbots)
          .values({
            id: newChatbotId,
            userId,
            welcomeMessage,
            mediaUrl,
            isActive: isActive !== undefined ? isActive : true,
          });
        
        // update
        await txn
          .update(users)
          .set({
            chatbotId: newChatbotId
          })
          .where(eq(users.id, accountUserId!));
      });

      // Fetch created chatbot
      chatbot = await db
        .select()
        .from(chatbots)
        .where(eq(chatbots.id, newChatbotId))
        .limit(1);
    }

   return res.status(200).json({
      success: true,
      chatbot: chatbot![0],
      message: existing && existing.length > 0 ? 'Chatbot updated' : 'Chatbot created',
    });

  } catch (error: any) {
    console.error('Error creating/updating chatbot:', error);
    return res.status(500).json({
      error: 'Failed to create/update chatbot',
      details: error.message,
    });
  }
});

// Get chatbot by userId
router.get('/chatbot', auth, async (req: Request, res: Response) => {
  try {
    const { chatbotId } = req.user!;

    if(!chatbotId) {
      return res.status(200).json({
        chatbot: null,
        options: null,
      })
    }

    const chatbot = await db
      .select()
      .from(chatbots)
      .where(eq(chatbots.id, chatbotId!))
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
      .orderBy(asc(chatbotOptions.optionKey));

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
router.post('/chatbot/option', auth, async (req: Request, res: Response) => {
  try {
    console.log("THIS IS IT BRO");
    const {
      optionKey,
      optionLabel,
      answer,
      mediaUrl,
      mediaType,
      order,
    } = req.body;
    const { chatbotId } = req.user!;
    console.log( 
      optionKey,
      optionLabel,
      answer,
      mediaUrl,
      mediaType,
      order,)
    if ( !optionKey || !optionLabel || !answer) {
      return res.status(400).json({
        error: 'userId, optionKey, optionLabel, and answer are required',
      });
    }

    // Get chatbot
    const chatbot = await db
      .select()
      .from(chatbots)
      .where(eq(chatbots.id, chatbotId!))
      .limit(1);

    if (!chatbot || chatbot.length === 0) {
      return res.status(404).json({
        error: 'Chatbot not found. Create a chatbot first.',
      });
    }

    // Check if option exists
    const existing = await db
      .select()
      .from(chatbotOptions)
      .where(
        and(
          eq(chatbotOptions.chatbotId, chatbotId!),
          eq(chatbotOptions.optionKey, optionKey)
        )
      )
      .limit(1);

    let option;
    if (existing && existing.length > 0) {
      // Update
      await db
        .update(chatbotOptions)
        .set({
          optionLabel,
          answer,
          mediaUrl: mediaUrl || null,
          mediaType: mediaType || null,
          order: order || 0,
          updatedAt: new Date(),
        })
        .where(eq(chatbotOptions.id, existing[0]!.id));

      // Fetch updated option
      option = await db
        .select()
        .from(chatbotOptions)
        .where(eq(chatbotOptions.id, existing[0]!.id))
        .limit(1);
    } else {
      // Create
      const optionId = generateId('opt_');
      await db
        .insert(chatbotOptions)
        .values({
          id: optionId,
          chatbotId: chatbotId!,
          optionKey,
          optionLabel,
          answer,
          mediaUrl: mediaUrl || null,
          mediaType: mediaType || null,
          order: order || 0,
        });

      // Fetch created option
      option = await db
        .select()
        .from(chatbotOptions)
        .where(eq(chatbotOptions.id, optionId))
        .limit(1);
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
      .where(eq(chatbots.userId, userId! as string))
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
          eq(chatbotOptions.optionKey, optionKey! as string)
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

    await db
      .update(chatbots)
      .set({
        isActive,
        updatedAt: new Date(),
      })
      .where(eq(chatbots.userId, userId! as string));

    // Fetch updated chatbot
    const chatbot = await db
      .select()
      .from(chatbots)
      .where(eq(chatbots.userId, userId! as string))
      .limit(1);

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

    await db.delete(chatbots).where(eq(chatbots.userId, userId! as string));

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