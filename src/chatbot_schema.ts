import { mysqlTable, varchar, text, timestamp, int, boolean } from 'drizzle-orm/mysql-core';

export const chatbots = mysqlTable('chatbots', {
  id: varchar('id', { length: 255 }).primaryKey(),
  userId: varchar('user_id', { length: 255 }).notNull().unique(),
  welcomeMessage: text('welcome_message').notNull(),
  mediaUrl: varchar('media_url', { length: 255 }),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const chatbotOptions = mysqlTable('chatbot_options', {
  id: varchar('id', { length: 255 }).primaryKey(),
  chatbotId: varchar('chatbot_id', { length: 255 }).notNull().references(() => chatbots.id, { onDelete: 'cascade' }),
  optionKey: varchar('option_key', { length: 50 }).notNull(), // e.g., "1", "2", "3"
  optionLabel: text('option_label').notNull(), // e.g., "View Services"
  answer: text('answer').notNull(),
  mediaUrl: text('media_url'), // optional image/media URL
  mediaType: varchar('media_type', { length: 50 }), // 'image', 'video', 'document'
  order: int('order').default(0),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// User conversation state to track context
export const conversationStates = mysqlTable('conversation_states', {
  id: varchar('id', { length: 255 }).primaryKey(),
  userId: varchar('user_id', { length: 255 }).notNull(),
  chatId: varchar('chat_id', { length: 255 }).notNull(), // WhatsApp chat ID
  lastMessageTime: timestamp('last_message_time').defaultNow(),
  createdAt: timestamp('created_at').defaultNow(),
});