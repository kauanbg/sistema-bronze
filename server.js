require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const QRCode = require('qrcode');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || 'development';
const MONGO_URI = String(process.env.MONGO_URI || '').trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '').trim();
const SESSION_SECRET = String(process.env.ADMIN_SESSION_SECRET || '').trim();
const SESSION_TTL_SECONDS = Math.max(900, Number(process.env.ADMIN_SESSION_TTL_SECONDS || 8 * 60 * 60));
const BOOKING_HOLD_MINUTES = Math.max(5, Number(process.env.BOOKING_HOLD_MINUTES || 20));
const PIX_KEY = String(process.env.PIX_KEY || '21983237811').trim();
const PIX_MERCHANT_NAME = String(process.env.PIX_MERCHANT_NAME || 'PAULUZZI BRONZE').trim();
const PIX_CITY = String(process.env.PIX_CITY || 'RIO DE JANEIRO').trim();
const PUBLIC_URL = String(process.env.PUBLIC_URL || '').trim().replace(/\/$/, '');

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"]
    }
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
app.use(express.json({ limit: '2.5mb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' }
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas de login. Aguarde alguns minutos.' }
});
app.use(['/config', '/promocoes'], publicLimiter);
app.use('/salvar', publicLimiter);
app.use('/api/agendamentos', publicLimiter);
app.use('/admin/login', authLimiter);

const BUSINESS_HOURS = Object.freeze({
  0: { inicio: '08:00', fim: '14:00', nome: 'Domingo' },
  1: { fechado: true, nome: 'Segunda-feira' },
  2: { inicio: '08:00', fim: '18:00', nome: 'Terça-feira' },
  3: { inicio: '08:00', fim: '18:00', nome: 'Quarta-feira' },
  4: { inicio: '08:00', fim: '19:00', nome: 'Quinta-feira' },
  5: { inicio: '08:00', fim: '19:00', nome: 'Sexta-feira' },
  6: { inicio: '08:00', fim: '19:00', nome: 'Sábado' }
});

const SERVICES = Object.freeze([
  { id: 'paredao-60', nome: 'Paredão Duplo — 1 Hora', categoria: 'Paredão', preco: 39.99, duracaoMinutos: 60 },
  { id: 'paredao-90', nome: 'Paredão Duplo — 1h30', categoria: 'Paredão', preco: 49.99, duracaoMinutos: 90 },
  { id: 'paredao-120', nome: 'Paredão Duplo — 2 Horas', categoria: 'Paredão', preco: 59.99, duracaoMinutos: 120 },
  { id: 'cabine-10', nome: 'Cabine 360° Turbo — 10 Min', categoria: 'Máquina Turbo', preco: 89.99, duracaoMinutos: 10 },
  { id: 'cabine-15', nome: 'Cabine 360° Turbo — 15 Min', categoria: 'Máquina Turbo', preco: 119.99, duracaoMinutos: 15 },
  { id: 'cabine-20', nome: 'Cabine 360° Turbo — 20 Min', categoria: 'Máquina Turbo', preco: 134.99, duracaoMinutos: 20 },
  { id: 'sol-60', nome: 'Bronze Sol — 1 Hora', categoria: 'Sol', preco: 39.99, duracaoMinutos: 0 },
  { id: 'sol-90', nome: 'Bronze Sol — 1h30', categoria: 'Sol', preco: 49.99, duracaoMinutos: 0 },
  { id: 'sol-livre', nome: 'Bronze Sol — Tempo Livre', categoria: 'Sol', preco: 69.99, duracaoMinutos: 0 },
  { id: 'banho-lua', nome: 'Banho de Lua', categoria: 'Sol', preco: 24.99, duracaoMinutos: 0 },
  { id: 'intensificador', nome: 'Intensificador', categoria: 'Sol', preco: 29.99, duracaoMinutos: 0 },
  { id: 'biquini', nome: 'Apenas Montagem Biquíni', categoria: 'Sol', preco: 24.99, duracaoMinutos: 0 },
  { id: 'cueca', nome: 'Apenas Montagem Cueca', categoria: 'Sol', preco: 29.99, duracaoMinutos: 0 },
  { id: 'decapagem', nome: 'Decapagem', categoria: 'Sol', preco: 24.99, duracaoMinutos: 0 }
]);
const serviceMap = new Map(SERVICES.map((service) => [service.id, service]));

