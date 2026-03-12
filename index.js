require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const axios = require('axios');
const fs = require('fs').promises;
const express = require('express');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');

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
// ======================================

// ===== НАСТРОЙКА ПРОКСИ =====
const PROXY_URL = process.env.PROXY_URL;
const PROXY_PORTS = ['1080', '1081', '1082', '1083', '1084', '1085']; // Основные порты ProxyCove
let currentProxyIndex = 0;
let proxyAgent = null;
let proxyFailCount = 0;
let currentProxyUrl = PROXY_URL;

// Функция для смены порта прокси
function rotateProxyPort() {
    if (!PROXY_URL) return null;
    
    try {
        // Разбираем URL прокси
        const match = PROXY_URL.match(/(.+):(\d+)$/);
        if (!match) return PROXY_URL;
        
        const baseUrl = match[1];
        const currentPort = match[2];
        
        // Берем следующий порт из списка
        const newPort = PROXY_PORTS[++currentProxyIndex % PROXY_PORTS.length];
        const newProxyUrl = `${baseUrl}:${newPort}`;
        
        console.log(`🔄 Смена прокси: порт ${currentPort} -> ${newPort}`);
        return newProxyUrl;
    } catch (error) {
        console.error('❌ Ошибка смены прокси:', error.message);
        return PROXY_URL;
    }
}

// Функция для тестирования прокси
async function testProxy(proxyUrl) {
    if (!proxyUrl) return true;
    
    try {
        const agent = proxyUrl.startsWith('socks') 
            ? new SocksProxyAgent(proxyUrl)
            : new HttpsProxyAgent(proxyUrl);
            
        const response = await axios.get('https://api.ipify.org?format=json', {
            httpAgent: agent,
            httpsAgent: agent,
            timeout: 10000
        });
        
        console.log(`✅ Прокси работает, внешний IP: ${response.data.ip}`);
        return true;
    } catch (error) {
        console.log(`❌ Прокси не работает: ${error.message}`);
        return false;
    }
}

// Функция для получения рабочего прокси
async function getWorkingProxy() {
    if (!PROXY_URL) return null;
    
    let currentUrl = PROXY_URL;
    let attempts = 0;
    const maxAttempts = PROXY_PORTS.length * 2;
    
    while (attempts < maxAttempts) {
        console.log(`🔍 Проверка прокси (попытка ${attempts + 1}/${maxAttempts})...`);
        
        if (await testProxy(currentUrl)) {
            console.log('✅ Найден рабочий прокси');
            return currentUrl;
        }
        
        currentUrl = rotateProxyPort();
        attempts++;
        
        // Пауза между попытками
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.log('❌ Не удалось найти рабочий прокси');
    return null;
}

// ===== ОСНОВНЫЕ НАСТРОЙКИ =====
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

const STOCKS_CHANNEL_ID = '1474799488689377463';

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_BOT_CHAT_ID;
const TELEGRAM_STICKER_CHANNEL = process.env.STOCKS_TELEGRAM_CHANNEL;

// ===== УПРАВЛЕНИЕ СОСТОЯНИЕМ =====
let botEnabled = true;
let processedIds = [];
let lastCommandTime = 0;
let reconnectAttempts = 0;
let lastError = null;
let errorCount = 0;

// ===== СТАТИСТИКА =====
const stats = {
    startTime: Date.now(),
    totalMessages: 0,
    targetFound: 0,
    errors: 0,
    proxySwitches: 0
};

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

// ===== TELEGRAM ФУНКЦИИ =====
async function sendTelegram(text, parseMode = 'HTML') {
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

// ===== ПОИСК РОЛИ =====
async function findRoleName(roleId) {
    // Эта функция будет использовать client, поэтому она должна вызываться только после создания client
    return null; // Временно
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

// ===== ОБРАБОТКА КОМАНД =====
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
                        }
                    } else if (text === '/disable' || text === '/stop') {
                        if (botEnabled) {
                            botEnabled = false;
                            lastCommandTime = commandTime;
                            await sendTelegram('🔇 Бот отключен');
                        }
                    } else if (text === '/status') {
                        lastCommandTime = commandTime;
                        const status = botEnabled ? '✅ Включен' : '🔇 Отключен';
                        const targets = Object.values(TARGET_ITEMS).map(t => t.emoji).join(' ');
                        const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
                        const hours = Math.floor(uptime / 3600);
                        const minutes = Math.floor((uptime % 3600) / 60);
                        
                        await sendTelegram(
                            `📊 <b>Статус бота</b>\n` +
                            `• Режим: ${status}\n` +
                            `• Прокси: ${PROXY_URL ? '✅ Да' : '❌ Нет'}\n` +
                            `• Смен прокси: ${stats.proxySwitches}\n` +
                            `• Сообщений: ${stats.totalMessages}\n` +
                            `• Найдено целей: ${stats.targetFound}\n` +
                            `• Ошибок: ${stats.errors}\n` +
                            `• Аптайм: ${hours}ч ${minutes}м\n` +
                            `• Отслеживаю: ${targets}`
                        );
                    }
                }
            }
        }
    } catch (error) {
        console.error('❌ Ошибка проверки команд:', error.message);
    }
}

