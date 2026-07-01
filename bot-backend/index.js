const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client: PgClient } = require('pg');
const QRCode = require('qrcode');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
app.use(cors());
app.use(express.json());

const ADMIN_NUMBER = '919996829482@s.whatsapp.net';

const pgClient = new PgClient({
    connectionString: "postgresql://vashu:p--idOQQkxIUPudLXwZ9TQ@copper-orca-28396.j77.aws-ap-south-1.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full"
});
pgClient.connect().catch(err => console.error("DB Connection Error:", err));
pgClient.on('error', err => {
    console.error('Unexpected error on idle client', err);
});

// Auto-create services table
pgClient.query(`
    CREATE TABLE IF NOT EXISTS services (
        id UUID PRIMARY KEY,
        title TEXT,
        description TEXT
    )
`).catch(err => console.error("Error creating services table:", err));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}
app.use('/uploads', express.static(uploadsDir));

let isReady = false;
let isBrowserReadyForPairing = false;
let latestQR = null;
let sock = null;

// Session management for conversational flow
const userSessions = {};

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }), // Suppress huge logs
        generateHighQualityLinkPreview: true,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            isReady = false;
            isBrowserReadyForPairing = true;
            console.log('\n[WhatsApp] Waiting for pairing code or QR connection...');
            try {
                latestQR = await QRCode.toDataURL(qr);
            } catch (err) {
                console.error('Failed to generate QR data URL', err);
            }
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed. Reconnecting:', shouldReconnect);
            isReady = false;
            if (shouldReconnect) {
                connectToWhatsApp();
            } else {
                console.log('Logged out. Clearing auth and restarting...');
                fs.rmSync('auth_info_baileys', { recursive: true, force: true });
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('\n✅ WhatsApp Bot is FULLY Ready and Synced!');
            isReady = true;
            latestQR = null;
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const userId = msg.key.remoteJid;
        if (userId.includes('@g.us')) return; // Ignore group messages

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        const pushname = msg.pushName || userId.split('@')[0];
        
        const reply = async (textMsg) => {
            await sock.sendMessage(userId, { text: textMsg }, { quoted: msg });
        };

        // Auto-register users
        let userRes = await pgClient.query('SELECT * FROM users WHERE id = $1', [userId]);
        let user = userRes.rows[0];

        if (!user) {
            let isAdmin = (userId === ADMIN_NUMBER);
            user = {
                id: userId,
                role: isAdmin ? 'admin' : 'agent',
                status: isAdmin ? 'approved' : 'pending'
            };
            await pgClient.query('INSERT INTO users (id, role, status) VALUES ($1, $2, $3)', [user.id, user.role, user.status]);

            if (!isAdmin) {
                sock.sendMessage(ADMIN_NUMBER, { text: `🔔 *NEW USER REGISTRATION*\n\nName: ${pushname}\nID: ${userId}\n\nReply with \`4\` then \`${userId.split('@')[0]}\` to grant them access.` }).catch(console.error);
            }
        }
        
        // Enforce SUDO Admin privileges
        if (userId === ADMIN_NUMBER) {
            user.role = 'admin';
            user.status = 'approved';
        }

        // Admin Menu Handling
        if (user.role === 'admin') {
            if (!userSessions[userId]) userSessions[userId] = { state: 'IDLE', data: {} };
            const session = userSessions[userId];

            if (session.state === 'IDLE') {
                if (text === '3') {
                    const users = await pgClient.query('SELECT * FROM users');
                    let userList = '*Platform Users:*\n\n';
                    users.rows.forEach(u => {
                        userList += `👤 ${u.id.split('@')[0]} (${u.role}) : *${u.status}*\n`;
                    });
                    return reply(userList);
                }
                if (text === '4') {
                    session.state = 'AWAITING_APPROVE';
                    return reply('✅ *Approve User*\n\nPlease reply with the phone number you want to approve (e.g., 919876543210):');
                }
                if (text === '5') {
                    session.state = 'AWAITING_BLOCK';
                    return reply('🚫 *Block User*\n\nPlease reply with the phone number you want to block (e.g., 919876543210):');
                }
                if (text === '6') {
                    const props = await pgClient.query('SELECT * FROM properties');
                    if (props.rows.length === 0) {
                        return reply('No properties listed on the platform yet.');
                    }
                    let listStr = '*ALL PLATFORM PROPERTIES:*\n\n';
                    const frontendUrl = process.env.FRONTEND_URL || 'https://property-crm-bot.vercel.app';
                    props.rows.forEach(p => {
                        listStr += `🔹 *${p.title}* (${p.price})\nAgent: ${p.agent_name} (${p.agent_phone})\nID: ${p.id}\nLink: ${frontendUrl}/preview/${p.id}\n\n`;
                    });
                    return reply(listStr);
                }
                if (text === '7') {
                    session.state = 'AWAITING_DELETE';
                    return reply('🗑️ *Delete Listing*\n\nPlease reply with the Property ID you want to delete:');
                }
                if (text === '8') {
                    session.state = 'AWAITING_SERVICE_TITLE';
                    return reply('🛠️ *Add New Service*\n\nPlease provide the Title of the service (e.g. Property Management):');
                }
                if (text === '9') {
                    session.state = 'AWAITING_SERVICE_DELETE';
                    return reply('🗑️ *Delete Service*\n\nPlease reply with the exact Service Title you want to delete:');
                }
                if (text === '10') {
                    const servRes = await pgClient.query('SELECT * FROM services');
                    if (servRes.rows.length === 0) return reply('No services found.');
                    let list = '*Current Services:*\n\n';
                    servRes.rows.forEach(s => {
                        list += `🔹 *${s.title}*\n${s.description}\n\n`;
                    });
                    return reply(list);
                }
            }

            if (session.state === 'AWAITING_APPROVE') {
                const targetIdPrefix = text.trim();
                const targetRes = await pgClient.query('SELECT * FROM users WHERE id LIKE $1', [`${targetIdPrefix}@%`]);
                session.state = 'IDLE';
                if (targetRes.rows.length > 0) {
                    const actualTargetId = targetRes.rows[0].id;
                    await pgClient.query('UPDATE users SET status = $1 WHERE id = $2', ['approved', actualTargetId]);
                    sock.sendMessage(actualTargetId, { text: '🎉 *Good news!* Your account has been approved by the Admin. Send "hi" to see the main menu.' }).catch(() => {});
                    return reply(`✅ User ${actualTargetId.split('@')[0]} has been APPROVED.`);
                } else {
                    return reply(`❌ User ${text} not found. Try again from the menu.`);
                }
            }

            if (session.state === 'AWAITING_BLOCK') {
                const targetIdPrefix = text.trim();
                const targetRes = await pgClient.query('SELECT * FROM users WHERE id LIKE $1', [`${targetIdPrefix}@%`]);
                session.state = 'IDLE';
                if (targetRes.rows.length > 0) {
                    const actualTargetId = targetRes.rows[0].id;
                    await pgClient.query('UPDATE users SET status = $1 WHERE id = $2', ['blocked', actualTargetId]);
                    return reply(`🚫 User ${actualTargetId.split('@')[0]} has been BLOCKED.`);
                } else {
                    return reply(`❌ User ${text} not found. Try again from the menu.`);
                }
            }

            if (session.state === 'AWAITING_DELETE') {
                const targetId = text.trim();
                const targetRes = await pgClient.query('SELECT * FROM properties WHERE id = $1', [targetId]);
                session.state = 'IDLE';
                if (targetRes.rows.length > 0) {
                    await pgClient.query('DELETE FROM properties WHERE id = $1', [targetId]);
                    return reply(`✅ Property ${targetId} deleted.`);
                } else {
                    return reply(`❌ Property ${targetId} not found. Try again from the menu.`);
                }
            }

            if (session.state === 'AWAITING_SERVICE_TITLE') {
                session.data.serviceTitle = text;
                session.state = 'AWAITING_SERVICE_DESC';
                return reply(`✅ Service Title set to: *${text}*\n\nNow provide a short description for this service:`);
            }
            if (session.state === 'AWAITING_SERVICE_DESC') {
                const newId = crypto.randomUUID();
                await pgClient.query('INSERT INTO services (id, title, description) VALUES ($1, $2, $3)', [newId, session.data.serviceTitle, text]);
                session.state = 'IDLE';
                session.data = {};
                return reply(`✅ Service *${session.data.serviceTitle}* has been successfully added to the database!`);
            }
            if (session.state === 'AWAITING_SERVICE_DELETE') {
                const targetTitle = text.trim();
                const res = await pgClient.query('DELETE FROM services WHERE title = $1 RETURNING id', [targetTitle]);
                session.state = 'IDLE';
                if (res.rowCount > 0) {
                    return reply(`✅ Service "${targetTitle}" deleted.`);
                } else {
                    return reply(`❌ Service "${targetTitle}" not found. Try again from the menu.`);
                }
            }
        }

        // Initialize session if not exists
        if (!userSessions[userId]) {
            userSessions[userId] = { state: 'IDLE', data: {} };
        }
        const session = userSessions[userId];

        // Cancel command from any state
        if (text.toLowerCase() === 'cancel' || text.toLowerCase() === '0') {
            session.state = 'IDLE';
            session.data = {};
            if (user.status !== 'approved') {
                return reply('❌ Action cancelled.\n\n⏳ *Welcome to Property CRM!*\nYour agent access is pending.\n\n1️⃣ View Other Services\n2️⃣ Browse Properties\n3️⃣ Contact Owner');
            }
            return reply('❌ Action cancelled. Send any message to see the main menu.');
        }

        // Access Control Gateway (Public / Unapproved Flow)
        if (user.status !== 'approved') {
            if (user.status === 'blocked') {
                return reply('🚫 Your account has been blocked by the admin.');
            }
            
            if (session.state === 'IDLE') {
                if (text === '1') {
                    const servRes = await pgClient.query('SELECT * FROM services');
                    if (servRes.rows.length === 0) {
                        return reply('There are no other services listed at the moment.\n\n_(Reply 0 to go back)_');
                    }
                    let servList = '🏢 *Our Other Services*\n\n';
                    servRes.rows.forEach(s => {
                        servList += `🔹 *${s.title}*\n${s.description}\n\n`;
                    });
                    servList += '_(Reply 0 to go back)_';
                    return reply(servList);
                } else if (text === '2') {
                    const props = await pgClient.query('SELECT * FROM properties');
                    if (props.rows.length === 0) {
                        return reply('No properties listed on the platform yet.\n\n_(Reply 0 to go back)_');
                    }
                    let listStr = '*AVAILABLE PROPERTIES:*\n\n';
                    const frontendUrl = process.env.FRONTEND_URL || 'https://property-crm-bot.vercel.app';
                    props.rows.forEach(p => {
                        listStr += `🔹 *${p.title}* (${p.price})\nLocation: ${p.location}\nLink: ${frontendUrl}/preview/${p.id}\n\n`;
                    });
                    listStr += '_(Reply 0 to go back)_';
                    return reply(listStr);
                } else if (text === '3') {
                    session.state = 'AWAITING_CONTACT_MESSAGE';
                    return reply('📝 Please type your message for the owner. It will be forwarded directly to them.\n\n_(Reply 0 to cancel)_');
                } else {
                    return reply('⏳ *Welcome to Property CRM!*\nYour agent access is pending Admin approval.\n\nIn the meantime, you can:\n1️⃣ View Other Services\n2️⃣ Browse Properties\n3️⃣ Contact Owner');
                }
            }
            
            if (session.state === 'AWAITING_CONTACT_MESSAGE') {
                const fwdMessage = `📩 *NEW MESSAGE FROM PENDING USER*\n\n*Name:* ${pushname}\n*Phone:* ${userId.split('@')[0]}\n\n*Message:* "${text}"`;
                await sock.sendMessage(ADMIN_NUMBER, { text: fwdMessage });
                session.state = 'IDLE';
                return reply('✅ Your message has been sent to the owner. They will contact you shortly.');
            }
            
            // Stop execution here for unapproved users so they don't access the main CRM menus
            return;
        }

        if (session.state === 'IDLE') {
            if (text === '1') {
                session.state = 'AWAITING_TITLE';
                return reply('🏡 *Add New Property*\n\nGreat! What is the *Title* of the property? (e.g. Luxury 5BR Villa)');
            } else if (text === '2') {
                const myPropsRes = await pgClient.query('SELECT * FROM properties WHERE agent_id = $1', [userId]);
                if (myPropsRes.rows.length === 0) {
                    return reply('You have no properties listed yet.');
                }
                let listStr = '*Your Properties:*\n\n';
                const frontendUrl = process.env.FRONTEND_URL || 'https://property-crm-bot.vercel.app';
                myPropsRes.rows.forEach(p => {
                    listStr += `🔹 *${p.title}* (${p.price})\nID: ${p.id}\nLink: ${frontendUrl}/preview/${p.id}\n\n`;
                });
                return reply(listStr);
            } else if (text === '3' && user.role !== 'admin') {
                session.state = 'AWAITING_DELETE_MY_PROPERTY';
                return reply('🗑️ *Delete My Property*\n\nReply with the *ID* of the property you want to delete:');
            } else if (text === '11' && user.role === 'admin') {
                session.state = 'AWAITING_DELETE_MY_PROPERTY';
                return reply('🗑️ *Delete My Property*\n\nReply with the *ID* of the property you want to delete:');
            } else if (!['3', '4', '5', '6', '7', '8', '9', '10'].includes(text) || user.role !== 'admin') {
                // Main Menu
                let menu = `👋 *Property CRM Bot*\n\nPlease reply with a number to choose an option:\n\n1️⃣ Add Property\n2️⃣ List My Properties\n3️⃣ Delete My Property\n`;
                if (user.role === 'admin') {
                    menu = `👑 *Admin Dashboard*\n\nPlease reply with a number:\n\n1️⃣ Add Property\n2️⃣ List My Properties\n3️⃣ View All Users\n4️⃣ Approve User\n5️⃣ Block User\n6️⃣ View All Listings\n7️⃣ Delete Listing\n8️⃣ Add Service\n9️⃣ Delete Service\n🔟 View All Services\n1️⃣1️⃣ Delete My Property\n`;
                }
                menu += `\n_(Reply '0' or 'cancel' at any time to abort)_`;
                return reply(menu);
            }
        }
        
        if (session.state === 'AWAITING_DELETE_MY_PROPERTY') {
            const targetId = text.trim();
            const res = await pgClient.query('DELETE FROM properties WHERE id = $1 AND agent_id = $2 RETURNING *', [targetId, userId]);
            session.state = 'IDLE';
            if (res.rowCount > 0) {
                return reply(`✅ Successfully deleted your property: ${res.rows[0].title}`);
            } else {
                return reply(`❌ Property not found or you don't have permission to delete it.`);
            }
        }

        // Property Creation Flow
        if (session.state === 'AWAITING_TITLE') {
            session.data.title = text;
            session.state = 'AWAITING_PRICE';
            return reply(`✅ Title set to: *${text}*\n\nNext, what is the *Price* in INR? (e.g. ₹1,20,00,000)`);
        }
        if (session.state === 'AWAITING_PRICE') {
            session.data.price = text;
            session.state = 'AWAITING_LOCATION';
            return reply(`✅ Price set to: *${text}*\n\nNext, what is the *Location* of the property? (e.g. Bandra West, Mumbai)`);
        }
        if (session.state === 'AWAITING_LOCATION') {
            session.data.location = text;
            session.state = 'AWAITING_DESCRIPTION';
            return reply(`✅ Location set to: *${text}*\n\nNext, provide a short *Description* of the property:`);
        }
        if (session.state === 'AWAITING_DESCRIPTION') {
            session.data.description = text;
            session.state = 'AWAITING_OTHER_INFO';
            return reply(`✅ Description saved.\n\nNext, provide any *Other Info* (e.g. Bedrooms: 4, Bathrooms: 3, Pool included), or reply "skip":`);
        }
        if (session.state === 'AWAITING_OTHER_INFO') {
            session.data.otherInfo = text.toLowerCase() === 'skip' ? '' : text;
            session.data.images = [];
            session.data.documents = [];
            session.state = 'AWAITING_MEDIA';
            return reply(`✅ Additional info saved.\n\nNow, please *send all photos and documents (PDFs, etc.)* for this property one by one.\n\nWhen you are finished uploading all files, reply with the word *"done"*.`);
        }
        if (session.state === 'AWAITING_MEDIA') {
            if (text.toLowerCase() === 'done') {
                if (session.data.images.length === 0) {
                    session.data.images.push('https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80');
                }

                const newProperty = {
                    id: crypto.randomUUID(),
                    title: session.data.title,
                    price: session.data.price,
                    location: session.data.location,
                    description: session.data.description,
                    otherInfo: session.data.otherInfo,
                    images: JSON.stringify(session.data.images),
                    documents: JSON.stringify(session.data.documents),
                    agentId: userId,
                    agentName: pushname || 'Exclusive Agent',
                    agentPhone: userId.split('@')[0]
                };

                await pgClient.query(`
                    INSERT INTO properties (id, title, price, location, description, other_info, images, documents, agent_id, agent_name, agent_phone)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                `, [
                    newProperty.id, newProperty.title, newProperty.price, newProperty.location, newProperty.description,
                    newProperty.otherInfo, newProperty.images, newProperty.documents,
                    newProperty.agentId, newProperty.agentName, newProperty.agentPhone
                ]);

                const frontendUrl = process.env.FRONTEND_URL || 'https://property-crm-bot.vercel.app';
                const previewUrl = `${frontendUrl}/preview/${newProperty.id}`;
                
                session.state = 'IDLE';
                session.data = {};
                
                return reply(`🎉 *Property Successfully Added!*\n\n*${newProperty.title}*\nPrice: ${newProperty.price}\nLocation: ${newProperty.location}\n\n🔗 *Preview Link:*\n${previewUrl}`);
            }

            const isMedia = !!(msg.message.imageMessage || msg.message.documentMessage || msg.message.videoMessage);
            
            if (isMedia) {
                try {
                    const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }) });
                    const mimeType = msg.message.imageMessage?.mimetype || msg.message.documentMessage?.mimetype || msg.message.videoMessage?.mimetype;
                    let ext = mimeType.split('/')[1] || 'bin';
                    if (ext.includes(';')) ext = ext.split(';')[0];
                    if (ext === 'jpeg') ext = 'jpg';

                    const filename = `${crypto.randomUUID()}.${ext}`;
                    const filePath = path.join(uploadsDir, filename);
                    fs.writeFileSync(filePath, buffer);
                    const fileUrl = `/uploads/${filename}`;

                    if (mimeType.startsWith('image/')) {
                        session.data.images.push(fileUrl);
                        return reply(`📸 Image saved! (${session.data.images.length} total). Send more or reply "done".`);
                    } else {
                        session.data.documents.push({
                            url: fileUrl,
                            name: msg.message.documentMessage?.fileName || `Document_${session.data.documents.length + 1}.${ext}`
                        });
                        return reply(`📄 Document saved! (${session.data.documents.length} total). Send more or reply "done".`);
                    }
                } catch (err) {
                    console.error('Error downloading media:', err);
                    return reply('❌ Error processing file. Please try again.');
                }
            }
            return reply('Please send a photo/document, or reply *"done"* to finish creating the property.');
        }
    });
}

