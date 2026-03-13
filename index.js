require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const axios = require('axios');
const fs = require('fs').promises;
const express = require('express');
const { HttpsProxyAgent } = require('https-proxy-agent');
const http = require('http');
const https = require('https');

// ===== ПРОКСИ ОТ PROXYCOVE =====
const PROXY_CONFIG = {
  host: 'go.proxycove.com',
  port: 10000,
  auth: '8c4caf4549d875ea6928:01681f09f17cb891'
};

const proxyUrl = `http://${PROXY_CONFIG.auth}@${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`;
const proxyAgent = new HttpsProxyAgent(proxyUrl);

// ===== HTTP-агенты с поддержкой прокси =====
const httpsAgent = new https.Agent({ keepAlive: true });
const httpAgent = new http.Agent({ keepAlive: true });

// ===== Express сервер для Render =====
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('🌱 Garden Horizons Bot is running!');
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(port, () => {
    console.log(`✅ Web server running on port ${port}`);
});

// ===== СОЗДАНИЕ КЛИЕНТА =====
const client = new Client();

// ===== ТВОИ ЦЕЛЕВЫЕ ПРЕДМЕТЫ =====
const TARGET_ITEMS = {
    'cherry': {
        keywords: ['cherry', '🍒'],
        emoji: '🍒',
        display_name: 'Cherry',
        sticker_id: "CAACAgIAAxkBAAEQnoFpnyHlfKoDssWIpZHbKrjgBUkgAQACy5AAAv894EjYncv41k4_XzoE"
    },
    'cabbage': {
        keywords: ['cabbage', '🥬'],
        emoji: '🥬',
        display_name: 'Cabbage',
        sticker_id: "CAACAgIAAxkBAAEQnoNpnyHvhLutfLJmqqqqk8_TWy-8wAACZ5YAAho06UipuXAdrrQYXToE"
    },
    'bamboo': {
        keywords: ['bamboo', '🎋'],
        emoji: '🎋',
        display_name: 'Bamboo',
        sticker_id: "CAACAgIAAxkBAAEQpw1ppGFmoB8w-C71IZOkeBOG029w5QAC4psAAsOUIEnsw-M936B9BjoE"
    },
    'mango': {
        keywords: ['mango', '🥭'],
        emoji: '🥭',
        display_name: 'Mango',
        sticker_id: "CAACAgIAAxkBAAEQpw9ppGFstEgOkpR-HLILv_ugOZVViQACkZYAAu_cIUnaEdl_e13gzDoE"
    }
};

// ===== ID КАНАЛА (ТВОЙ) =====
const STOCKS_CHANNEL_ID = '1474799488689377463';

// ===== TELEGRAM НАСТРОЙКИ =====
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_BOT_CHAT_ID;
const TELEGRAM_STICKER_CHANNEL = process.env.STOCKS_TELEGRAM_CHANNEL;

// ===== УПРАВЛЕНИЕ БОТОМ =====
let botEnabled = true;
let processedIds = [];
let lastCommandTime = 0;
let reconnectAttempts = 0;
let consecutiveErrors = 0;
let lastMessageTime = Date.now();

// ===== ЗАГРУЗКА/СОХРАНЕНИЕ СОСТОЯНИЯ =====
async function loadState() {
    try {
        const data = await fs.readFile('state.json', 'utf8');
        const loaded = JSON.parse(data);
        processedIds = Array.isArray(loaded.processedIds) ? loaded.processedIds : [];
        console.log(`📂 Загружено состояние: ${processedIds.length} обработанных сообщений`);
    } catch (error) {
        console.log('🆕 Новое состояние');
        processedIds = [];
    }
}

async function saveState() {
    try {
        await fs.writeFile('state.json', JSON.stringify({ processedIds }, null, 2));
        console.log('💾 Состояние сохранено');
    } catch (error) {
        console.error('❌ Ошибка сохранения:', error.message);
    }
}

// ===== ФУНКЦИЯ ОТПРАВКИ В TELEGRAM =====
async function sendTelegram(text, parseMode = 'HTML') {
    if (!botEnabled) {
        console.log('🔇 Бот отключен, сообщение не отправлено');
        return false;
    }
    
    const maxRetries = 3;
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
        try {
            const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
            const data = {
                chat_id: TELEGRAM_CHAT_ID,
                text: text,
                parse_mode: parseMode
            };
            
            await axios.post(url, data, {
                httpAgent: httpAgent,
                httpsAgent: httpsAgent,
                timeout: 10000
            });
            
            console.log('✅ Отправлено в Telegram');
            return true;
            
        } catch (error) {
            if (error.response?.status === 429) {
                const retryAfter = error.response.data?.parameters?.retry_after || 30;
                console.log(`⏳ Telegram rate limit, жду ${retryAfter} секунд...`);
                await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                retryCount++;
            } else {
                console.error('❌ Ошибка Telegram:', error.message);
                return false;
            }
        }
    }
    
    console.error('❌ Превышено количество попыток отправки в Telegram');
    return false;
}

