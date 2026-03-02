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

// ===== ТВОИ ЦЕЛЕВЫЕ ПРЕДМЕТЫ =====
const TARGET_ITEMS = {
    'cherry': {
        keywords: ['cherry', '🍒'],
        emoji: '🍒',
        display_name: 'Cherry'
    },
    'cabbage': {
        keywords: ['cabbage', '🥬'],
        emoji: '🥬',
        display_name: 'Cabbage'
    },
    'bamboo': {
        keywords: ['bamboo', '🎋'],
        emoji: '🎋',
        display_name: 'Bamboo'
    },
    'mango': {
        keywords: ['mango', '🥭'],
        emoji: '🥭',
        display_name: 'Mango'
    }
};

// ===== ID КАНАЛА (ТВОЙ) =====
const STOCKS_CHANNEL_ID = '1474799488689377463';

// ===== TELEGRAM НАСТРОЙКИ =====
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_BOT_CHAT_ID;
const TELEGRAM_STICKER_CHANNEL = process.env.STOCKS_TELEGRAM_CHANNEL;

// ===== Хранилище данных =====
let stockData = {
    seeds: [],
    lastUpdate: null,
    processedIds: []
};

// ===== ЗАГРУЗКА/СОХРАНЕНИЕ СОСТОЯНИЯ =====
async function loadState() {
    try {
        const data = await fs.readFile('state.json', 'utf8');
        stockData = JSON.parse(data);
        console.log('📂 Загружено состояние');
    } catch (error) {
        console.log('🆕 Новое состояние');
    }
}

async function saveState() {
    await fs.writeFile('state.json', JSON.stringify(stockData, null, 2));
}

// ===== ФУНКЦИЯ ОТПРАВКИ В TELEGRAM =====
async function sendTelegram(text, parseMode = 'HTML') {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
        const data = {
            chat_id: TELEGRAM_CHAT_ID,
            text: text,
            parse_mode: parseMode
        };
        const response = await axios.post(url, data);
        console.log('✅ Отправлено в Telegram');
        return true;
    } catch (error) {
        console.error('❌ Ошибка Telegram:', error.message);
        return false;
    }
}

async function sendTelegramSticker(stickerId) {
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

// ===== ПАРСИНГ КАНАЛА С СЕМЕНАМИ =====
async function parseSeedChannel() {
    try {
        const channel = await client.channels.fetch(STOCKS_CHANNEL_ID);
        if (!channel) return null;
        
        const messages = await channel.messages.fetch({ limit: 1 });
        const msg = messages.first();
        
        if (!msg || !msg.components || !msg.components.length) {
            console.log('❌ Нет компонентов в сообщении');
            return null;
        }
        
        // Проверка на свежесть (5 минут)
        const messageAge = Date.now() - msg.createdTimestamp;
        const maxAge = 5 * 60 * 1000;
        
        if (messageAge > maxAge) {
            console.log(`⏰ Сообщение слишком старое (${Math.round(messageAge/60000)} мин)`);
            return null;
        }
        
        // Защита от дублей
        if (stockData.processedIds.includes(msg.id)) {
            console.log(`⏭️ Сообщение ${msg.id} уже обработано`);
            return null;
        }
        
        console.log(`📨 Новое сообщение ID: ${msg.id}`);
        
        const text = extractTextFromComponents(msg.components);
        console.log(`📄 Текст: ${text.substring(0, 100)}...`);
        
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
                    console.log(`🎯 Найден предмет: ${name} x${count}`);
                }
            }
        }
        
        // Добавляем ID в обработанные
        stockData.processedIds.push(msg.id);
        if (stockData.processedIds.length > 100) {
            stockData.processedIds.shift();
        }
        
        return items.length ? items : null;
        
    } catch (error) {
        console.error('❌ Ошибка парсинга:', error.message);
        return null;
    }
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

// ===== ОСНОВНАЯ ПРОВЕРКА =====
async function checkAll() {
    console.log(`\n🕒 ${new Date().toLocaleTimeString()} - Проверка...`);
    
    const seeds = await parseSeedChannel();
    
    if (seeds && seeds.length > 0) {
        // Проверяем, изменились ли семена
        if (JSON.stringify(seeds) !== JSON.stringify(stockData.seeds)) {
            console.log('🔄 Семена изменились!');
            stockData.seeds = seeds;
            stockData.lastUpdate = new Date().toISOString();
            await saveState();
            
            // Проверяем целевые предметы
            const found = checkTargetItems(seeds);
            
            if (found.length > 0) {
                console.log(`🎯 НАЙДЕНЫ ЦЕЛЕВЫЕ ПРЕДМЕТЫ: ${found.map(f => f.display_name).join(', ')}`);
                
                // Отправляем в Telegram
                const time = new Date().toLocaleTimeString();
                let message = `🎯 <b>Найдены предметы в ${time}</b>\n\n`;
                
                for (const item of seeds) {
                    const isTarget = found.some(f => f.display_name === item.name);
                    const emoji = isTarget ? '✅ ' : '';
                    message += `${emoji}• ${item.name} — ${item.count}\n`;
                }
                
                await sendTelegram(message);
                
                // Отправляем стикеры для найденных предметов
                for (const item of found) {
                    // Здесь нужно добавить ID стикеров из твоего старого кода
                    // await sendTelegramSticker(item.stickerId);
                }
            } else {
                console.log('📊 Целевые предметы не найдены');
                
                const time = new Date().toLocaleTimeString();
                let message = `📊 <b>Сток в ${time}</b>\n`;
                message += `🎯 Целевые предметы: не найдены\n\n`;
                
                for (const item of seeds) {
                    message += `• ${item.name} — ${item.count}\n`;
                }
                
                await sendTelegram(message);
            }
        } else {
            console.log('⏺️ Семена без изменений');
        }
    } else {
        console.log('⚠️ Нет данных от бота Dawn');
    }
}

// ===== ЗАПУСК =====
client.on('ready', async () => {
    console.log(`✅ Залогинен как ${client.user.tag}`);
    await loadState();
    await checkAll();
    setInterval(checkAll, 30 * 1000);
    console.log('👀 Бот запущен и следит за каналом');
});

client.login(process.env.USER_TOKEN);