// ===== ДИАГНОСТИКА =====
setInterval(async () => {
    console.log('\n🔍 Запуск диагностики...');
    
    try {
        const response = await axios.get('https://discord.com/api/v9/gateway', {
            timeout: 10000,
            validateStatus: false
        });
        
        if (response.status === 200) {
            console.log('🌐 Discord HTTP доступен');
        } else if (response.status === 429) {
            const retryAfter = response.headers['retry-after'] || 60;
            console.log(`🌐 Discord HTTP: 429, retry after ${retryAfter}s`);
            await sendTelegram(`⚠️ Discord rate limit, жду ${retryAfter}с`);
            
            // Автоматическая смена прокси при 429
            if (PROXY_URL) {
                stats.proxySwitches++;
                const newProxy = rotateProxyPort();
                if (newProxy) {
                    proxyAgent = newProxy.startsWith('socks') 
                        ? new SocksProxyAgent(newProxy)
                        : new HttpsProxyAgent(newProxy);
                    currentProxyUrl = newProxy;
                    console.log('🔄 Прокси заменен на новый порт');
                }
            }
        }
        
        console.log('📊 Ожидание подключения к Discord...');
        
    } catch (error) {
        console.error('❌ Ошибка диагностики:', error.message);
    }
    
    console.log('🔍 Диагностика завершена\n');
}, 60000);

// ===== САМОПИНГ =====
setInterval(async () => {
    try {
        const response = await axios.get(`https://stock-bot2.onrender.com/health`);
        console.log(`🏓 Самопинг: ${response.status} - ${response.data.time}`);
    } catch (error) {
        console.error('❌ Ошибка самопинга:', error.message);
    }
}, 300000);

// ===== СТАТИСТИКА КАЖДЫЙ ЧАС =====
setInterval(() => {
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    
    console.log(`\n📊 СТАТИСТИКА ЗА ${hours}ч ${minutes}м:`);
    console.log(`   Сообщений обработано: ${stats.totalMessages}`);
    console.log(`   Целей найдено: ${stats.targetFound}`);
    console.log(`   Смен прокси: ${stats.proxySwitches}`);
    console.log(`   Ошибок: ${stats.errors}`);
    console.log(`   В памяти: ${processedIds.length} сообщений\n`);
}, 3600000);

