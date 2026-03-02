require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const axios = require('axios');
const fs = require('fs').promises;
const express = require('express');

// ===== Express сервер для Render =====
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('🌱 Garden Horizons Bot is running!');
});

app.listen(port, () => {
    console.log(`✅ Web server running on port ${port}`);
});
// ======================================

const client = new Client();

// ===== ТВОИ ЦЕЛЕВЫЕ ПРЕДМЕТЫ (ТОЛЬКО НУЖНЫЕ) =====
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
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
        const data = {
            chat_id: TELEGRAM_CHAT_ID,
            text: text,
            parse_mode: parseMode
        };
        await axios.post(url, data);
        console.log('✅ Отправлено в Telegram');
        return true;
    } catch (error) {
        console.error('❌ Ошибка Telegram:', error.message);
        return false;
    }
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
        await axios.post(url, data);
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
        
        // Проверка на свежесть (5 минут)
        const messageAge = Date.now() - msg.createdTimestamp;
        const maxAge = 5 * 60 * 1000;
        
        if (messageAge > maxAge) {
            return null;
        }
        
        // Защита от дублей
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
        const response = await axios.get(url);
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
                
                let message = `⚡ <b>Мгновенно! Найдены предметы в ${time}</b>\n\n`;
                for (const item of items) {
                    const isTarget = found.some(f => f.display_name === item.name);
                    const emoji = isTarget ? '✅ ' : '';
                    message += `${emoji}• ${item.name} — ${item.count}\n`;
                }
                await sendTelegram(message);
                
            } else {
                console.log(`📊 WebSocket: целевые предметы не найдены`);
                
                let message = `📊 <b>Сток в ${time}</b>\n`;
                message += `🎯 Целевые предметы: не найдены\n\n`;
                for (const item of items) {
                    message += `• ${item.name} — ${item.count}\n`;
                }
                await sendTelegram(message);
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
    await checkTelegramCommands();
    
    const items = await parseSeedChannel();
    
    if (items && items.length > 0) {
        console.log('⚠️ Polling: найдено пропущенное сообщение');
        
        if (botEnabled) {
            const time = new Date().toLocaleTimeString();
            let message = `📋 <b>Пропущенный сток в ${time}</b>\n\n`;
            for (const item of items) {
                message += `• ${item.name} — ${item.count}\n`;
            }
            await sendTelegram(message);
        }
    }
}

// ===== ЗАПУСК =====
client.on('ready', async () => {
    console.log(`✅ Залогинен как ${client.user.tag}`);
    await loadState();
    
    const targets = Object.values(TARGET_ITEMS).map(t => t.emoji).join(' ');
    await sendTelegram(`🤖 <b>Бот запущен в режиме WebSocket!</b>\n📊 Отслеживаю: ${targets}\n📝 Команды: /enable, /disable, /status`);
    
    setInterval(checkAll, 30 * 1000);
    console.log('👀 Бот запущен и слушает WebSocket');
});

client.login(process.env.USER_TOKEN);