let mongoAvailable = false;
let Promo = null;
let Agendamento = null;
const memory = { promos: [], agendamentos: [] };

const PromoSchema = new mongoose.Schema({
  titulo: { type: String, required: true, trim: true, maxlength: 80 },
  descricao: { type: String, default: '', trim: true, maxlength: 500 },
  valorTexto: { type: String, default: '', trim: true, maxlength: 120 },
  foto: { type: String, default: '', maxlength: 2_000_000 },
  preco: { type: Number, required: true, min: 0 },
  categoria: { type: String, default: 'Paredão', enum: ['Paredão', 'Máquina Turbo', 'Sol'] },
  duracaoMinutos: { type: Number, default: 60, min: 0, max: 240 },
  horaFixa: { type: String, default: '', trim: true, maxlength: 5 },
  diasNum: { type: [String], required: true, default: [] },
  dias: { type: [String], required: true, default: [] },
  ativa: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const AgendamentoSchema = new mongoose.Schema({
  nome: { type: String, required: true, trim: true, maxlength: 100 },
  telefone: { type: String, required: true, trim: true, maxlength: 15 },
  servicoId: { type: String, required: true, maxlength: 60 },
  tipo: { type: String, required: true, trim: true, maxlength: 100 },
  categoria: { type: String, required: true, trim: true, maxlength: 40 },
  data: { type: String, required: true },
  hora: { type: String, required: true, trim: true, maxlength: 30 },
  inicioMinutos: { type: Number, default: null },
  fimMinutos: { type: Number, default: null },
  valor: { type: Number, required: true, min: 0 },
  oculos: { type: Boolean, default: false },
  protetorSolar: { type: String, enum: ['local','proprio'], default: 'local' },
  observacao: { type: String, default: '', trim: true, maxlength: 200 },
  promotionId: { type: String, default: '' },
  status: { type: String, enum: ['pagamento_pendente', 'pagamento_informado', 'confirmado', 'cancelado'], default: 'pagamento_pendente' },
  checkoutToken: { type: String, default: '', index: true },
  expiresAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

function clean(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeMoney(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return NaN;
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function normalizePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length === 13) return digits.slice(2);
  return digits;
}

function validPhone(phone) {
  return /^(?:\d{10}|\d{11})$/.test(phone);
}

function isValidDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function todayBrazil() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function nowBrazilMinutes() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const h = Number(parts.find((x) => x.type === 'hour')?.value || 0);
  const m = Number(parts.find((x) => x.type === 'minute')?.value || 0);
  return h * 60 + m;
}

function getBusinessDay(dateString) {
  if (!isValidDateString(dateString)) return null;
  const date = new Date(`${dateString}T00:00:00`);
  return BUSINESS_HOURS[date.getDay()] || null;
}

function timeToMinutes(time) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(time));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function minutesToTime(total) {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function getPromoById(id) {
  if (!id) return Promise.resolve(null);
  if (mongoAvailable) {
    if (!mongoose.isValidObjectId(id)) return Promise.resolve(null);
    return Promo.findOne({ _id: id, ativa: true });
  }
  return Promise.resolve(memory.promos.find((p) => String(p._id) === String(id) && p.ativa) || null);
}

function publicPromo(promo) {
  if (!promo) return null;
  const category = promo.categoria || 'Paredão';
  const duration = Number(promo.duracaoMinutos ?? (category === 'Paredão' ? 60 : 0));
  return {
    _id: String(promo._id),
    titulo: promo.titulo,
    descricao: promo.descricao || '',
    valorTexto: promo.valorTexto || '',
    foto: promo.foto || '',
    preco: normalizeMoney(promo.preco),
    categoria: category,
    duracaoMinutos: duration,
    horaFixa: promo.horaFixa || '',
    diasNum: Array.isArray(promo.diasNum) ? promo.diasNum : [],
    dias: Array.isArray(promo.dias) ? promo.dias : [],
    ativa: promo.ativa !== false
  };
}

async function listPromos() {
  if (mongoAvailable) {
    const docs = await Promo.find({ ativa: true }).sort({ createdAt: -1 }).lean();
    return docs.map(publicPromo);
  }
  return memory.promos.filter((p) => p.ativa).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(publicPromo);
}

async function findBookingById(id) {
  if (mongoAvailable) {
    if (!mongoose.isValidObjectId(id)) return null;
    return Agendamento.findById(id).lean();
  }
  return memory.agendamentos.find((item) => String(item._id) === String(id)) || null;
}

async function listBookings() {
  if (mongoAvailable) return Agendamento.find().sort({ data: 1, hora: 1, createdAt: -1 }).lean();
  return [...memory.agendamentos].sort((a, b) => `${a.data} ${a.hora}`.localeCompare(`${b.data} ${b.hora}`));
}

async function insertBooking(data) {
  if (mongoAvailable) return Agendamento.create(data);
  const item = { _id: crypto.randomUUID(), ...data, createdAt: new Date(), updatedAt: new Date() };
  memory.agendamentos.push(item);
  return item;
}

async function updateBooking(id, changes) {
  if (mongoAvailable) return Agendamento.findByIdAndUpdate(id, { ...changes, updatedAt: new Date() }, { new: true }).lean();
  const item = memory.agendamentos.find((booking) => String(booking._id) === String(id));
  if (!item) return null;
  Object.assign(item, changes, { updatedAt: new Date() });
  return item;
}

async function deleteBooking(id) {
  if (mongoAvailable) return Agendamento.findByIdAndDelete(id).lean();
  const index = memory.agendamentos.findIndex((item) => String(item._id) === String(id));
  if (index === -1) return null;
  return memory.agendamentos.splice(index, 1)[0];
}


async function validateManualBooking(body) {
  const nome=clean(body.nome,100).replace(/\s+/g,' ');
  const telefone=normalizePhone(body.telefone);
  const servicoId=clean(body.servicoId,60);
  const data=clean(body.data,10);
  const hora=clean(body.hora,10);
  const oculos=Boolean(body.oculos);
  const protetorSolar=['local','proprio'].includes(body.protetorSolar)?body.protetorSolar:'local';
  const observacao=clean(body.observacao,200);
  const requestedDuration=Number(body.duracaoMinutos);

  if(nome.length<3)throw new Error('Digite o nome completo.');
  if(!validPhone(telefone))throw new Error('Informe um WhatsApp válido.');
  if(!isValidDateString(data))throw new Error('Data inválida.');

  const service=serviceMap.get(servicoId);
  if(!service)throw new Error('Serviço inválido.');

  const day=getBusinessDay(data);
  if(!day||day.fechado)throw new Error('A data escolhida está fechada.');

  const cat=service.categoria;
  let duration=Number.isFinite(requestedDuration)&&requestedDuration>0
    ? requestedDuration
    : Number(service.duracaoMinutos||0);

  if(cat==='Paredão'){
    if(duration<60||duration%60!==0)throw new Error('Paredão deve usar blocos de 60 minutos.');
  }
  if(cat==='Máquina Turbo'){
    if(duration<5||duration%5!==0)throw new Error('Máquina Turbo deve usar múltiplos de 5 minutos.');
  }
  if(cat==='Sol'){
    duration=0;
  }

  const finalOculos=cat==='Máquina Turbo'?true:oculos;
  const price=normalizeMoney(Number(service.preco||0)+(finalOculos?5:0));

  const start=timeToMinutes(hora);
  if(start==null)throw new Error('Informe um horário válido.');

  const open=timeToMinutes(day.inicio),close=timeToMinutes(day.fim);
  if(start<open||start>=close)throw new Error('Horário fora do expediente.');
  if(cat==='Paredão'&&start%60!==0)throw new Error('Paredão usa horários fechados de hora em hora.');
  if(cat==='Máquina Turbo'&&start%5!==0)throw new Error('Máquina Turbo usa intervalos de 5 minutos.');
  if(duration>0&&start+duration>close)throw new Error(`Esse horário ultrapassa o fechamento das ${day.fim}.`);

  const conflict=await findConflict({
    data,
    categoria:cat,
    inicioMinutos:start,
    fimMinutos:duration>0?start+duration:start
  });
  if(conflict)throw new Error('Esse horário entra em conflito com outro agendamento.');

  return {
    nome,telefone,servicoId:service.id,tipo:service.nome,categoria:cat,data,hora,
    inicioMinutos:start,
    fimMinutos:duration>0?start+duration:start,
    valor:price,
    oculos:finalOculos,
    protetorSolar,
    observacao,
    promotionId:'',
    status:'confirmado',
    checkoutToken:'',
    expiresAt:null
  };
}

function parsePromotionPayload(body) {
  const titulo = clean(body.titulo, 80);
  const descricao = clean(body.descricao, 500);
  const valorTexto = clean(body.valorTexto, 120);
  const foto = clean(body.foto, 2_000_000);
  const preco = normalizeMoney(body.preco);
  const categoria = ['Paredão', 'Máquina Turbo', 'Sol'].includes(body.categoria) ? body.categoria : '';
  const duracaoMinutos = Number(body.duracaoMinutos ?? (categoria === 'Paredão' ? 60 : 0));
  const horaFixa = clean(body.horaFixa, 5);
  const diasNum = Array.isArray(body.diasNum) ? [...new Set(body.diasNum.map((d) => String(d)).filter((d) => /^[0-6]$/.test(d)))] : [];
  const dias = diasNum.map((d) => ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][Number(d)]);

  if (titulo.length < 3) return { erro: 'Informe um título válido para a promoção.' };
  if (!Number.isFinite(preco) || preco <= 0 || preco > 9999) return { erro: 'Valor da promoção inválido.' };
  if (!categoria) return { erro: 'Selecione a categoria da promoção.' };
  if (!Number.isInteger(duracaoMinutos) || duracaoMinutos < 0 || duracaoMinutos > 240) return { erro: 'Duração da promoção inválida.' };
  if (categoria === 'Paredão' && duracaoMinutos < 60) return { erro: 'Paredão deve ter pelo menos 60 minutos.' };
  if (categoria === 'Paredão' && duracaoMinutos % 60 !== 0) return { erro: 'Paredão deve usar blocos de 60 minutos.' };
  if (categoria === 'Máquina Turbo' && (duracaoMinutos < 5 || duracaoMinutos % 5 !== 0)) return { erro: 'Máquina Turbo deve usar múltiplos de 5 minutos.' };
  if (!diasNum.length) return { erro: 'Selecione pelo menos um dia da semana.' };
  if (horaFixa && timeToMinutes(horaFixa) == null) return { erro: 'O horário fixo deve estar no formato HH:MM.' };
  if (foto && !/^data:image\/(png|jpe?g|webp);base64,/i.test(foto)) return { erro: 'A imagem precisa ser PNG, JPG ou WebP em base64.' };
  if (foto && Buffer.byteLength(foto, 'utf8') > 2_000_000) return { erro: 'A imagem da promoção está muito grande.' };

  return { titulo, descricao, valorTexto, foto, preco, categoria, duracaoMinutos, horaFixa, diasNum, dias, ativa: true };
}

function validateServiceOrPromotion(body, promo) {
  const service = body.servicoId ? serviceMap.get(clean(body.servicoId, 60)) : null;
  if (!service && !promo) throw new Error('Serviço ou promoção não encontrado.');
  return service;
}

async function findConflict({ data, categoria, inicioMinutos, fimMinutos }) {
  if (categoria === 'Sol' && inicioMinutos == null) return null;

  const blockingStatuses = ['pagamento_informado', 'confirmado', 'pagamento_pendente'];
  const isActive = (item) => {
    if (!blockingStatuses.includes(item.status || 'pagamento_pendente')) return false;
    if (item.status === 'pagamento_pendente' && item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now()) return false;
    return true;
  };

  if (mongoAvailable) {
    const candidates = await Agendamento.find({ data, categoria, status: { $in: blockingStatuses } }).lean();
    return candidates.find((item) => {
      if (!isActive(item)) return false;
      if (item.inicioMinutos == null || item.fimMinutos == null || fimMinutos == null) return item.hora === minutesToTime(inicioMinutos);
      if (item.fimMinutos <= item.inicioMinutos || fimMinutos <= inicioMinutos) return item.inicioMinutos === inicioMinutos;
      return inicioMinutos < item.fimMinutos && fimMinutos > item.inicioMinutos;
    }) || null;
  }

  return memory.agendamentos.find((item) => {
    if (item.data !== data || item.categoria !== categoria || !isActive(item)) return false;
    if (item.inicioMinutos == null || item.fimMinutos == null || fimMinutos == null) return item.hora === minutesToTime(inicioMinutos);
    if (item.fimMinutos <= item.inicioMinutos || fimMinutos <= inicioMinutos) return item.inicioMinutos === inicioMinutos;
    return inicioMinutos < item.fimMinutos && fimMinutos > item.inicioMinutos;
  }) || null;
}

async function validateCheckout(body) {
  const nome = clean(body.nome, 100).replace(/\s+/g, ' ');
  const telefone = normalizePhone(body.telefone);
  const data = clean(body.data, 10);
  const oculosRequested = Boolean(body.oculos);
  const protetorSolar = ['local','proprio'].includes(body.protetorSolar) ? body.protetorSolar : 'local';
  const promotionId = clean(body.promotionId, 80);
  const hora = clean(body.hora, 30);
  const promo = await getPromoById(promotionId);
  const service = validateServiceOrPromotion(body, promo);

  if (nome.length < 3) throw new Error('Digite seu nome completo.');
  if (!validPhone(telefone)) throw new Error('Informe um WhatsApp válido.');
  if (!isValidDateString(data)) throw new Error('Data inválida.');
  const today = todayBrazil();
  if (data < today) throw new Error('A data escolhida já passou.');

  const day = getBusinessDay(data);
  if (!day) throw new Error('Data inválida.');
  if (day.fechado) throw new Error('Não funcionamos às segundas-feiras.');

  const effectiveCategory = promo ? (promo.categoria || 'Paredão') : service.categoria;
  const effectiveDuration = promo ? Number(promo.duracaoMinutos ?? (effectiveCategory === 'Paredão' ? 60 : 0)) : service.duracaoMinutos;
  const oculos = effectiveCategory === 'Máquina Turbo' ? true : oculosRequested;
  const effectivePrice = normalizeMoney((promo ? promo.preco : service.preco) + (oculos ? 5 : 0));
  const effectiveType = promo ? promo.titulo : service.nome;
  const selectedDay = new Date(`${data}T00:00:00`).getDay();

  if (promo && (!promo.diasNum || !promo.diasNum.includes(String(selectedDay)))) {
    throw new Error('A data escolhida não é válida para esta promoção.');
  }

  let normalizedHour = 'Ordem de Chegada';
  let inicioMinutos = null;
  let fimMinutos = null;

  const usesClock = effectiveCategory !== 'Sol' || Boolean(promo?.horaFixa);
  if (usesClock) {
    const requested = promo?.horaFixa || hora;
    const start = timeToMinutes(requested);
    const open = timeToMinutes(day.inicio);
    const close = timeToMinutes(day.fim);
    if (start == null) throw new Error('Escolha um horário válido.');
    if (start < open || start >= close) throw new Error('Horário fora do expediente.');
    if (data === today && start < nowBrazilMinutes()) throw new Error('Esse horário já passou hoje.');
    if (effectiveCategory === 'Paredão' && start % 60 !== 0) throw new Error('O Paredão trabalha em horários fechados de hora em hora.');
    if (effectiveCategory === 'Máquina Turbo' && start % 5 !== 0) throw new Error('A Máquina Turbo trabalha em intervalos de 5 minutos.');
    if (promo?.horaFixa && hora !== promo.horaFixa) throw new Error('Esta promoção possui horário fixo.');
    if (effectiveDuration > 0 && start + effectiveDuration > close) throw new Error(`Esse horário ultrapassa o fechamento das ${day.fim}.`);
    normalizedHour = requested;
    inicioMinutos = start;
    fimMinutos = effectiveDuration > 0 ? start + effectiveDuration : start;
  }

  const conflict = await findConflict({ data, categoria: effectiveCategory, inicioMinutos, fimMinutos });
  if (conflict) throw new Error('Esse horário entra em conflito com outro agendamento. Escolha outro horário.');

  const checkoutToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + BOOKING_HOLD_MINUTES * 60 * 1000);

  return {
    nome,
    telefone,
    servicoId: service?.id || `promo:${String(promo._id)}`,
    tipo: effectiveType,
    categoria: effectiveCategory,
    data,
    hora: normalizedHour,
    inicioMinutos,
    fimMinutos,
    valor: effectivePrice,
    oculos,
    protetorSolar,
    observacao: '',
    promotionId: promo ? String(promo._id) : '',
    status: 'pagamento_pendente',
    checkoutToken,
    expiresAt
  };
}

function field(id, value) {
  const valueString = String(value);
  return `${id}${String(valueString.length).padStart(2, '0')}${valueString}`;
}

function crc16(payload) {
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function generatePixBrCode(key, name, city, amount) {
  let normalizedKey = String(key).replace(/\D/g, '');
  if (normalizedKey.length === 11) normalizedKey = `+55${normalizedKey}`;
  const merchantAccount = field('00', 'br.gov.bcb.pix') + field('01', normalizedKey);
  const payload = [
    '000201',
    field('26', merchantAccount),
    '52040000',
    '5303986',
    field('54', normalizeMoney(amount).toFixed(2)),
    '5802BR',
    field('59', String(name).substring(0, 25).toUpperCase()),
    field('60', String(city).substring(0, 15).toUpperCase()),
    field('62', field('05', '***')),
    '6304'
  ].join('');
  return payload + crc16(payload);
}

function parseCookies(header) {
  const cookies = {};
  String(header || '').split(';').forEach((pair) => {
    const index = pair.indexOf('=');
    if (index < 0) return;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    try { cookies[key] = decodeURIComponent(value); } catch { cookies[key] = value; }
  });
  return cookies;
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signSession(payload) {
  const raw = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(raw).digest('base64url');
  return `${raw}.${signature}`;
}

function verifySession(token) {
  if (!token || !SESSION_SECRET) return null;
  const [raw, signature] = String(token).split('.');
  if (!raw || !signature) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(raw).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function setAdminCookie(res, token) {
  const parts = [
    `admin_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`
  ];
  if (NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearAdminCookie(res) {
  const parts = ['admin_session=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function requireAdmin(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const session = verifySession(cookies.admin_session);
  if (!session) return res.status(401).json({ erro: 'Sessão administrativa inválida ou expirada.' });
  req.admin = session;
  return next();
}

function bookingPublic(item, includeSecret = false) {
  const publicData = {
    _id: String(item._id),
    nome: item.nome,
    telefone: item.telefone,
    servicoId: item.servicoId,
    tipo: item.tipo,
    categoria: item.categoria,
    data: item.data,
    hora: item.hora,
    valor: normalizeMoney(item.valor),
    oculos: Boolean(item.oculos),
    protetorSolar: item.protetorSolar || 'local',
    observacao: item.observacao || '',
    promotionId: item.promotionId || '',
    status: item.status || 'pagamento_pendente',
    expiresAt: item.expiresAt || null,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null
  };
  if (includeSecret) publicData.checkoutToken = item.checkoutToken || '';
  return publicData;
}

async function checkoutData(item) {
  const pix = generatePixBrCode(PIX_KEY, PIX_MERCHANT_NAME, PIX_CITY, item.valor);
  const qr = await QRCode.toDataURL(pix, { width: 320, margin: 1, errorCorrectionLevel: 'M' });
  return { agendamento: bookingPublic(item), pixCopiaECola: pix, qrCodeDataUrl: qr, expiresAt: item.expiresAt || null };
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pauluzzi.html')));
app.get('/pauluzzi.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pauluzzi.html')));
app.get('/pagamento.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pagamento.html')));

app.get('/config', (req, res) => {
  res.json({
    services: SERVICES,
    businessHours: BUSINESS_HOURS,
    bookingHoldMinutes: BOOKING_HOLD_MINUTES,
    contact: { whatsapp: '5521983237811', displayWhatsapp: '(21) 98323-7811', address: 'Toriba 851, Colégio — RJ' }
  });
});

app.get('/promocoes', async (req, res) => {
  try { res.json(await listPromos()); }
  catch (error) { console.error(error); res.status(500).json({ erro: 'Não foi possível carregar as promoções.' }); }
});

app.post('/admin/login', (req, res) => {
  const password = String(req.body?.password || '');
  if (!ADMIN_PASSWORD || !SESSION_SECRET) return res.status(500).json({ erro: 'Login administrativo não configurado no servidor.' });
  const provided = Buffer.from(password);
  const expected = Buffer.from(ADMIN_PASSWORD);
  const ok = provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
  if (!ok) return res.status(401).json({ erro: 'Senha incorreta.' });

  const now = Math.floor(Date.now() / 1000);
  const token = signSession({ sub: 'admin', iat: now, exp: now + SESSION_TTL_SECONDS, nonce: crypto.randomBytes(8).toString('hex') });
  setAdminCookie(res, token);
  res.json({ ok: true, expiresIn: SESSION_TTL_SECONDS });
});

app.post('/admin/logout', requireAdmin, (req, res) => {
  clearAdminCookie(res);
  res.json({ ok: true });
});

app.get('/admin/session', requireAdmin, (req, res) => res.json({ ok: true, expiresAt: req.admin.exp * 1000 }));

app.post('/promocoes', requireAdmin, async (req, res) => {
  try {
    const parsed = parsePromotionPayload(req.body || {});
    if (parsed.erro) return res.status(400).json(parsed);
    if (mongoAvailable) {
      const promo = await Promo.create(parsed);
      return res.status(201).json(publicPromo(promo));
    }
    const promo = { _id: crypto.randomUUID(), ...parsed, createdAt: new Date() };
    memory.promos.push(promo);
    return res.status(201).json(publicPromo(promo));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ erro: 'Não foi possível salvar a promoção.' });
  }
});

app.delete('/promocoes/:id', requireAdmin, async (req, res) => {
  try {
    if (mongoAvailable) {
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ erro: 'ID inválido.' });
      const deleted = await Promo.findByIdAndUpdate(req.params.id, { ativa: false }, { new: true }).lean();
      if (!deleted) return res.status(404).json({ erro: 'Promoção não encontrada.' });
    } else {
      const item = memory.promos.find((p) => String(p._id) === String(req.params.id));
      if (!item) return res.status(404).json({ erro: 'Promoção não encontrada.' });
      item.ativa = false;
    }
    return res.json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ erro: 'Não foi possível apagar a promoção.' });
  }
});

