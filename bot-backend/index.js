const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client: PgClient } = require('pg');
const QRCode = require('qrcode');

const app = express();
app.use(cors());
app.use(express.json());

const ADMIN_NUMBER = '919996829482@c.us';

const pgClient = new PgClient({
    connectionString: "postgresql://vashu:p--idOQQkxIUPudLXwZ9TQ@copper-orca-28396.j77.aws-ap-south-1.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full"
});
pgClient.connect().catch(err => console.error("DB Connection Error:", err));
pgClient.on('error', err => {
    console.error('Unexpected error on idle client', err);
});

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}
app.use('/uploads', express.static(uploadsDir));

// Ensure the local auth is properly set up
const client = new Client({
    authStrategy: new LocalAuth(),
    authTimeoutMs: 120000,
    puppeteer: {
        headless: true,
        timeout: 120000,
        executablePath: process.env.NODE_ENV === 'production' ? '/usr/bin/google-chrome' : null,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--single-process',
            '--disable-extensions',
            '--disable-software-rasterizer',
            '--mute-audio',
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-breakpad',
            '--disable-component-update',
            '--disable-default-apps',
            '--disable-domain-reliability',
            '--disable-features=AudioServiceOutOfProcess',
            '--disable-hang-monitor',
            '--disable-ipc-flooding-protection',
            '--disable-notifications',
            '--disable-offer-store-unmasked-wallet-cards',
            '--disable-popup-blocking',
            '--disable-print-preview',
            '--disable-prompt-on-repost',
            '--disable-renderer-backgrounding',
            '--disable-sync',
            '--metrics-recording-only',
            '--no-default-browser-check',
            '--no-pings',
            '--password-store=basic',
            '--use-gl=swiftshader',
            '--use-mock-keychain'
        ]
    }
});

let isReady = false;
let isBrowserReadyForPairing = false;
let latestQR = null;

client.on('qr', async (qr) => {
    isReady = false;
    isBrowserReadyForPairing = true;
    console.log('\n[WhatsApp] Waiting for pairing code or QR connection...');
    try {
        latestQR = await QRCode.toDataURL(qr);
    } catch (err) {
        console.error('Failed to generate QR data URL', err);
    }
});

client.on('authenticated', () => {
    console.log('\n✅ WhatsApp Authenticated successfully!');
    // Even if it hasn't fully synced ('ready'), it is authenticated.
    isReady = true;
});

client.on('auth_failure', (msg) => {
    console.error('\n❌ Authentication failure', msg);
    isReady = false;
});

client.on('disconnected', (reason) => {
    console.log('\n❌ WhatsApp Disconnected!', reason);
    isReady = false;
});

// Session management for conversational flow
const userSessions = {};

client.on('ready', () => {
    isReady = true;
    console.log('\n✅ WhatsApp Bot is FULLY Ready and Synced!');
});

client.on('disconnected', () => {
    isReady = false;
});

