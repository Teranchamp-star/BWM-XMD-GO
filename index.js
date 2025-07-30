const express = require("express");
const bodyParser = require("body-parser");
const { makeWASocket, useSingleFileAuthState } = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const fs = require("fs");
const path = require("path");
const qrcode = require("qrcode-terminal");

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Load session
const { state, saveState } = useSingleFileAuthState("./session.json");

let sock;

async function startSock() {
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true, // shows QR in Render logs (1st time)
  });

  sock.ev.on("creds.update", saveState);

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.key.fromMe && msg.message) {
      await sock.sendMessage(msg.key.remoteJid, { text: "saved" });
    }
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("connection closed due to", lastDisconnect.error, ", reconnecting", shouldReconnect);
      if (shouldReconnect) startSock();
    } else if (connection === "open") {
      console.log("✅ WhatsApp connected!");
    }
  });
}

startSock();

// POST endpoint to send messages to group members
app.post("/start", async (req, res) => {
  const { groupName, message1, message2, message3 } = req.body;

  if (!groupName || !message1 || !message2 || !message3) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  try {
    const groups = await sock.groupFetchAllParticipating();
    const group = Object.values(groups).find(g => g.subject.toLowerCase() === groupName.toLowerCase());

    if (!group) {
      return res.status(404).json({ error: "Group not found." });
    }

    const groupMetadata = await sock.groupMetadata(group.id);
    const members = groupMetadata.participants;

    const messages = [message1, message2, message3];

    for (const member of members) {
      const jid = member.id;
      const message = messages[Math.floor(Math.random() * messages.length)];
      await sock.sendMessage(jid, { text: message });
      console.log(`✅ Sent to $