app.post('/salvar', async (req, res) => {
  try {
    const normalized = await validateCheckout(req.body || {});
    const saved = await insertBooking(normalized);
    const payment = await checkoutData(saved);
    payment.agendamento.checkoutToken = saved.checkoutToken;
    return res.status(201).json({ ok: true, ...payment });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ erro: error.message || 'Não foi possível criar o agendamento.' });
  }
});

app.post('/api/agendamentos/:id/checkout', async (req, res) => {
  try {
    const id = clean(req.params.id, 80);
    const token = clean(req.body?.checkoutToken, 100);
    const existing = await findBookingById(id);
    if (!existing || !token || !existing.checkoutToken || existing.checkoutToken !== token) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
    if (existing.status === 'cancelado') return res.status(409).json({ erro: 'Este agendamento foi cancelado.' });
    if (existing.status !== 'pagamento_pendente') return res.status(409).json({ erro: 'Este agendamento já foi atualizado.' });
    if (existing.expiresAt && new Date(existing.expiresAt).getTime() <= Date.now()) return res.status(410).json({ erro: 'A reserva temporária expirou. Faça um novo agendamento.' });
    return res.json(await checkoutData(existing));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ erro: 'Não foi possível carregar o pagamento.' });
  }
});

app.post('/api/agendamentos/:id/confirmar', async (req, res) => {
  try {
    const id = clean(req.params.id, 80);
    const token = clean(req.body?.checkoutToken, 100);
    const existing = await findBookingById(id);
    if (!existing || !token || existing.checkoutToken !== token) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
    if (existing.status !== 'pagamento_pendente') return res.status(409).json({ erro: 'Este agendamento já foi atualizado.' });
    if (existing.expiresAt && new Date(existing.expiresAt).getTime() <= Date.now()) return res.status(410).json({ erro: 'A reserva temporária expirou. Faça um novo agendamento.' });
    const updated = await updateBooking(id, { status: 'pagamento_informado' });
    return res.json({ ok: true, agendamento: bookingPublic(updated) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ erro: 'Não foi possível registrar o pagamento informado.' });
  }
});