client.on('message', async msg => {
    const text = msg.body.trim();
    const userId = msg.from;
    
    // Auto-register users
    let userRes = await pgClient.query('SELECT * FROM users WHERE id = $1', [userId]);
    let user = userRes.rows[0];
    
    if (!user) {
        let isAdmin = false;
        let pushname = userId.split('@')[0];
        try {
            const contact = await msg.getContact();
            const phoneNumber = contact.number || '';
            pushname = contact.pushname || phoneNumber;
            if (phoneNumber === '919996829482') {
                isAdmin = true;
            }
        } catch (e) {
            console.error("Error fetching contact for new user", e);
        }

        user = {
            id: userId,
            role: isAdmin ? 'admin' : 'agent',
            status: isAdmin ? 'approved' : 'pending'
        };
        await pgClient.query('INSERT INTO users (id, role, status) VALUES ($1, $2, $3)', [user.id, user.role, user.status]);
        
        if (!isAdmin) {
            client.sendMessage(ADMIN_NUMBER, `🔔 *NEW USER REGISTRATION*\n\nName: ${pushname}\nID: ${userId}\n\nReply with \`4\` then \`${userId.split('@')[0]}\` to grant them access.`).catch(err => console.error(err));
        }
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
                return msg.reply(userList);
            }
            if (text === '4') {
                session.state = 'AWAITING_APPROVE';
                return msg.reply('✅ *Approve User*\n\nPlease reply with the phone number you want to approve (e.g., 919876543210):');
            }
            if (text === '5') {
                session.state = 'AWAITING_BLOCK';
                return msg.reply('🚫 *Block User*\n\nPlease reply with the phone number you want to block (e.g., 919876543210):');
            }
            if (text === '6') {
                const props = await pgClient.query('SELECT * FROM properties');
                if (props.rows.length === 0) {
                    return msg.reply('No properties listed on the platform yet.');
                }
                let listStr = '*ALL PLATFORM PROPERTIES:*\n\n';
                props.rows.forEach(p => {
                    listStr += `🔹 *${p.title}* (${p.price})\nAgent: ${p.agent_name} (${p.agent_phone})\nID: ${p.id}\nLink: http://localhost:5173/preview/${p.id}\n\n`;
                });
                return msg.reply(listStr);
            }
            if (text === '7') {
                session.state = 'AWAITING_DELETE';
                return msg.reply('🗑️ *Delete Listing*\n\nPlease reply with the Property ID you want to delete:');
            }
        }
        
        if (session.state === 'AWAITING_APPROVE') {
            const targetId = text + '@c.us';
            const targetRes = await pgClient.query('SELECT * FROM users WHERE id = $1', [targetId]);
            session.state = 'IDLE';
            if (targetRes.rows.length > 0) {
                await pgClient.query('UPDATE users SET status = $1 WHERE id = $2', ['approved', targetId]);
                client.sendMessage(targetId, '🎉 *Good news!* Your account has been approved by the Admin. Send "hi" to see the main menu.').catch(() => {});
                return msg.reply(`✅ User ${text} has been APPROVED.`);
            } else {
                return msg.reply(`❌ User ${text} not found. Try again from the menu.`);
            }
        }

        if (session.state === 'AWAITING_BLOCK') {
            const targetId = text + '@c.us';
            const targetRes = await pgClient.query('SELECT * FROM users WHERE id = $1', [targetId]);
            session.state = 'IDLE';
            if (targetRes.rows.length > 0) {
                await pgClient.query('UPDATE users SET status = $1 WHERE id = $2', ['blocked', targetId]);
                return msg.reply(`🚫 User ${text} has been BLOCKED.`);
            } else {
                return msg.reply(`❌ User ${text} not found. Try again from the menu.`);
            }
        }

        if (session.state === 'AWAITING_DELETE') {
            const targetId = text.trim();
            const targetRes = await pgClient.query('SELECT * FROM properties WHERE id = $1', [targetId]);
            session.state = 'IDLE';
            if (targetRes.rows.length > 0) {
                await pgClient.query('DELETE FROM properties WHERE id = $1', [targetId]);
                return msg.reply(`✅ Property ${targetId} deleted.`);
            } else {
                return msg.reply(`❌ Property ${targetId} not found. Try again from the menu.`);
            }
        }
    }
    
    // Access Control Gateway
    if (user.status !== 'approved') {
        if (user.status === 'blocked') {
            return msg.reply('🚫 Your account has been blocked by the admin.');
        }
        return msg.reply('⏳ *Welcome to Property CRM!* \n\nYour account is currently pending Admin approval. You will be notified once approved.');
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
        return msg.reply('❌ Action cancelled. Send any message to see the main menu.');
    }

    if (session.state === 'IDLE') {
        if (text === '1') {
            session.state = 'AWAITING_TITLE';
            return msg.reply('🏡 *Add New Property*\n\nGreat! What is the *Title* of the property? (e.g. Luxury 5BR Villa)');
        } else if (text === '2') {
            const myPropsRes = await pgClient.query('SELECT * FROM properties WHERE agent_id = $1', [userId]);
            if (myPropsRes.rows.length === 0) {
                return msg.reply('You have no properties listed yet.');
            }
            let listStr = '*Your Properties:*\n\n';
            myPropsRes.rows.forEach(p => {
                listStr += `🔹 *${p.title}* (${p.price})\nLink: http://localhost:5173/preview/${p.id}\n\n`;
            });
            return msg.reply(listStr);
        } else if (!['3', '4', '5', '6', '7'].includes(text) || user.role !== 'admin') {
            // Main Menu
            let menu = `👋 *Property CRM Bot*\n\nPlease reply with a number to choose an option:\n\n1️⃣ Add Property\n2️⃣ List My Properties\n`;
            if (user.role === 'admin') {
                menu = `👑 *Admin Dashboard*\n\nPlease reply with a number:\n\n1️⃣ Add Property\n2️⃣ List My Properties\n3️⃣ View All Users\n4️⃣ Approve User\n5️⃣ Block User\n6️⃣ View All Listings\n7️⃣ Delete Listing\n`;
            }
            menu += `\n_(Reply '0' or 'cancel' at any time to abort)_`;
            return msg.reply(menu);
        }
    }
    
    // Property Creation Flow
    if (session.state === 'AWAITING_TITLE') {
        session.data.title = text;
        session.state = 'AWAITING_PRICE';
        return msg.reply(`✅ Title set to: *${text}*\n\nNext, what is the *Price* in INR? (e.g. ₹1,20,00,000)`);
    }
    if (session.state === 'AWAITING_PRICE') {
        session.data.price = text;
        session.state = 'AWAITING_LOCATION';
        return msg.reply(`✅ Price set to: *${text}*\n\nNext, what is the *Location* of the property? (e.g. Bandra West, Mumbai)`);
    }
    if (session.state === 'AWAITING_LOCATION') {
        session.data.location = text;
        session.state = 'AWAITING_DESCRIPTION';
        return msg.reply(`✅ Location set to: *${text}*\n\nNext, provide a short *Description* of the property:`);
    }
    if (session.state === 'AWAITING_DESCRIPTION') {
        session.data.description = text;
        session.state = 'AWAITING_OTHER_INFO';
        return msg.reply(`✅ Description saved.\n\nNext, provide any *Other Info* (e.g. Bedrooms: 4, Bathrooms: 3, Pool included), or reply "skip":`);
    }
    if (session.state === 'AWAITING_OTHER_INFO') {
        session.data.otherInfo = text.toLowerCase() === 'skip' ? '' : text;
        session.data.images = [];
        session.data.documents = [];
        session.state = 'AWAITING_MEDIA';
        return msg.reply(`✅ Additional info saved.\n\nNow, please *send all photos and documents (PDFs, etc.)* for this property one by one.\n\nWhen you are finished uploading all files, reply with the word *"done"*.`);
    }
    if (session.state === 'AWAITING_MEDIA') {
        if (text.toLowerCase() === 'done') {
            if (session.data.images.length === 0) {
                session.data.images.push('https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80');
            }
            
            const contact = await msg.getContact();
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
                agentName: contact.pushname || 'Exclusive Agent',
                agentPhone: contact.number || userId.split('@')[0]
            };
            
            await pgClient.query(`
                INSERT INTO properties (id, title, price, location, description, other_info, images, documents, agent_id, agent_name, agent_phone)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            `, [
                newProperty.id, newProperty.title, newProperty.price, newProperty.location, newProperty.description, 
                newProperty.otherInfo, newProperty.images, newProperty.documents, 
                newProperty.agentId, newProperty.agentName, newProperty.agentPhone
            ]);
            
            const previewUrl = `http://localhost:5173/preview/${newProperty.id}`;
            
            session.state = 'IDLE';
            session.data = {};
            
            return msg.reply(`🎉 *Property Added Successfully!*\n\nHere is your custom preview link to share with clients:\n${previewUrl}`);
        }
        
        if (msg.hasMedia) {
            try {
                const media = await msg.downloadMedia();
                if (media) {
                    const mime = media.mimetype;
                    let ext = mime.split('/')[1] || 'bin';
                    if (ext.includes(';')) ext = ext.split(';')[0];
                    if (ext === 'jpeg') ext = 'jpg';
                    
                    const filename = `${crypto.randomUUID()}.${ext}`;
                    const filePath = path.join(uploadsDir, filename);
                    fs.writeFileSync(filePath, media.data, 'base64');
                    // We will need the server URL to point to the live bot-backend later if it is hosted on a VPS. For now localhost is fine since the Vercel frontend needs an absolute URL to fetch the image. 
                    const fileUrl = `http://localhost:3001/uploads/${filename}`;
                    
                    if (mime.startsWith('image/')) {
                        session.data.images.push(fileUrl);
                        return msg.reply(`📸 Image saved! (${session.data.images.length} total). Send more or reply "done".`);
                    } else {
                        session.data.documents.push({
                            url: fileUrl,
                            name: media.filename || `Document_${session.data.documents.length + 1}.${ext}`
                        });
                        return msg.reply(`📄 Document saved! (${session.data.documents.length} total). Send more or reply "done".`);
                    }
                } else {
                    return msg.reply('❌ Failed to download media. Please try again.');
                }
            } catch (err) {
                console.error('Error downloading media:', err);
                return msg.reply('❌ Error processing file. Please try again.');
            }
        }
        return msg.reply('Please send a photo/document, or reply *"done"* to finish creating the property.');
    }
});