async function sendTelegramSticker(stickerId) {
    if (!botEnabled) {
        console.log('🔇 Бот отключен, стикер не отправлен');
        return false;
    }
    
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendSticker`;
        const data = {
            chat_id: TELEGRAM_STICKER_CHANNEL,
            sticker: stickerId
        };
        await axios.post(url, data, {
            httpAgent: httpAgent,
            httpsAgent: httpsAgent,
            timeout: 10000
        });
        console.log('✅ Стикер отправлен');
        return true;
    } catch (error) {
        console.error('❌ Ошибка стикера:', error.message);
        return false;
    }
}

// ===== ПОИСК РОЛИ НА ВСЕХ СЕРВЕРАХ =====
async function findRoleName(roleId) {
    for (const [, guild] of client.guilds.cache) {
        const role = guild.roles.cache.get(roleId);
        if (role) {
            return role.name;
        }
    }
    return null;
}

// ===== ПАРСИНГ КОМПОНЕНТОВ =====
function extractTextFromComponents(components) {
    if (!components || components.length === 0) return '';
    
    let text = '';
    
    function extract(comp) {
        if (comp.content) {
            text += comp.content + '\n';
        }
        if (comp.components) {
            comp.components.forEach(extract);
        }
    }
    
    components.forEach(extract);
    return text;
}

// ===== ПРОВЕРКА ЦЕЛЕВЫХ ПРЕДМЕТОВ =====
function checkTargetItems(items) {
    const found = [];
    
    for (const item of items) {
        const itemName = item.name.toLowerCase();
        
        for (const [key, target] of Object.entries(TARGET_ITEMS)) {
            for (const keyword of target.keywords) {
                if (itemName.includes(keyword.toLowerCase()) || 
                    itemName.includes(target.display_name.toLowerCase())) {
                    found.push({
                        key: key,
                        ...target,
                        count: item.count
                    });
                    break;
                }
            }
        }
    }
    
    return found;
}

// ===== ПАРСИНГ КАНАЛА (ДЛЯ POLLING) =====
async function parseSeedChannel() {
    try {
        const channel = await client.channels.fetch(STOCKS_CHANNEL_ID);
        if (!channel) return null;
        
        const messages = await channel.messages.fetch({ limit: 1 });
        const msg = messages.first();
        
        if (!msg || !msg.components || !msg.components.length) {
            return null;
        }
        
        const messageAge = Date.now() - msg.createdTimestamp;
        const maxAge = 5 * 60 * 1000;
        
        if (messageAge > maxAge) {
            return null;
        }
        
        if (processedIds.includes(msg.id)) {
            return null;
        }
        
        const text = extractTextFromComponents(msg.components);
        const lines = text.split('\n');
        const items = [];
        
        for (const line of lines) {
            const match = line.match(/<@&(\d+)>\s*\(x(\d+)\)/);
            if (match) {
                const roleId = match[1];
                const count = parseInt(match[2]);
                const name = await findRoleName(roleId);
                
                if (name) {
                    items.push({ 
                        name: name, 
                        count: count,
                        roleId: roleId
                    });
                }
            }
        }
        
        return items.length ? items : null;
        
    } catch (error) {
        console.error('❌ Ошибка парсинга:', error.message);
        return null;
    }
}

// ===== ОБРАБОТКА КОМАНД ИЗ TELEGRAM =====
async function checkTelegramCommands() {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=-1&timeout=0`;
        const response = await axios.get(url, {
            httpAgent: httpAgent,
            httpsAgent: httpsAgent
        });
        const updates = response.data.result;
        
        for (const update of updates) {
            if (update.message && update.message.text) {
                const text = update.message.text.toLowerCase();
                const chatId = update.message.chat.id;
                const commandTime = update.message.date * 1000;
                
                if (commandTime < lastCommandTime) continue;
                
                if (chatId.toString() === TELEGRAM_CHAT_ID) {
                    if (text === '/enable' || text === '/start') {
                        if (!botEnabled) {
                            botEnabled = true;
                            lastCommandTime = commandTime;
                            await sendTelegram('✅ Бот включен');
                            console.log('✅ Бот включен по команде');
                        }
                    } else if (text === '/disable' || text === '/stop') {
                        if (botEnabled) {
                            botEnabled = false;
                            lastCommandTime = commandTime;
                            await sendTelegram('🔇 Бот отключен');
                            console.log('🔇 Бот отключен по команде');
                        }
                    } else if (text === '/status') {
                        lastCommandTime = commandTime;
                        const status = botEnabled ? '✅ Включен' : '🔇 Отключен';
                        const targets = Object.values(TARGET_ITEMS).map(t => t.emoji).join(' ');
                        await sendTelegram(`📊 <b>Статус бота</b>\n• Режим: ${status}\n• Обработано сообщений: ${processedIds.length}\n• Отслеживаю: ${targets}`);
                    }
                }
            }
        }
    } catch (error) {
        console.error('❌ Ошибка проверки команд:', error.message);
    }
}