app.post('/admin/agendamentos/manual', requireAdmin, async (req,res)=>{
  try{
    const normalized=await validateManualBooking(req.body||{});
    const saved=await insertBooking(normalized);
    return res.status(201).json({ok:true,agendamento:bookingPublic(saved)});
  }catch(error){
    console.error('[MANUAL]',error);
    return res.status(400).json({erro:error.message||'Não foi possível criar o agendamento manual.'});
  }
});

app.get('/listar', requireAdmin, async (req, res) => {
  try {
    const data = await listBookings();
    return res.json({ agendamentos: data.map(bookingPublic) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ erro: 'Não foi possível carregar os agendamentos.' });
  }
});

app.patch('/agendamentos/:id/status', requireAdmin, async (req, res) => {
  const allowed = new Set(['pagamento_pendente', 'pagamento_informado', 'confirmado', 'cancelado']);
  const status = clean(req.body?.status, 30);
  if (!allowed.has(status)) return res.status(400).json({ erro: 'Status inválido.' });
  try {
    const existing = await findBookingById(req.params.id);
    if (!existing) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
    const updated = await updateBooking(req.params.id, { status, expiresAt: status === 'pagamento_pendente' ? existing.expiresAt : null });
    return res.json({ ok: true, agendamento: bookingPublic(updated) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ erro: 'Não foi possível atualizar o status.' });
  }
});