client.initialize();

// --- REST API for Frontend Preview & Login ---

app.get('/api/property/:id', async (req, res) => {
    try {
        const propRes = await pgClient.query('SELECT * FROM properties WHERE id = $1', [req.params.id]);
        if (propRes.rows.length > 0) {
            const p = propRes.rows[0];
            // Format to match frontend expectations
            res.json({
                id: p.id,
                title: p.title,
                price: p.price,
                location: p.location,
                description: p.description,
                otherInfo: p.other_info,
                images: p.images,
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
        
        await client.sendMessage(property.agent_id, textMsg);
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
            return res.status(400).json({ error: 'Server is still booting up the WhatsApp engine. Please wait about 30 seconds and try again.' });
        }
        
        // requestPairingCode requires the phone number without '+' or specific formatting
        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
        const pairingCode = await client.requestPairingCode(cleanNumber);
        
        res.json({ code: pairingCode });
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
        
        if (newStatus === 'approved') {
            client.sendMessage(targetId, '🎉 *Good news!* Your account has been approved by the Admin. Send "hi" to see the main menu.').catch(() => {});
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/properties', authMiddleware, async (req, res) => {
    try {
        const result = await pgClient.query('SELECT * FROM properties ORDER BY title ASC');
        res.json(result.rows);
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

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`Backend API running on http://localhost:${PORT}`);
});
