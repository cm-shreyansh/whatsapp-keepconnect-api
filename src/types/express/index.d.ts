import express from "express";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        name: string;
        email: string;
        emailVerifiedAt: Date | null;
        password: string;
        rememberToken: string | null;
        chatbotId: string | null;
        createdAt: Date | null;
        updatedAt: Date | null;
      }
    }
  }
}