// ===== ЗАПУСК =====
async function startBot() {
    console.log('🚀 Запуск бота...');
    
    // Сначала инициализируем прокси
    const workingProxy = await getWorkingProxy();
    currentProxyUrl = workingProxy;
    
    // Создаем клиента ТОЛЬКО после настройки прокси
    const clientOptions = {};
    if (workingProxy) {
        if (workingProxy.startsWith('socks')) {
            proxyAgent = new SocksProxyAgent(workingProxy);
        } else {
            proxyAgent = new HttpsProxyAgent(workingProxy);
        }
        clientOptions.http = { agent: proxyAgent };
        console.log('🔌 Прокси будет использоваться для подключения');
    }
    
    // СОЗДАЕМ КЛИЕНТА ЗДЕСЬ
    const client = new Client(clientOptions);
    
    // Обновляем функцию поиска роли, чтобы использовать client
    async function findRoleName(roleId) {
        for (const [, guild] of client.guilds.cache) {
            const role = guild.roles.cache.get(roleId);
            if (role) {
                return role.name;
            }
        }
        return null;
    }
    
    // ===== ВСЕ ОБРАБОТЧИКИ ПЕРЕНОСИМ СЮДА =====
    
    client.on('messageCreate', async (message) => {
        try {
            if (message.channel.id !== STOCKS_CHANNEL_ID) return;
            if (message.author.username.toLowerCase() !== 'dawnbot') return;
            
            if (processedIds.includes(message.id)) {
                console.log(`⏭️ WebSocket: сообщение ${message.id} уже обработано`);
                return;
            }
            
            console.log(`⚡ WebSocket: получено новое сообщение ${message.id}`);
            stats.totalMessages++;
            
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
                        console.log(`🎯 Найден предмет: ${name} x${count}`);
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
                    stats.targetFound += found.length;
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
            }
            
        } catch (error) {
            console.error('❌ Ошибка в WebSocket обработчике:', error.message);
            stats.errors++;
            lastError = `WebSocket: ${error.message}`;
        }
    });
    
    client.on('ready', async () => {
        console.log(`✅ Залогинен как ${client.user.tag}`);
        await loadState();
        
        const targets = Object.values(TARGET_ITEMS).map(t => t.emoji).join(' ');
        const proxyStatus = PROXY_URL ? '✅ Да' : '❌ Нет';
        
        await sendTelegram(
            `🤖 <b>Бот запущен в режиме WebSocket!</b>\n` +
            `📊 Отслеживаю: ${targets}\n` +
            `🌐 Прокси: ${proxyStatus}\n` +
            `🔄 Автосмена прокси: ${PROXY_PORTS.length} портов\n` +
            `📝 Команды: /enable, /disable, /status`
        );
        
        setInterval(checkAll, 30 * 1000);
        console.log('👀 Бот запущен и слушает WebSocket');
        errorCount = 0;
        lastError = null;
    });
    
    client.on('error', async (error) => {
        console.error('❌ Ошибка WebSocket:', error);
        stats.errors++;
        lastError = error.message;
        
        if (error.message.includes('429') || error.message.includes('ECONNREFUSED')) {
            stats.proxySwitches++;
            console.log('🔄 Попытка смены прокси...');
            
            const newProxy = rotateProxyPort();
            if (newProxy && newProxy !== currentProxyUrl) {
                proxyAgent = newProxy.startsWith('socks') 
                    ? new SocksProxyAgent(newProxy)
                    : new HttpsProxyAgent(newProxy);
                currentProxyUrl = newProxy;
                
                console.log('✅ Прокси заменен');
                await sendTelegram('🔄 Прокси заменен из-за ошибки');
            }
        }
    });
    
    // ===== ПЕРИОДИЧЕСКАЯ ПРОВЕРКА =====
    async function checkAll() {
        await checkTelegramCommands();
        
        const items = await parseSeedChannel();
        
        if (items && items.length > 0 && botEnabled) {
            const found = checkTargetItems(items);
            
            if (found.length > 0) {
                stats.targetFound += found.length;
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
    }
    
    // ===== ПАРСИНГ КАНАЛА =====
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
    
    // ===== ОБРАБОТКА ОТКЛЮЧЕНИЯ =====
    client.on('disconnect', async (event) => {
        const errorMsg = event?.reason || 'Неизвестная причина';
        console.log(`⚠️ WebSocket отключен! Причина: ${errorMsg}`);
        lastError = `Отключение: ${errorMsg}`;
        await sendTelegram(`⚠️ <b>WebSocket отключен</b>\nПричина: ${errorMsg}\nПопытка ${reconnectAttempts + 1}`);
        reconnectAttempts++;
    });
    
    // ===== ДИАГНОСТИКА WEBSOCKET =====
    client.ws.on('shardReady', async (shardId) => {
        console.log(`✅ Шард ${shardId} готов`);
        errorCount = 0;
        reconnectAttempts = 0;
        lastError = null;
        await sendTelegram(`✅ WebSocket шард ${shardId} готов к работе`);
    });
    
    client.ws.on('shardResumed', async (shardId, replayed) => {
        console.log(`🔄 Шард ${shardId} возобновил работу, пропущено событий: ${replayed}`);
        await sendTelegram(`🔄 WebSocket возобновил работу\nПропущено событий: ${replayed}`);
    });
    
    client.ws.on('shardDisconnect', async (event, shardId) => {
        const closeCode = event?.code || 'неизвестный код';
        const reason = event?.reason || 'без объяснения';
        console.log(`⚠️ Шард ${shardId} отключен. Код: ${closeCode}, Причина: ${reason}`);
        lastError = `Шард ${shardId} отключен. Код: ${closeCode}`;
        await sendTelegram(`⚠️ <b>WebSocket шард ${shardId} отключен</b>\nКод: ${closeCode}\nПричина: ${reason}`);
    });
    
    // ===== УСИЛЕННЫЙ МОНИТОРИНГ СОЕДИНЕНИЯ =====
    setInterval(async () => {
        try {
            if (!client.ws) {
                console.log('⚠️ WebSocket менеджер недоступен');
                return;
            }
            
            const shard = client.ws.shards?.first();
            
            if (!shard) {
                console.log('⚠️ Нет активных шардов');
                return;
            }
            
            const status = shard.status;
            const ping = shard.ping;
            
            const statusMap = {
                0: 'CONNECTING',
                1: 'CONNECTED',
                2: 'RECONNECTING',
                3: 'IDLE',
                4: 'NEARLY',
                5: 'DISCONNECTED'
            };
            
            console.log(`📡 Шард статус: ${statusMap[status] || status}, пинг: ${ping || 'N/A'}ms`);
            
            if (status === 5 || (status === 2 && reconnectAttempts > 3)) {
                console.log('🔄 Обнаружена критическая проблема, перезапускаю шард...');
                await sendTelegram(`🔄 Критическая проблема WebSocket\nСтатус: ${statusMap[status]}\nПопыток: ${reconnectAttempts}`);
                shard.destroy({ reset: true });
                reconnectAttempts++;
            }
            
            errorCount = 0;
            
        } catch (error) {
            console.error('❌ Ошибка мониторинга:', error.message);
            lastError = `Мониторинг: ${error.message}`;
            errorCount++;
            
            if (errorCount > 5) {
                console.log('🔥 Критическая ошибка мониторинга, выполняю перезапуск...');
                await sendTelegram('🔥 Критическая ошибка мониторинга, перезапускаюсь...');
                process.exit(1);
            }
        }
    }, 30000);
    
    // Запускаем клиента
    client.login(process.env.USER_TOKEN);
}

// ===== ГЛОБАЛЬНЫЕ ОБРАБОТЧИКИ ОШИБОК =====
process.on('uncaughtException', async (error) => {
    console.error('💥 Непойманная ошибка:', error);
    stats.errors++;
    await sendTelegram(`💥 <b>Критическая ошибка</b>\n${error.message}`);
    
    // Пробуем перезапустить через 30 секунд
    setTimeout(() => {
        console.log('🔄 Перезапуск после критической ошибки...');
        process.exit(1);
    }, 30000);
});

process.on('unhandledRejection', async (error) => {
    console.error('💥 Unhandled Rejection:', error);
    stats.errors++;
    await sendTelegram(`💥 <b>Unhandled Rejection</b>\n${error.message}`);
});

// ===== ЗАПУСК =====
startBot().catch(error => {
    console.error('❌ Ошибка запуска:', error);
    process.exit(1);
});