// ===== ПРОВЕРКА IP ЧЕРЕЗ ПРОКСИ =====
async function checkProxyIP() {
    try {
        const response = await axios.get('https://api.ipify.org?format=json', { 
            httpsAgent: proxyAgent,
            timeout: 10000 
        });
        console.log('🌐 Внешний IP через прокси:', response.data.ip);
        await sendTelegram(`🌐 <b>Бот работает через прокси</b>\nIP: ${response.data.ip}`);
        return response.data.ip;
    } catch (error) {
        console.error('❌ Не удалось проверить IP через прокси:', error.message);
        return null;
    }
}

// ===== МГНОВЕННАЯ ОБРАБОТКА ЧЕРЕЗ WEBSOCKET =====
client.on('messageCreate', async (message) => {
    try {
        if (message.channel.id !== STOCKS_CHANNEL_ID) return;
        if (message.author.username.toLowerCase() !== 'dawnbot') return;
        
        if (processedIds.includes(message.id)) {
            console.log(`⏭️ WebSocket: сообщение ${message.id} уже обработано`);
            return;
        }
        
        console.log(`⚡ WebSocket: получено новое сообщение ${message.id}`);
        lastMessageTime = Date.now();
        consecutiveErrors = 0;
        
        const text = extractTextFromComponents(message.components);
        if (!text) return;
        
        const lines = text.split('\n');
        const items = [];
        
        for (const line of lines) {
            const match = line.match(/<@&(\d+)>\s*\(x(\d+)\)/);
            if (match) {
                const roleId = match[1];
                const count = parseInt(match[2]);
                const name = await findRoleName(roleId);
                
                if (name) {
                    items.push({ name, count, roleId });
                }
            }
        }
        
        if (items.length === 0) return;
        
        const found = checkTargetItems(items);
        
        processedIds.push(message.id);
        if (processedIds.length > 100) processedIds.shift();
        await saveState();
        
        if (botEnabled) {
            const time = new Date().toLocaleTimeString();
            
            if (found.length > 0) {
                console.log(`🎯 WebSocket: НАЙДЕНЫ ЦЕЛЕВЫЕ ПРЕДМЕТЫ: ${found.map(f => f.display_name).join(', ')}`);
                
                for (const item of found) {
                    if (item.sticker_id) {
                        await sendTelegramSticker(item.sticker_id);
                    }
                }
                
                let messageText = `⚡ <b>Мгновенно! Найдены предметы в ${time}</b>\n\n`;
                for (const item of items) {
                    const isTarget = found.some(f => f.display_name === item.name);
                    const emoji = isTarget ? '✅ ' : '';
                    messageText += `${emoji}• ${item.name} — ${item.count}\n`;
                }
                await sendTelegram(messageText);
                
            } else {
                console.log(`📊 WebSocket: целевые предметы не найдены`);
                
                let messageText = `📊 <b>Сток в ${time}</b>\n`;
                messageText += `🎯 Целевые предметы: не найдены\n\n`;
                for (const item of items) {
                    messageText += `• ${item.name} — ${item.count}\n`;
                }
                await sendTelegram(messageText);
            }
        } else {
            console.log(`🔇 WebSocket: бот отключен, уведомления не отправлены`);
        }
        
    } catch (error) {
        console.error('❌ Ошибка в WebSocket обработчике:', error.message);
    }
});

// ===== ПЕРИОДИЧЕСКАЯ ПРОВЕРКА =====
async function checkAll() {
    try {
        await checkTelegramCommands();
        
        const items = await parseSeedChannel();
        
        if (items && items.length > 0 && botEnabled) {
            const found = checkTargetItems(items);
            
            if (found.length > 0) {
                console.log('⚠️ Polling: найдены целевые предметы в пропущенном сообщении');
                
                const time = new Date().toLocaleTimeString();
                let messageText = `⚠️ <b>Внимание! Найдены предметы (пропущенный сток) в ${time}</b>\n\n`;
                
                for (const item of items) {
                    const isTarget = found.some(f => f.display_name === item.name);
                    const emoji = isTarget ? '✅ ' : '';
                    messageText += `${emoji}• ${item.name} — ${item.count}\n`;
                }
                
                for (const item of found) {
                    if (item.sticker_id) {
                        await sendTelegramSticker(item.sticker_id);
                    }
                }
                
                await sendTelegram(messageText);
            }
        }
        
        consecutiveErrors = 0;
        
    } catch (error) {
        console.error('❌ Ошибка в checkAll:', error.message);
        consecutiveErrors++;
    }
}