connectToWhatsApp();

// --- REST API for Frontend Preview & Login ---

app.get('/api/property/:id', async (req, res) => {
    try {
        const propRes = await pgClient.query('SELECT * FROM properties WHERE id = $1', [req.params.id]);
        if (propRes.rows.length > 0) {
            const p = propRes.rows[0];
            const hostUrl = `${req.protocol}://${req.get('host')}`;
            
            // Map relative or legacy localhost URLs to the live backend URL
            const fixedImages = (p.images || []).map(url => {
                if (url.startsWith('/uploads')) return `${hostUrl}${url}`;
                return url.replace('http://localhost:3001', hostUrl);
            });
            
            res.json({
                id: p.id,
                title: p.title,
                price: p.price,
                location: p.location,
                description: p.description,
                otherInfo: p.other_info,
                images: fixedImages,
                documents: p.documents,
                agentId: p.agent_id,
                agentName: p.agent_name,
                agentPhone: p.agent_phone
            });
        } else {
            res.status(404).json({ error: 'Property not found' });
        }
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/offer/:id', async (req, res) => {
    try {
        const propRes = await pgClient.query('SELECT * FROM properties WHERE id = $1', [req.params.id]);
        if (propRes.rows.length === 0) {
            return res.status(404).json({ error: 'Property not found' });
        }

        const property = propRes.rows[0];
        const { name, phone, offerPrice, message } = req.body;

        const textMsg = `🛎️ *NEW OFFER ALERT* 🛎️\n\n*Property:* ${property.title}\n\n*Client Name:* ${name}\n*Client Phone:* ${phone}\n*Offer Price:* ${offerPrice}\n\n*Message:* "${message}"`;

        if (sock) {
            await sock.sendMessage(property.agent_id, { text: textMsg });
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Error sending message to agent:', err);
        res.status(500).json({ error: 'Failed to notify the agent' });
    }
});

// --- ADMIN API ---

const ADMIN_USER = process.env.ADMIN_USER || 'vashuadmin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'vashu247@#!.';
const ADMIN_TOKEN = 'secret-admin-token-12345';

const authMiddleware = (req, res, next) => {
    const token = req.headers.authorization;
    if (token === `Bearer ${ADMIN_TOKEN}`) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
};

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USER && password === ADMIN_PASS) {
        res.json({ token: ADMIN_TOKEN });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

app.get('/api/admin/status', authMiddleware, (req, res) => {
    res.json({ ready: isReady, qr: latestQR });
});

app.post('/api/admin/pairing-code', authMiddleware, async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        if (!phoneNumber) {
            return res.status(400).json({ error: 'Phone number is required' });
        }

        if (!isBrowserReadyForPairing && !isReady) {
            return res.status(400).json({ error: 'Server is still initializing. Please wait a few seconds.' });
        }

        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
        if (sock && !sock.authState.creds.me) {
             const code = await sock.requestPairingCode(cleanNumber);
             return res.json({ code });
        } else {
             return res.status(400).json({ error: 'Bot is already authenticated or not ready.' });
        }
    } catch (err) {
        console.error('Error requesting pairing code:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/users', authMiddleware, async (req, res) => {
    try {
        const result = await pgClient.query('SELECT * FROM users ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/users/:id/status', authMiddleware, async (req, res) => {
    try {
        const newStatus = req.body.status;
        const targetId = req.params.id;
        await pgClient.query('UPDATE users SET status = $1 WHERE id = $2', [newStatus, targetId]);

        if (newStatus === 'approved' && sock) {
            sock.sendMessage(targetId, { text: '🎉 *Good news!* Your account has been approved by the Admin. Send "hi" to see the main menu.' }).catch(() => {});
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/properties', authMiddleware, async (req, res) => {
    try {
        const result = await pgClient.query('SELECT * FROM properties ORDER BY title ASC');
        const hostUrl = `${req.protocol}://${req.get('host')}`;
        
        const props = result.rows.map(p => {
            const fixedImages = (p.images || []).map(url => {
                if (url.startsWith('/uploads')) return `${hostUrl}${url}`;
                return url.replace('http://localhost:3001', hostUrl);
            });
            return { ...p, images: fixedImages };
        });
        
        res.json(props);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/properties/:id', authMiddleware, async (req, res) => {
    try {
        await pgClient.query('DELETE FROM properties WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend API running on port ${PORT}`);
});
