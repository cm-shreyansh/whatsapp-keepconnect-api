import { Client } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";

const client = new Client({});

client.once("ready", () => {
  console.log("Bhaatsapp iz ready biraather!");
});

client.on("qr", (qr) => {
  console.log("QR RECEIVED, HELL YEAA!", qr);
  qrcode.generate(qr, { small: true });
});

client.on("message_create", (message) => {
  console.log("---- Incoming Message Dude ----");
  console.log({
    id: message.id?._serialized, // unique message id
    from: message.from, // sender jid
    author: message.author, // if group message → actual sender
    fromMe: message.fromMe, // was it sent by you?
    to: message.to, // who it is targeted to
    body: message.body, // message text
    type: message.type, // chat, image, buttons, etc
    hasMedia: message.hasMedia,
    timestamp: message.timestamp, // unix seconds
    isGroupMsg: !!message.author, // quick flag
    mentionedIds: message.mentionedIds,
    groupMentions: message.groupMentions,
  });
  if (message.body === "Kyu ree") {
    // reply back "pong" directly to the message
    message.reply("At the age of studying people are dying for ______");
  }
  if (message.body === "Hey") {
    message.reply("Yea Yea Yea");
  } 
});

client.initialize();
