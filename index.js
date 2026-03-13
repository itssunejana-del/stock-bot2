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
const PROXY_PORTS = ['1080', '1081', '1082', '1083', '1084', '1085', '1086', '1087', '1088', '1089', '1090'];
let currentProxyIndex = 0;
let proxyAgent = null;
let currentProxyUrl = PROXY_URL;

// Функция для получения IP через разные сервисы
async function getPublicIp(agent = null) {
    const services = [
        'https://api.ipify.org?format=json',
        'https://api.my-ip.io/ip.json',
        'https://ipapi.co/json/',
        'https://ipinfo.io/json'
    ];
    
    for (const service of services) {
        try {
            const config = {
                timeout: 10000
            };
            if (agent) {
                config.httpAgent = agent;
                config.httpsAgent = agent;
            }
            
            const response = await axios.get(service, config);
            if (response.data && (response.data.ip || response.data.ip_address)) {
                return response.data.ip || response.data.ip_address;
            }
        } catch (e) {
            continue;
        }
    }
    return null;
}

// Функция для детальной проверки прокси
async function testProxy(proxyUrl) {
    if (!proxyUrl) return null;
    
    console.log('\n🔍 ДЕТАЛЬНАЯ ПРОВЕРКА ПРОКСИ');
    console.log(`📡 Прокси URL: ${proxyUrl}`);
    
    try {
        const agent = proxyUrl.startsWith('socks') 
            ? new SocksProxyAgent(proxyUrl)
            : new HttpsProxyAgent(proxyUrl);
        
        // 1. Проверяем IP через прокси
        const proxyIp = await getPublicIp(agent);
        console.log(`🌍 IP через прокси: ${proxyIp || 'не удалось определить'}`);
        
        // 2. Проверяем прямой IP Render
        const renderIp = await getPublicIp();
        console.log(`🏭 IP Render: ${renderIp || 'не удалось определить'}`);
        
        // 3. Сравниваем IP
        if (proxyIp && renderIp) {
            if (proxyIp === renderIp) {
                console.log('❌ КРИТИЧЕСКАЯ ОШИБКА: IP совпадают! Прокси НЕ РАБОТАЕТ!');
                return { success: false, proxyIp, renderIp, working: false };
            } else {
                console.log('✅ УСПЕХ: IP отличаются, прокси работает корректно');
                return { success: true, proxyIp, renderIp, working: true, agent };
            }
        } else {
            console.log('⚠️ Не удалось определить IP, но прокси может работать');
            return { success: true, proxyIp, renderIp, working: true, agent };
        }
        
    } catch (error) {
        console.log(`❌ Ошибка подключения через прокси: ${error.message}`);
        return { success: false, error: error.message, working: false };
    }
}