// ===== ИНТЕЛЛЕКТУАЛЬНАЯ ЗАДЕРЖКА =====
function getIntelligentDelay() {
    const baseDelay = 25000;
    const randomFactor = Math.random() * 10000;
    
    if (consecutiveErrors > 0) {
        const errorPenalty = Math.min(consecutiveErrors * 5000, 30000);
        return baseDelay + randomFactor + errorPenalty;
    }
    
    if (Math.random() < 0.2) {
        return baseDelay + randomFactor + 15000;
    }
    
    return baseDelay + randomFactor;
}

async function startIntelligentLoop() {
    while (true) {
        await checkAll();
        const delay = getIntelligentDelay();
        console.log(`⏳ Следующая проверка через ${Math.round(delay / 1000)} секунд...`);
        await new Promise(resolve => setTimeout(resolve, delay));
    }
}

// ===== ОБРАБОТКА ОТКЛЮЧЕНИЯ =====
client.on('disconnect', async () => {
    console.log('⚠️ WebSocket отключен!');
    await sendTelegram('⚠️ <b>Потеря соединения с Discord</b>\nПытаюсь переподключиться...');
    reconnectAttempts++;
    
    const reconnectDelay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
    console.log(`⏳ Переподключение через ${reconnectDelay / 1000} секунд...`);
    await new Promise(resolve => setTimeout(resolve, reconnectDelay));
});

client.on('error', async (error) => {
    console.error('❌ Ошибка WebSocket:', error.message);
    
    if (consecutiveErrors % 5 === 0) {
        await sendTelegram(`❌ <b>Ошибка WebSocket:</b> ${error.message}`);
    }
    consecutiveErrors++;
});

// ===== ПРОВЕРКА ЗДОРОВЬЯ СОЕДИНЕНИЯ =====
setInterval(async () => {
    try {
        if (!client.ws?.ping) {
            console.log('⚠️ WebSocket ping недоступен');
            return;
        }
        
        console.log(`📡 WebSocket пинг: ${client.ws.ping}ms`);
        
        if (client.ws.ping > 5000 && botEnabled) {
            console.log(`⚠️ Высокий пинг: ${client.ws.ping}ms`);
            await sendTelegram(`⚠️ <b>Высокий пинг WebSocket</b>\nПинг: ${client.ws.ping}ms`);
        }
        
        const timeSinceLastMessage = Date.now() - lastMessageTime;
        if (timeSinceLastMessage > 10 * 60 * 1000 && botEnabled) {
            console.log(`⚠️ Нет сообщений ${Math.round(timeSinceLastMessage / 60000)} минут`);
            await sendTelegram(`⚠️ <b>Бот не получает сообщения</b>\nПоследнее сообщение было ${Math.round(timeSinceLastMessage / 60000)} минут назад`);
        }
        
        reconnectAttempts = 0;
        
    } catch (error) {
        console.error('❌ Ошибка проверки пинга:', error.message);
    }
}, 60000);

// ===== САМОПИНГ ДЛЯ RENDER =====
setInterval(async () => {
    try {
        const response = await axios.get(`https://stock-bot2.onrender.com/health`, {
            httpAgent: httpAgent,
            httpsAgent: httpsAgent,
            timeout: 5000
        });
        console.log(`🏓 Самопинг: ${response.status} - ${response.data.time}`);
    } catch (error) {
        console.error('❌ Ошибка самопинга:', error.message);
    }
}, 300000);

// ===== ЗАПУСК =====
client.on('ready', async () => {
    console.log(`✅ Залогинен как ${client.user.tag}`);
    await loadState();
    
    // Проверяем IP через прокси
    const proxyIP = await checkProxyIP();
    
    const startupDelay = Math.random() * 5000 + 2000;
    console.log(`⏳ Ожидание ${Math.round(startupDelay / 1000)} секунд перед началом...`);
    await new Promise(resolve => setTimeout(resolve, startupDelay));
    
    const targets = Object.values(TARGET_ITEMS).map(t => t.emoji).join(' ');
    await sendTelegram(`🤖 <b>Бот запущен в режиме WebSocket!</b>\n📊 Отслеживаю: ${targets}\n📝 Команды: /enable, /disable, /status${proxyIP ? `\n🌐 Прокси: ${proxyIP}` : ''}`);
    
    startIntelligentLoop();
    
    lastMessageTime = Date.now();
    console.log('👀 Бот запущен и слушает WebSocket');
});

client.login(process.env.USER_TOKEN);