app.delete('/agendamentos/:id', requireAdmin, async (req, res) => {
  try {
    const deleted = await deleteBooking(req.params.id);
    if (!deleted) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
    return res.json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ erro: 'Não foi possível apagar o agendamento.' });
  }
});

app.get('/health', async (req, res) => {
  res.status(mongoAvailable || NODE_ENV !== 'production' ? 200 : 503).json({
    ok: mongoAvailable || NODE_ENV !== 'production',
    banco: mongoAvailable ? 'mongodb' : 'memoria',
    ambiente: NODE_ENV
  });
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: NODE_ENV === 'production' ? '1h' : 0 }));
app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

async function connectDatabase() {
  if (!MONGO_URI) {
    if (NODE_ENV === 'production') throw new Error('MONGO_URI não configurado. O ambiente de produção não pode usar memória temporária.');
    console.warn('[DB] MONGO_URI ausente. Rodando em memória apenas no desenvolvimento.');
    return;
  }
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 7000, maxPoolSize: 10, minPoolSize: 1 });
    mongoAvailable = true;
    Promo = mongoose.model('Promo', PromoSchema);
    Agendamento = mongoose.model('Agendamento', AgendamentoSchema);
    console.log('[DB] MongoDB conectado.');
  } catch (error) {
    console.error('[DB] Falha ao conectar no MongoDB:', error.message);
    if (NODE_ENV === 'production') throw error;
  }
}

async function start() {
  if (NODE_ENV === 'production' && (!ADMIN_PASSWORD || !SESSION_SECRET)) {
    throw new Error('ADMIN_PASSWORD e ADMIN_SESSION_SECRET são obrigatórios em produção.');
  }
  await connectDatabase();
  app.listen(PORT, () => console.log(`Pauluzzi Bronze rodando na porta ${PORT}`));
}

start().catch((error) => {
  console.error('[STARTUP]', error.message);
  process.exit(1);
});
