// bot.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path'); // Ampiasaina ho an'ny lalana path Persistent Disk

// ID ny groupe tianao harahina. Ataovy azo antoka fa marina ity
// Soloy ny '261323911654@g.us' amin'ny ID tena izy an'ny groupe raha tsy marina io.
// Ny ID dia hita rehefa mahazo hafatra avy amin'io groupe io ilay bot, dia mijery ny msg.id.remote
const TARGET_GROUP_ID_SUFFIX = '261323911654@g.us'; 

// Domains izay azo alefa
const ALLOWED_DOMAIN = 'lovable.app';

// Object hitazona ny isan'ny fampitandremana isaky ny mpikambana
const warnings = {}; // { participantId: warningCount }
// Object hitazona ny mpikambana voarara
const bannedUsers = {}; // { participantId: true }

// Initialisation du client WhatsApp
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'bot-session', // Mampiasa ID manokana ho an'ny session
        dataPath: path.join(__dirname, '.wwebjs_auth') // Ity no lalana Persistent Disk
    }),
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // Ilaina amin'ny environnement an'ny server toy ny Render
            '--disable-accelerated-mhtml-generation'
        ],
        headless: true // Atao amin'ny fomba headless amin'ny Render
    }
});

// Rehefa misy QR Code mipoitra, dia asehoy amin'ny terminal
client.on('qr', (qr) => {
    console.log('QR RECEIVED', qr);
    qrcode.generate(qr, { small: true });
    // Raha mandefa any amin'ny Render dia azo ampiasaina ny console log
    // Izany dia ho hita ao amin'ny logs-an'ny Render
});

// Rehefa vonona ny bot
client.on('ready', () => {
    console.log('Client is ready!');
    // Mitady ny groupe rehefa vonona ny client
    client.getChats().then(chats => {
        const targetGroup = chats.find(chat => chat.id._serialized.endsWith(TARGET_GROUP_ID_SUFFIX));
        if (targetGroup) {
            console.log(`Groupe "${targetGroup.name}" hitanao!`);
            // Mandefa ny lisitry ny voarara amin'ny admin UI rehefa ready ny bot
            broadcastBannedUsers(); 
        } else {
            console.error(`Tsy hitanao ny groupe miaraka amin'ny suffix id "${TARGET_GROUP_ID_SUFFIX}". Ataovy azo antoka fa marina ny suffix ID ary efa ampiana ao anatin'ny groupe ity bot ity.`);
        }
    });

});

