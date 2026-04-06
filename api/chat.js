const fs = require("fs");
const path = require("path");

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

function readJson(relPath, fallback) {
  try {
    const full = path.join(process.cwd(), relPath);
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch {
    return fallback;
  }
}

function readText(relPath, fallback = "") {
  try {
    const full = path.join(process.cwd(), relPath);
    return fs.readFileSync(full, "utf8");
  } catch {
    return fallback;
  }
}

function normalize(text) {
  return String(text || "").toLowerCase().trim();
}

function detectIntent(text) {
  const t = normalize(text);
  const map = [
    { id: "complaint", re: /(ожог|плохой результат|жалоб|верн(ите|уть) деньг|недоволен)/i },
    { id: "aggression", re: /(идиот|дура|твар|угрож|пошел|пошла|сук|мат)/i },
    { id: "medical", re: /(беремен|онколог|диабет|болезн|противопоказ)/i },
    { id: "booking", re: /(запис|свободн|окн|на\s*завтра|на\s*сегодня)/i },
    { id: "reschedule", re: /(перенес|другое время|поменять время)/i },
    { id: "cancel", re: /(отмен|не приду)/i },
    { id: "check_record", re: /(когда у меня|проверьте запись|я записан|я записана)/i },
    { id: "price_inquiry", re: /(сколько стоит|цена|прайс|стоимость)/i },
    { id: "faq", re: /(больно|лазер|подготов|уход|сколько процедур|адрес|где)/i },
    { id: "greeting", re: /^(привет|здравствуйте|добрый)/i }
  ];

  const found = map.find((x) => x.re.test(t));
  return found ? found.id : "general";
}

function needsHuman(intent) {
  return ["complaint", "aggression", "medical"].includes(intent);
}

function extractLead(text) {
  const t = String(text || "");
  const phoneMatch = t.match(/(\+7|8)?[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/);
  const nameMatch = t.match(/(?:меня зовут|я)\s+([А-ЯA-Z][а-яa-z]{1,20})/i);
  const zoneList = ["бикини", "подмыш", "ног", "рук", "лицо", "усики", "спина", "живот"];
  const zone = zoneList.find((z) => normalize(t).includes(z)) || null;

  return {
    name: nameMatch ? nameMatch[1] : null,
    phone: phoneMatch ? phoneMatch[0] : null,
    zone
  };
}

function ensureQuestionOrCTA(reply) {
  const r = String(reply || "").trim();
  if (!r) return "Подскажите, пожалуйста, какую зону вас интересует?";
  if (/[?]$/.test(r)) return r;
  return `${r} Какую зону вас интересует?`;
}

function buildSystemPrompt(kb) {
  const prices = JSON.stringify(kb.prices, null, 2);
  const studios = JSON.stringify(kb.studios, null, 2);
  const faqTop = (kb.faq || []).slice(0, 25).map((x) => `Q: ${x.q}\nA: ${x.a}`).join("\n\n");

  return `
Ты — Алина, AI-администратор LaserLife.
Стиль: тепло, уверенно, кратко, 2-4 предложения.
Каждый ответ заканчивай вопросом или CTA.
Если жалоба/агрессия/медицинский вопрос: "Передаю вас живому администратору — он свяжется в течение 5 минут".
Не выдумывай цены, даты, адреса, факты.
Используй только факты из базы ниже.
Не обещай негарантированный результат.

АКТУАЛЬНЫЕ ЦЕНЫ И АКЦИИ:
${prices}

СТУДИИ:
${studios}

FAQ:
${faqTop}
`.trim();
}

function fallbackReply(intent, kb) {
  if (intent === "price_inquiry") {
    const promo = kb.prices?.promotions?.[0];
    const promoText = promo ? `${promo.title}: ${promo.value}.` : "Сейчас действует акция на комплексные зоны.";
    return `Цена зависит от зоны. ${promoText} Подскажите, какую зону хотите обработать?`;
  }
  if (intent === "booking") {
    return "Отлично, оформлю запись. Напишите, пожалуйста, ваш телефон, желаемую зону и удобное время?";
  }
  if (intent === "reschedule") {
    return "Без проблем, помогу перенести. Назовите номер телефона, чтобы я нашла вашу запись?";
  }
  if (intent === "check_record") {
    return "Проверю запись прямо сейчас. Подскажите номер телефона в формате +7...";
  }
  if (intent === "cancel") {
    return "Понимаю, помогу отменить запись. Напишите номер телефона, и сразу все проверю?";
  }
  return "Я рядом и помогу с подбором процедуры, ценами и записью. Скажите, какой вопрос у вас сейчас?";
}

async function askAnthropic({ apiKey, systemPrompt, messages }) {
  const response = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      temperature: 0.2,
      system: systemPrompt,
      messages
    })
  });

  if (!response.ok) {
    throw new Error(`Anthropic error: ${response.status}`);
  }

  const data = await response.json();
  return data?.content?.[0]?.text || "";
}

function withCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = async (req, res) => {
  withCors(res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { messages = [] } = req.body || {};
    const userText = messages[messages.length - 1]?.content || "";
    const intent = detectIntent(userText);
    const lead = extractLead(userText);
    const escalate = needsHuman(intent);

    if (escalate) {
      return res.status(200).json({
        reply: "Понимаю вас и благодарю, что написали. Передаю вас живому администратору — он свяжется в течение 5 минут. Подскажите, пожалуйста, номер телефона для связи?",
        meta: { intent, needsHuman: true, lead }
      });
    }

    const kb = {
      prices: readJson("knowledge/prices.json", { promotions: [] }),
      studios: readJson("knowledge/studios.json", []),
      faq: readJson("knowledge/faq.json", [])
    };
    const systemPrompt = buildSystemPrompt(kb);

    let reply = "";
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      reply = await askAnthropic({ apiKey, systemPrompt, messages });
    } else {
      reply = fallbackReply(intent, kb);
    }

    reply = ensureQuestionOrCTA(reply);

    return res.status(200).json({
      reply,
      meta: { intent, needsHuman: false, lead }
    });
  } catch (error) {
    return res.status(500).json({
      reply: "Извините, не получилось обработать запрос. Оставьте номер телефона, и живой администратор свяжется с вами в течение 5 минут?",
      error: error.message
    });
  }
};
