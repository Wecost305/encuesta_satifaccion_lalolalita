const fetch = require('node-fetch');

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';
const AREA_FIELDS = [
  ['Atencion', 'Atención'],
  ['Sabor', 'Sabor'],
  ['Presentacion', 'Presentación'],
  ['Tiempo_Servicio', 'Tiempo servicio'],
  ['Limpieza', 'Limpieza'],
  ['Ambiente', 'Ambiente'],
  ['Calidad_Precio', 'Calidad / Precio']
];
const CONSUMPTION_ORDER = [
  'Platillo principal', 'Bebidas sin alcohol', 'Entrada', 'Postre',
  'Cerveza', 'Vino', 'Coctelería'
];
const PROBLEM_ORDER = [
  'Orden tardó demasiado', 'Limpieza', 'Alimentos fríos', 'Atención',
  'Cuenta', 'Producto no disponible', 'Pedido incorrecto', 'Otro'
];

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return json(405, { success: false, error: 'Method Not Allowed' });
  }

  const token = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = process.env.AIRTABLE_TABLE_NAME;

  if (!token || !baseId || !tableName) {
    console.error('Faltan variables de entorno requeridas para Airtable.');
    return json(500, { success: false, error: 'Configuración incompleta del servidor.' });
  }

  const query = event.queryStringParameters || {};
  const from = normalizeIsoDate(query.from);
  const to = normalizeIsoDate(query.to);

  if ((query.from && !from) || (query.to && !to)) {
    return json(400, { success: false, error: 'Formato de fecha inválido. Usa YYYY-MM-DD.' });
  }
  if ((from && !to) || (!from && to)) {
    return json(400, { success: false, error: 'Para filtrar se requieren las fechas from y to.' });
  }
  if (from && to && from > to) {
    return json(400, { success: false, error: 'La fecha inicial no puede ser posterior a la fecha final.' });
  }

  try {
    const records = await fetchAllRecords({ token, baseId, tableName });
    const total = records.length;
    const withoutVisitDate = records.filter(r => !normalizeIsoDate(r?.fields?.Fecha_Visita)).length;
    const analyzedRecords = filterRecords(records, from, to);
    const previous = from && to ? previousRange(from, to) : null;
    const previousRecords = previous ? filterRecords(records, previous.from, previous.to) : [];

    const currentMetrics = calculateMetrics(analyzedRecords, from, to);
    const previousMetrics = calculateMetrics(previousRecords, previous?.from || null, previous?.to || null);

    return json(200, {
      success: true,
      source: 'airtable',
      total,
      analyzed: analyzedRecords.length,
      from: from || null,
      to: to || null,
      withoutVisitDate,
      metrics: currentMetrics,
      previous: previous ? {
        from: previous.from,
        to: previous.to,
        analyzed: previousRecords.length,
        satisfaction: previousMetrics.satisfaction,
        nps: previousMetrics.nps,
        issueRate: previousMetrics.issueRate
      } : null,
      countedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error consultando Airtable:', error);
    return json(500, { success: false, error: 'No fue posible consultar Airtable.' });
  }
};

async function fetchAllRecords({ token, baseId, tableName }) {
  const all = [];
  let offset = null;
  let pages = 0;
  const wantedFields = [
    'Mesero','Fecha_Visita','Horario','Consumo','Atencion','Sabor','Presentacion',
    'Tiempo_Servicio','Limpieza','Ambiente','Calidad_Precio','Tiempo_Espera',
    'Temperatura','Tuvo_Problema','Tipo_Problema','Como_Conocio','NPS','Comentarios'
  ];

  do {
    const params = new URLSearchParams();
    params.set('pageSize', '100');
    for (const field of wantedFields) params.append('fields[]', field);
    if (offset) params.set('offset', offset);

    const url = `${AIRTABLE_API_BASE}/${encodeURIComponent(baseId)}/${encodeURIComponent(tableName)}?${params.toString()}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    });
    const payload = await response.json();

    if (!response.ok) {
      console.error('Error de Airtable API:', response.status, payload);
      const err = new Error('Airtable rechazó la consulta.');
      err.status = response.status;
      throw err;
    }

    if (Array.isArray(payload.records)) all.push(...payload.records);
    offset = payload.offset || null;
    pages += 1;
    if (pages > 1000) throw new Error('Se alcanzó el límite interno de paginación.');
  } while (offset);

  return all;
}

function filterRecords(records, from, to) {
  if (!from || !to) return records.filter(r => normalizeIsoDate(r?.fields?.Fecha_Visita));
  return records.filter(record => {
    const date = normalizeIsoDate(record?.fields?.Fecha_Visita);
    return date && date >= from && date <= to;
  });
}

function calculateMetrics(records, from, to) {
  const analyzed = records.length;
  const areaScores = AREA_FIELDS.map(([field, label]) => {
    const vals = records.map(r => numeric(r?.fields?.[field])).filter(v => v !== null);
    return { field, label, value: vals.length ? round1(avg(vals)) : null, count: vals.length };
  });

  const allScoreValues = [];
  for (const r of records) {
    for (const [field] of AREA_FIELDS) {
      const v = numeric(r?.fields?.[field]);
      if (v !== null) allScoreValues.push(v);
    }
  }
  const satisfaction = allScoreValues.length ? round1(avg(allScoreValues)) : null;

  const npsValues = records.map(r => numeric(r?.fields?.NPS)).filter(v => v !== null);
  const promoters = npsValues.filter(v => v >= 9).length;
  const detractors = npsValues.filter(v => v <= 6).length;
  const nps = npsValues.length ? Math.round((promoters / npsValues.length - detractors / npsValues.length) * 100) : null;

  const issueCount = records.filter(r => truthyCheckbox(r?.fields?.Tuvo_Problema)).length;
  const issueRate = analyzed ? round1(issueCount / analyzed * 100) : null;

  const validAreas = areaScores.filter(a => a.value !== null).sort((a,b) => a.value - b.value);
  const weakArea = validAreas.length ? validAreas[0] : null;
  const strongAreas = [...validAreas].sort((a,b) => b.value - a.value);

  const consumptionCounts = Object.fromEntries(CONSUMPTION_ORDER.map(x => [x, 0]));
  const extraConsumption = {};
  for (const r of records) {
    for (const item of multi(r?.fields?.Consumo)) {
      if (Object.prototype.hasOwnProperty.call(consumptionCounts, item)) consumptionCounts[item] += 1;
      else extraConsumption[item] = (extraConsumption[item] || 0) + 1;
    }
  }
  const consumptionLabels = [...CONSUMPTION_ORDER, ...Object.keys(extraConsumption).sort()];
  const consumption = {
    labels: consumptionLabels,
    counts: consumptionLabels.map(label => consumptionCounts[label] ?? extraConsumption[label] ?? 0),
    percentages: consumptionLabels.map(label => analyzed ? round1(((consumptionCounts[label] ?? extraConsumption[label] ?? 0) / analyzed) * 100) : 0)
  };

  const problemCounts = Object.fromEntries(PROBLEM_ORDER.map(x => [x, 0]));
  const extraProblems = {};
  for (const r of records) {
    for (const item of multi(r?.fields?.Tipo_Problema)) {
      if (Object.prototype.hasOwnProperty.call(problemCounts, item)) problemCounts[item] += 1;
      else extraProblems[item] = (extraProblems[item] || 0) + 1;
    }
  }
  const problemPairs = [...PROBLEM_ORDER, ...Object.keys(extraProblems).sort()]
    .map(label => [label, problemCounts[label] ?? extraProblems[label] ?? 0])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  const problems = {
    labels: problemPairs.map(([label]) => label),
    counts: problemPairs.map(([, count]) => count)
  };

  const trend = buildTrend(records, from, to);
  const comments = buildComments(records);
  const insights = buildInsights({ analyzed, satisfaction, nps, issueCount, issueRate, areaScores, weakArea, strongAreas, problems, trend });

  return {
    satisfaction,
    nps,
    promoters,
    detractors,
    npsResponses: npsValues.length,
    issueCount,
    issueRate,
    weakArea,
    areaScores,
    consumption,
    problems,
    trend,
    comments,
    insights
  };
}

function buildTrend(records, from, to) {
  if (!from || !to) return { labels: [], values: [], counts: [], granularity: 'day' };
  const start = isoToDate(from);
  const end = isoToDate(to);
  const days = Math.floor((end - start) / 86400000) + 1;

  if (days <= 45) {
    const buckets = {};
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = dateToIso(d);
      buckets[iso] = [];
    }
    for (const r of records) {
      const date = normalizeIsoDate(r?.fields?.Fecha_Visita);
      if (!date || !buckets[date]) continue;
      const values = AREA_FIELDS.map(([f]) => numeric(r?.fields?.[f])).filter(v => v !== null);
      if (values.length) buckets[date].push(avg(values));
    }
    const labels = Object.keys(buckets);
    return {
      labels,
      values: labels.map(k => buckets[k].length ? round1(avg(buckets[k])) : null),
      counts: labels.map(k => buckets[k].length),
      granularity: 'day'
    };
  }

  // Para rangos largos, agrupamos por semana comenzando en la fecha inicial.
  const weekCount = Math.ceil(days / 7);
  const buckets = Array.from({ length: weekCount }, () => []);
  const counts = Array.from({ length: weekCount }, () => 0);
  for (const r of records) {
    const iso = normalizeIsoDate(r?.fields?.Fecha_Visita);
    if (!iso) continue;
    const diff = Math.floor((isoToDate(iso) - start) / 86400000);
    const idx = Math.max(0, Math.min(weekCount - 1, Math.floor(diff / 7)));
    const values = AREA_FIELDS.map(([f]) => numeric(r?.fields?.[f])).filter(v => v !== null);
    if (values.length) {
      buckets[idx].push(avg(values));
      counts[idx] += 1;
    }
  }
  const labels = Array.from({ length: weekCount }, (_, i) => {
    const a = new Date(start); a.setUTCDate(a.getUTCDate() + i * 7);
    const b = new Date(a); b.setUTCDate(Math.min(end.getUTCDate ? b.getUTCDate() + 6 : b.getUTCDate() + 6, b.getUTCDate() + 6));
    return dateToIso(a);
  });
  return {
    labels,
    values: buckets.map(v => v.length ? round1(avg(v)) : null),
    counts,
    granularity: 'week'
  };
}

function buildComments(records) {
  return records
    .map(r => ({
      date: normalizeIsoDate(r?.fields?.Fecha_Visita),
      horario: stringValue(r?.fields?.Horario),
      comment: stringValue(r?.fields?.Comentarios),
      nps: numeric(r?.fields?.NPS),
      problems: multi(r?.fields?.Tipo_Problema),
      issue: truthyCheckbox(r?.fields?.Tuvo_Problema)
    }))
    .filter(x => x.date && x.comment)
    .sort((a,b) => b.date.localeCompare(a.date) || (a.nps ?? 99) - (b.nps ?? 99))
    .slice(0, 8)
    .map(x => ({ ...x, quick: quickRead(x) }));
}

function quickRead(item) {
  if (item.issue && item.problems.length) {
    const p = item.problems[0];
    const map = {
      'Orden tardó demasiado': 'Tiempo', 'Alimentos fríos': 'Temperatura',
      'Producto no disponible': 'Disponibilidad', 'Pedido incorrecto': 'Pedido'
    };
    return { label: map[p] || p, tone: 'bad' };
  }
  if (item.nps !== null && item.nps >= 9) return { label: 'Positivo', tone: 'good' };
  if (item.nps !== null && item.nps <= 6) return { label: 'Detractor', tone: 'bad' };
  return { label: 'Neutral', tone: 'neutral' };
}

function buildInsights(ctx) {
  if (!ctx.analyzed) {
    return {
      attention: [{ tone: 'warn', title: 'Sin respuestas en este periodo', text: 'Amplía el rango de fechas para poder calcular conclusiones.' }],
      positive: [{ tone: 'good', title: 'Sin datos suficientes', text: 'Las fortalezas aparecerán cuando existan respuestas dentro del periodo.' }]
    };
  }

  const attention = [];
  const positive = [];
  const sortedAsc = ctx.areaScores.filter(a => a.value !== null).sort((a,b) => a.value - b.value);
  const sortedDesc = [...sortedAsc].reverse();

  if (sortedAsc[0]) {
    const a = sortedAsc[0];
    attention.push({
      tone: a.value < 3.5 ? 'bad' : 'warn',
      title: `${a.label} es el área con menor evaluación`,
      text: `Obtiene ${a.value.toFixed(1)}/5 en ${a.count} evaluaciones del periodo. Es el primer indicador que conviene revisar.`
    });
  }

  if (ctx.problems.labels.length) {
    const [label, count] = [ctx.problems.labels[0], ctx.problems.counts[0]];
    attention.push({
      tone: count >= Math.max(3, ctx.issueCount * 0.4) ? 'bad' : 'warn',
      title: `${label} es la incidencia más repetida`,
      text: `Se reportó ${count} ${count === 1 ? 'vez' : 'veces'} entre ${ctx.issueCount} visitas con problema.`
    });
  }

  const worstTrend = ctx.trend.labels
    .map((label, i) => ({ label, value: ctx.trend.values[i], count: ctx.trend.counts[i] }))
    .filter(x => x.value !== null && x.count > 0)
    .sort((a,b) => a.value - b.value)[0];
  if (worstTrend && ctx.trend.labels.length > 1) {
    const isDay = ctx.trend.granularity === 'day';
    const periodName = isDay ? `El día ${shortDateEs(worstTrend.label)}` : `La semana que inicia ${shortDateEs(worstTrend.label)}`;
    const sampleText = worstTrend.count === 1
      ? 'Se basa en 1 respuesta; es una muestra reducida y conviene interpretarla con precaución.'
      : `Se basa en ${worstTrend.count} respuestas. Conviene compararlo con horarios, personal y carga operativa.`;
    attention.push({
      tone: worstTrend.value < 3.5 ? 'bad' : 'warn',
      title: `${periodName} tuvo la satisfacción más baja: ${worstTrend.value.toFixed(1)}/5`,
      text: sampleText
    });
  }

  if (sortedDesc[0]) {
    const a = sortedDesc[0];
    positive.push({ tone: 'good', title: `${a.label} lidera la experiencia`, text: `Con ${a.value.toFixed(1)}/5 es el atributo mejor evaluado del periodo.` });
  }
  if (sortedDesc[1]) {
    const a = sortedDesc[1];
    positive.push({ tone: 'good', title: `${a.label} también destaca`, text: `Obtiene ${a.value.toFixed(1)}/5 y funciona como una segunda fortaleza del negocio.` });
  }
  if (ctx.nps !== null) {
    const title = ctx.nps > 0 ? 'NPS positivo' : ctx.nps === 0 ? 'NPS neutral' : 'NPS requiere atención';
    const text = ctx.nps > 0
      ? `El NPS es ${signed(ctx.nps)}: hay más promotores que detractores en el periodo.`
      : ctx.nps === 0
        ? 'El NPS es 0: promotores y detractores están equilibrados.'
        : `El NPS es ${ctx.nps}: hay más detractores que promotores y conviene revisar las principales fricciones.`;
    positive.push({ tone: ctx.nps > 0 ? 'good' : 'warn', title, text });
  }

  return { attention: attention.slice(0, 3), positive: positive.slice(0, 3) };
}

function shortDateEs(iso) {
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const d = isoToDate(iso);
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

function previousRange(from, to) {
  const start = isoToDate(from);
  const end = isoToDate(to);
  const length = Math.floor((end - start) / 86400000) + 1;
  const prevTo = new Date(start); prevTo.setUTCDate(prevTo.getUTCDate() - 1);
  const prevFrom = new Date(prevTo); prevFrom.setUTCDate(prevFrom.getUTCDate() - (length - 1));
  return { from: dateToIso(prevFrom), to: dateToIso(prevTo) };
}

function normalizeIsoDate(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}
function isoToDate(value) { const [y,m,d] = value.split('-').map(Number); return new Date(Date.UTC(y,m-1,d)); }
function dateToIso(date) { return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`; }
function numeric(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function avg(values) { return values.reduce((a,b) => a+b, 0) / values.length; }
function round1(value) { return Math.round(value * 10) / 10; }
function stringValue(value) { return value == null ? '' : String(value).trim(); }
function multi(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(v => v.trim()).filter(Boolean);
  return [];
}
function truthyCheckbox(value) {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') return ['true','sí','si','1','yes'].includes(value.trim().toLowerCase());
  return false;
}
function signed(value) { return value > 0 ? `+${value}` : String(value); }
function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, max-age=0' }, body: JSON.stringify(body) };
}

exports._test = { calculateMetrics, filterRecords, previousRange, normalizeIsoDate, truthyCheckbox, multi };