// Rehefa mahazo hafatra
client.on('message', async msg => {
    // Tsy mandray hafatra avy amin'ny bot
    if (msg.fromMe) return; 
    
    const chat = await msg.getChat();
    // Amin'ny groupe ihany no miasa
    if (!chat.isGroup) return; 
    // Amin'ny groupe kendrena ihany no miasa
    if (!chat.id._serialized.endsWith(TARGET_GROUP_ID_SUFFIX)) return; 

    // Alaina ny mpandefa hafatra
    const sender = msg.author || msg.from; 
    const formattedSender = sender.split('@')[0]; // Ny nomerao fotsiny

    // Mizaha raha voarara ilay mpandefa
    if (bannedUsers[sender]) {
        console.log(`Mpikambana voarara ${formattedSender} nanandrana nandefa hafatra. Mandroaka azy indray.`);
        try {
            await chat.removeParticipants([sender]);
            await msg.delete(true); // Manandrana mamafa ny hafatra avy amin'ny voarara
        } catch (error) {
            console.error(`Tsy afaka mandroaka na mamafa hafatra avy amin'ny mpikambana voarara ${formattedSender}:`, error);
        }
        return;
    }

    // Mizaha lien
    const linkRegex = /(https?:\/\/[^\s]+)/g;
    const links = msg.body.match(linkRegex);

    if (links) {
        let hasForbiddenLink = false;
        for (let link of links) {
            try {
                const url = new URL(link);
                // Mizaha raha tsy misy ao anatin'ny domaine azo alefa ny link
                if (!url.hostname.includes(ALLOWED_DOMAIN)) {
                    hasForbiddenLink = true;
                    break;
                }
            } catch (e) {
                console.warn(`Diso format ny lien: ${link}. Hatao toy ny lien voarara.`);
                hasForbiddenLink = true;
                break;
            }
        }

        if (hasForbiddenLink) {
            console.log(`Lien voarara hita avy amin'i ${formattedSender}: ${msg.body}`);
            // 1. Mamafa ny hafatra
            try {
                await msg.delete(true); // true = delete for everyone
                console.log(`Hafatra voafafa avy amin'i ${formattedSender}`);
            } catch (error) {
                console.error(`Tsy afaka namafa ny hafatra avy amin'i ${formattedSender}:`, error);
                // Mbola tohizana ihany na dia tsy afaka namafa aza
            }

            // 2. Fampitandremana
            warnings[sender] = (warnings[sender] || 0) + 1;
            console.log(`Fampitandremana ho an'i ${formattedSender}: ${warnings[sender]}`);

            if (warnings[sender] >= 2) { // Raha fampitandremana faharoa na mihoatra
                await client.sendMessage(chat.id._serialized, `🚫 FAMPITANDREMANA FARANY ho an'i @${formattedSender}! Efa im-betsaka ianao no nandefa lien tsy ara-dalàna. Ho roahina ianao.`, {
                    mentions: [sender]
                });
                await client.sendMessage(chat.id._serialized, `Ho roahina ianao izao, ary tsy afaka hiditra amin'ity groupe ity raha tsy misy fanomezan-dàlana avy amin'ny admin.`, {
                    mentions: [sender]
                });
                // 3. Mandroaka sy mandrara
                try {
                    await chat.removeParticipants([sender]);
                    bannedUsers[sender] = true;
                    delete warnings[sender]; // Esory ny fampitandremana rehefa voarara
                    console.log(`Mpikambana ${formattedSender} voaroaka ary voarara.`);
                    broadcastBannedUsers(); // Manavao ny lisitry ny voarara ho an'ny admin UI
                } catch (error) {
                    console.error(`Tsy afaka nandroaka an'i ${formattedSender}:`, error);
                    await client.sendMessage(chat.id._serialized, `⛔ Miala tsiny fa misy olana, tsy afaka mandroaka an'i @${formattedSender} aho izao. Mifandraisa amin'ny admin.`, {
                        mentions: [sender]
                    });
                }
            } else {
                await client.sendMessage(chat.id._serialized, `🚫 Fampitandremana @${formattedSender}! Tsy azo alefa eto ny lien ankoatra ny ${ALLOWED_DOMAIN}. Horaisina ho fampitandremana iray hafa izao, azafady manaraha ny fitsipika.`, {
                    mentions: [sender] // Mampiasa mention mba ho hitan'ilay olona
                });
            }
        }
    }
});

client.initialize();

// WebSocket Server ho an'ny Admin Interface
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Mamela ny static files (admin.html) ho azo jerena
app.use(express.static(__dirname));

wss.on('connection', ws => {
    console.log('Admin UI connected via WebSocket');
    // Mandefa ny lisitry ny mpikambana voarara rehefa misy fifandraisana vaovao
    ws.send(JSON.stringify({ type: 'banned_users', users: Object.keys(bannedUsers) }));

    ws.on('message', message => {
        const data = JSON.parse(message);
        if (data.type === 'unban_user') {
            const userId = data.userId;
            if (bannedUsers[userId]) {
                delete bannedUsers[userId];
                delete warnings[userId]; // Esory koa ny fampitandremana raha sanatria
                console.log(`Mpikambana ${userId} no nofoanana ny fandrarana.`);
                
                // Milaza amin'ny groupe fa nofoanana ny fandrarana
                client.getChats().then(chats => {
                    const targetGroup = chats.find(chat => chat.id._serialized.endsWith(TARGET_GROUP_ID_SUFFIX));
                    if (targetGroup) {
                        // Afaka atao hoe mandefa fanasana indray eto, fa sarotra kokoa izany
                        // Matory kely aloha (ohatra 1 sekoondra) mba hahazoana antoka fa voafafa tsara ilay fifandraisana teo aloha
                        setTimeout(() => {
                            client.sendMessage(targetGroup.id._serialized, `✅ Nofoanana ny fandrarana an'i @${userId.split('@')[0]}. Afaka miditra indray izy izao.`, { // Efa anjaran'ny admin ny mandefa lien fanasana
                                mentions: [userId]
                            });
                        }, 1000); // 1 sekoondra
                    }
                });
                broadcastBannedUsers(); // Manavao ny lisitra ho an'ny admin UI rehetra
            }
        }
    });

    ws.on('close', () => {
        console.log('Admin UI disconnected');
    });
});

// Mandefa vaovao momba ny mpikambana voarara any amin'ny admin UI rehetra mifandray
function broadcastBannedUsers() {
    const data = JSON.stringify({ type: 'banned_users', users: Object.keys(bannedUsers) });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

// Manomboka ny web server
// Render.com dia manampy ny PORT ho Environment Variable
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Web server listening on port ${PORT}`);
    console.log('Open admin.html in your browser to manage banned users.');
});