// Функция для смены порта прокси
function rotateProxyPort() {
    if (!PROXY_URL) return null;
    
    try {
        const match = PROXY_URL.match(/(.+):(\d+)$/);
        if (!match) return PROXY_URL;
        
        const baseUrl = match[1];
        const newPort = PROXY_PORTS[++currentProxyIndex % PROXY_PORTS.length];
        const newProxyUrl = `${baseUrl}:${newPort}`;
        
        console.log(`🔄 Смена прокси: порт ${match[2]} -> ${newPort}`);
        return newProxyUrl;
    } catch (error) {
        console.error('❌ Ошибка смены прокси:', error.message);
        return PROXY_URL;
    }
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
async function runDiagnostics(agent) {
    console.log('\n🔍 ЗАПУСК ПОЛНОЙ ДИАГНОСТИКИ');
    
    // 1. Проверяем прокси
    if (agent) {
        console.log('\n📡 ТЕСТ 1: Проверка прокси');
        const proxyIp = await getPublicIp(agent);
        const renderIp = await getPublicIp();
        console.log(`   IP через прокси: ${proxyIp || 'не определен'}`);
        console.log(`   IP Render: ${renderIp || 'не определен'}`);
        
        if (proxyIp && renderIp) {
            if (proxyIp === renderIp) {
                console.log('   ❌ Прокси НЕ РАБОТАЕТ - IP совпадают!');
                await sendTelegram(`🚨 КРИТИЧНО: Прокси не работает! IP совпадает с Render: ${renderIp}`);
            } else {
                console.log('   ✅ Прокси работает корректно');
            }
        }
    }
    
    // 2. Проверяем Discord API
    console.log('\n📡 ТЕСТ 2: Проверка Discord API');
    try {
        const discordResponse = await axios.get('https://discord.com/api/v9/gateway', {
            timeout: 10000,
            validateStatus: false,
            httpAgent: agent,
            httpsAgent: agent
        });
        
        if (discordResponse.status === 200) {
            console.log('   ✅ Discord API доступен');
        } else if (discordResponse.status === 429) {
            const retryAfter = discordResponse.headers['retry-after'] || 60;
            console.log(`   ⚠️ Discord API: 429, retry after ${retryAfter}s`);
            await sendTelegram(`⚠️ Discord rate limit, жду ${retryAfter}с`);
        } else {
            console.log(`   ⚠️ Discord API ответил кодом: ${discordResponse.status}`);
        }
    } catch (error) {
        console.log(`   ❌ Ошибка доступа к Discord API: ${error.message}`);
    }
    
    // 3. Проверяем, не утекает ли DNS
    console.log('\n📡 ТЕСТ 3: Проверка DNS');
    try {
        const dns = require('dns').promises;
        const addresses = await dns.lookup('discord.com');
        console.log(`   DNS discord.com: ${addresses.address}`);
    } catch (error) {
        console.log(`   ❌ Ошибка DNS: ${error.message}`);
    }
    
    console.log('\n🔍 ДИАГНОСТИКА ЗАВЕРШЕНА\n');
}

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
    console.log('🚀 ЗАПУСК БОТА');
    console.log('=' .repeat(50));
    
    // Проверяем наличие прокси
    if (!PROXY_URL) {
        console.log('⚠️ Прокси не настроен, буду использовать прямой IP Render');
    } else {
        console.log(`📡 Прокси URL: ${PROXY_URL}`);
    }
    
    // Тестируем все порты прокси
    console.log('\n🔍 ТЕСТИРОВАНИЕ ВСЕХ ДОСТУПНЫХ ПОРТОВ');
    console.log('=' .repeat(50));
    
    let workingProxy = null;
    let workingAgent = null;
    
    for (let i = 0; i < PROXY_PORTS.length * 2; i++) {
        const testUrl = i === 0 ? PROXY_URL : rotateProxyPort();
        console.log(`\n📡 Тест порта ${i+1}/${PROXY_PORTS.length*2}`);
        
        const result = await testProxy(testUrl);
        
        if (result && result.working) {
            workingProxy = testUrl;
            workingAgent = result.agent;
            currentProxyUrl = workingProxy;
            proxyAgent = workingAgent;
            console.log('\n✅ НАЙДЕН РАБОЧИЙ ПРОКСИ!');
            break;
        }
    }
    
    if (!workingProxy) {
        console.log('\n❌ НЕ НАЙДЕНО РАБОЧИХ ПРОКСИ');
        console.log('Возможные причины:');
        console.log('1. Все IP забанены Discord');
        console.log('2. Прокси не работает');
        console.log('3. Проблемы с сетью');
        
        await sendTelegram('🚨 Не найден рабочий прокси для Discord');
    }
    
    // Запускаем диагностику
    await runDiagnostics(workingAgent);
    
    // Создаем клиента
    console.log('\n🔌 СОЗДАНИЕ КЛИЕНТА DISCORD');
    const clientOptions = {};
    if (workingAgent) {
        clientOptions.http = { agent: workingAgent };
        console.log('✅ Прокси будет использоваться для подключения');
    } else {
        console.log('⚠️ Подключение без прокси (прямой IP Render)');
    }
    
    const client = new Client(clientOptions);
    
    // Функция поиска роли
    async function findRoleName(roleId) {
        for (const [, guild] of client.guilds.cache) {
            const role = guild.roles.cache.get(roleId);
            if (role) {
                return role.name;
            }
        }
        return null;
    }
    
    // ===== ОБРАБОТЧИК СООБЩЕНИЙ =====
    client.on('messageCreate', async (message) => {
        try {
            if (message.channel.id !== STOCKS_CHANNEL_ID) return;
            if (message.author.username.toLowerCase() !== 'dawnbot') return;
            
            if (processedIds.includes(message.id)) {
                console.log(`⏭️ Сообщение ${message.id} уже обработано`);
                return;
            }
            
            console.log(`⚡ Новое сообщение ID: ${message.id}`);
            stats.totalMessages++;
            
            // Здесь будет обработка сообщения
            console.log(`📄 Сообщение получено, но обработка отключена до решения проблемы с прокси`);
            
        } catch (error) {
            console.error('❌ Ошибка:', error.message);
        }
    });
    
    // ===== ОБРАБОТЧИКИ СОСТОЯНИЯ =====
    client.on('ready', async () => {
        console.log(`\n✅ Залогинен как ${client.user.tag}`);
        await loadState();
        
        // Проверяем IP после подключения
        console.log('\n🔍 ПРОВЕРКА IP ПОСЛЕ ПОДКЛЮЧЕНИЯ');
        const currentIp = await getPublicIp();
        console.log(`🏭 Текущий IP (видимый извне): ${currentIp || 'не определен'}`);
        
        await sendTelegram(
            `🤖 <b>Бот запущен</b>\n` +
            `🌐 IP: ${currentIp || 'не определен'}`
        );
        
        console.log('\n👀 Бот слушает WebSocket');
    });
    
    client.on('error', async (error) => {
        console.error('❌ Ошибка WebSocket:', error);
        stats.errors++;
        
        if (error.message.includes('429') || error.message.includes('ECONNREFUSED')) {
            console.log('🔄 Попытка смены прокси...');
            const newProxy = rotateProxyPort();
            if (newProxy) {
                const result = await testProxy(newProxy);
                if (result && result.working) {
                    proxyAgent = result.agent;
                    currentProxyUrl = newProxy;
                    console.log('✅ Прокси заменен');
                }
            }
        }
    });
    
    // Отладочная информация
    client.on('debug', (info) => {
        if (info.includes('HTTP') || info.includes('CONNECT') || info.includes('WebSocket')) {
            console.log('🔍 Debug:', info);
        }
    });
    
    // Запускаем диагностику каждые 5 минут
    setInterval(async () => {
        await runDiagnostics(proxyAgent);
    }, 300000);
    
    // Запускаем клиента
    console.log('\n🚀 Подключение к Discord...');
    client.login(process.env.USER_TOKEN);
}

// ===== ГЛОБАЛЬНЫЕ ОБРАБОТЧИКИ =====
process.on('uncaughtException', (error) => {
    console.error('💥 Непойманная ошибка:', error);
    stats.errors++;
});

process.on('unhandledRejection', (error) => {
    console.error('💥 Unhandled Rejection:', error);
    stats.errors++;
});

// ===== ЗАПУСК =====
startBot().catch(error => {
    console.error('❌ Ошибка запуска:', error);
});
