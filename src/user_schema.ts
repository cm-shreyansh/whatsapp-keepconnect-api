import { 
  mysqlTable, 
  serial, 
  text, 
  varchar, 
  timestamp, 
  int, 
  index, 
  foreignKey 
} from "drizzle-orm/mysql-core";

// --- Users Table ---
export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  emailVerifiedAt: timestamp("email_verified_at", { mode: 'date' }),
  password: varchar("password", { length: 255 }).notNull(),
  rememberToken: varchar("remember_token", { length: 100 }),
  chatbotId: varchar("chatbot_id", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});