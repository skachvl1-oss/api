// ============================================================
//  LASERLIFE AI БЭКЕНД — Node.js / Vercel Serverless Function
//
//  ИНСТРУКЦИЯ ДЛЯ РАЗРАБОТЧИКА:
//
//  1. Создай аккаунт на vercel.com (бесплатно)
//  2. Создай новый проект, положи этот файл в /api/chat.js
//  3. В настройках Vercel добавь переменную окружения:
//       ANTHROPIC_API_KEY = sk-ant-... (ключ от Anthropic)
//  4. Задеплой — получишь URL вида: 
//       https://laserlife-bot.vercel.app/api/chat
//  5. Этот URL вставь в виджет (файл laserlife-tilda-widget.html)
//       const LL_BACKEND = 'https://laserlife-bot.vercel.app/api/chat';
// ============================================================

const SYSTEM_PROMPT = `Ты — дружелюбный и профессиональный ИИ-ассистент сети студий лазерной эпиляции LaserLife (сайт: laserlife.org).

ИНФОРМАЦИЯ О КОМПАНИИ:
- LaserLife — федеральная сеть студий лазерной эпиляции
- Работают на диодном лазере FG 2000 D+ (совместное производство Германии и США)
- Мощность лазера: 1200 Вт, подходит для всех 6 типов кожи
- Процедуры безболезненны, безопасны и комфортны
- Охлаждение сапфиром до -5°C
- Зоны: лицо, руки, подмышки, грудь, спина, бикини, ноги
- Также есть ADSS EMSCULPT — укрепление мышц, 30 мин, 30 000 сокращений

АКЦИИ:
- 2 зоны — 1000 руб.
- 3 зоны — 1500 руб.
- Акция «Две зоны бесплатно» при записи

ПЕРСОНАЛ: Сертифицированные мастера, проходят обучение и сертификацию.
ЗАПИСЬ: Через кнопку на сайте laserlife.org или по телефону.

КАК ОТВЕЧАТЬ:
- Коротко, тепло, по делу
- Умеренно используй эмодзи 💗
- Только русский язык
- Если не знаешь — предложи позвонить или зайти на laserlife.org`;

export default async function handler(req, res) {
  // Разрешаем запросы с сайта laserlife.org
  res.setHeader('Access-Control-Allow-Origin', '*'); // Замени * на https://laserlife.org для безопасности
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid messages' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY, // Ключ хранится на сервере, не в коде!
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: messages.slice(-10) // Берём последние 10 сообщений
      })
    });

    const data = await response.json();
    const reply = data.content?.map(b => b.text || '').join('') || 'Попробуйте ещё раз.';
    return res.status(200).json({ reply });

  } catch (error) {
    console.error('Anthropic API error:', error);
    return res.status(500).json({ error: 'Server error', reply: 'Произошла ошибка. Попробуйте позже.' });
  }
}
