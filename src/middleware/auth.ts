import jwt from "jsonwebtoken";
import { db } from '../db.js';
import { eq, and } from 'drizzle-orm';
import { type Request, type Response, type NextFunction} from "express";
import { users } from '../user_schema.js';


export async function auth (req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    if(!authHeader) {
        return res.status(401).json({message: "Unauthorized"});
    }
    
    const token = authHeader.split(' ')[1];
    if(token) {
        try {
            console.log("THIS IS THE TOKEN IS THE");
            console.log(process.env.JWT_SECRET)
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "temp_jwt_token_bro");
            if(decoded && typeof decoded != "string") {
                const userId = decoded.sub;
                console.log("HERE IS THE GREATEST TOKEN OF PLANET EARTH YEAAA BOI");
                console.log(decoded);
                const user = await db
                    .select()
                    .from(users)
                    .where(eq(users.id, parseInt(userId!)))
                    .limit(1);
                console.log(user);
                if(user.length) {
                    console.log("SOMEHOW HERE I AM");
                    req.user = user[0];
                    next();
                } else {
                    return res.status(404).json({message: "User not found"})
                }
            }
        } catch(e : any) {
            console.log("Error occured while verifiying token");
            console.log(e?.message!);
            console.log(e);
            return res.status(400).json({message: "Error occured while verifying."})
        }
    }
}