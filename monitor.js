const fs = require('fs');

const CASA = 'CMMACAPA';
const BASE = 'https://macapa.wdsolucoes.com.br/';
const LISTA = BASE + '?sec=nlistaproposicoes';
const ARQUIVO_ESTADO = 'estado.json';
const MAX_PAGES = Number(process.env.MAX_PAGES || 5);

function carregarEstado() {
  if (fs.existsSync(ARQUIVO_ESTADO)) return JSON.parse(fs.readFileSync(ARQUIVO_ESTADO, 'utf8'));
  return { proposicoes_vistas: [], ultimos_por_tipo_ano: {}, ultima_execucao: '' };
}

function salvarEstado(estado) {
  fs.writeFileSync(ARQUIVO_ESTADO, JSON.stringify(estado, null, 2));
}

function decodeHtml(texto) {
  return String(texto || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&Uacute;/g, 'Ú')
    .replace(/&uacute;/g, 'ú')
    .replace(/&ccedil;/g, 'ç')
    .replace(/&atilde;/g, 'ã')
    .replace(/&aacute;/g, 'á')
    .replace(/&eacute;/g, 'é')
    .replace(/&iacute;/g, 'í')
    .replace(/&oacute;/g, 'ó');
}

function limparHtml(texto) {
  return decodeHtml(texto).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeHtml(texto) {
  return String(texto ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function buscarPagina(pagina) {
  const url = pagina === 1 ? LISTA : LISTA + '&page=' + pagina;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120', Accept: 'text/html' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' em ' + url);
  return res.text();
}

function normalizarLinha(texto) {
  const limpo = limparHtml(texto);
  const match = limpo.match(/^(\d{4})\s*-\s*([A-Z0-9-]+)\s+([\d.]+)\/(.*?)(?:Proc:\s*([\d.]+)\s*-?)?$/i);
  if (!match) return { ano: '-', tipo: 'OUTROS', numero: '-', ementa: limpo, processo: '' };
  return {
    ano: match[1],
    tipo: match[2].toUpperCase(),
    numero: match[3].replace(/\D/g, ''),
    ementa: String(match[4] || '').trim(),
    processo: String(match[5] || '').replace(/\D/g, ''),
  };
}

function extrairProposicoes(html) {
  const itens = [];
  const re = /<a\s+href=["']\?sec=proposicao&id=(\d+)["']\s+class=["']p_element["'][^>]*>[\s\S]*?<span\s+class=["']pe_tit["']>([\s\S]*?)<\/span>[\s\S]*?<\/a>/gi;
  for (const match of html.matchAll(re)) {
    const normal = normalizarLinha(match[2]);
    const id = String(match[1]);
    itens.push({ id, ...normal, link: BASE + '?sec=proposicao&id=' + id });
  }
  return itens;
}

function numeroInteiro(p) {
  const n = Number(String(p.numero || '').replace(/\D/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function chaveTipoAno(p) {
  return (p.tipo || 'OUTROS') + '|' + (p.ano || '-');
}

function calcularUltimosPorTipoAno(proposicoes) {
  const ultimos = {};
  for (const p of proposicoes) {
    const numero = numeroInteiro(p);
    if (!numero || !p.ano || p.ano === '-') continue;
    const chave = chaveTipoAno(p);
    ultimos[chave] = Math.max(ultimos[chave] || 0, numero);
  }
  return ultimos;
}

function detectarSaltos(proposicoes, estado) {
  const anteriores = estado.ultimos_por_tipo_ano || {};
  const atuais = calcularUltimosPorTipoAno(proposicoes);
  const presentes = {};
  for (const p of proposicoes) {
    const numero = numeroInteiro(p);
    if (!numero) continue;
    const chave = chaveTipoAno(p);
    if (!presentes[chave]) presentes[chave] = new Set();
    presentes[chave].add(numero);
  }
  const alertas = [];
  for (const [chave, atual] of Object.entries(atuais)) {
    const anterior = Number(anteriores[chave] || 0);
    if (!anterior || atual <= anterior + 1) continue;
    const faltantes = [];
    for (let n = anterior + 1; n < atual; n++) {
      if (!presentes[chave]?.has(n)) faltantes.push(n);
    }
    if (faltantes.length) {
      const [tipo, ano] = chave.split('|');
      alertas.push({ tipo, ano, anterior, atual, faltantes });
    }
  }
  return { alertas, atuais };
}

async function buscarProposicoes(idsVistos = new Set()) {
  const todas = [];
  const vistosRodada = new Set();
  for (let pagina = 1; pagina <= MAX_PAGES; pagina++) {
    const html = await buscarPagina(pagina);
    const itens = extrairProposicoes(html);
    console.log('Página ' + pagina + ': ' + itens.length + ' proposições');
    if (!itens.length) break;
    let paginaTemVisto = false;
    for (const item of itens) {
      if (idsVistos.has(item.id)) paginaTemVisto = true;
      if (!vistosRodada.has(item.id)) {
        vistosRodada.add(item.id);
        todas.push(item);
      }
    }
    if (paginaTemVisto && process.env.SEED_ONLY !== '1') break;
  }
  return todas;
}

function renderAlertasSaltos(alertas) {
  if (!alertas.length) return '';
  const itens = alertas.map(a => '<li><strong>' + escapeHtml(a.tipo) + ' ' + escapeHtml(a.ano) + '</strong>: último visto ' + a.anterior + ', maior atual ' + a.atual + '. Possível(is) ausente(s): ' + escapeHtml(a.faltantes.join(', ')) + '</li>').join('');
  return '<div style="background:#fff4e5;border:1px solid #f59e0b;color:#7c2d12;padding:12px 14px;margin:12px 0;border-radius:4px"><strong>Alerta de sequência:</strong><ul style="margin:8px 0 0 18px;padding:0">' + itens + '</ul></div>';
}

function prioridadeTipoEmail(tipo) {
  const t = String(tipo || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();

  if (/^(PL|PLO)(\b|$)/.test(t) || /^PROJETO DE LEI( ORDINARIA)?$/.test(t)) return 0;
  if (/^PLC(\b|$)/.test(t) || /^PROJETO DE LEI COMPLEMENTAR/.test(t)) return 1;
  if (/^PEC(\b|$)/.test(t) || /^(PROPOSTA|PROJETO) DE EMENDA (A )?CONSTITUCIONAL/.test(t)) return 2;
  return 10;
}

function numeroProposicaoEmail(p) {
  const n = Number(String(p?.numero || '').replace(/\D/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function compararProposicoesEmail(a, b) {
  const tipoA = a?.sigla || a?.tipo || '';
  const tipoB = b?.sigla || b?.tipo || '';
  const prioridadeA = prioridadeTipoEmail(tipoA);
  const prioridadeB = prioridadeTipoEmail(tipoB);
  if (prioridadeA !== prioridadeB) return prioridadeA - prioridadeB;
  const tipoCmp = String(tipoA).localeCompare(String(tipoB), 'pt-BR');
  if (tipoCmp !== 0) return tipoCmp;
  return numeroProposicaoEmail(b) - numeroProposicaoEmail(a);
}

const CLIENTES_NOMES_PROPRIOS = [
  'FIRJAN', 'Red Bull', 'Sindicerv', 'Boticario', 'Boticário', 'Abrasel', 'ANBRASEL',
  'Energisa', 'EnergisaLuz', 'SABESP', 'COMGAS', 'COMGÁS', 'Eletromidia', 'Eletromídia',
  'BRT', 'Regenera', 'Nova Infra', 'Seta', 'SETA', 'AkzoNobel', 'Expedia', 'RTSC',
  'Huawei', 'Carrefour', 'JBS', 'Ajinomoto', 'Vibra', 'Mindlab', 'ABVTEX', 'Neoenergia', 'ENEL'
];

function clientesCitadosNaProposicao(p) {
  const texto = [p.cliente, p.clientes, p.autor, p.autores, p.tipo, p.rotulo, p.titulo, p.identificacao, p.ementa]
    .filter(Boolean)
    .join(' ');
  const achados = [];
  for (const nome of CLIENTES_NOMES_PROPRIOS) {
    const escaped = nome.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(^|[^A-Za-zÀ-ÿ0-9])' + escaped + '([^A-Za-zÀ-ÿ0-9]|$)', 'i');
    if (re.test(texto) && !achados.some(a => a.toLowerCase() === nome.toLowerCase())) achados.push(nome);
  }
  return achados;
}

function anotarClientesCitados(proposicoes) {
  for (const p of proposicoes || []) {
    const clientes = clientesCitadosNaProposicao(p);
    p.clientesCitados = clientes;
    if (clientes.length && p.ementa && !String(p.ementa).includes('Cliente citado:')) {
      p.ementa = String(p.ementa).trim() + ' | Cliente citado: ' + clientes.join(', ');
    }
  }
}

async function enviarEmail(novas, alertas = []) {
  anotarClientesCitados(novas);
  if (process.env.DRY_RUN_EMAIL === '1') {
    console.log('[DRY_RUN_EMAIL] ' + novas.length + ' proposições novas.');
    novas.slice(0, 10).forEach(p => console.log(p.tipo + ' ' + p.numero + '/' + p.ano + ' - ' + p.ementa + ' - ' + p.link));
    alertas.forEach(a => console.log('[ALERTA_SEQUENCIA] ' + a.tipo + '/' + a.ano + ': ' + a.anterior + ' -> ' + a.atual + '; faltantes: ' + a.faltantes.join(', ')));
    return;
  }
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_REMETENTE, pass: process.env.EMAIL_SENHA } });
  const novasOrdenadas = [...novas].sort(compararProposicoesEmail);
  const linhas = novasOrdenadas.map(p => '<tr><td style="padding:8px;border-bottom:1px solid #eee"><a href="' + escapeHtml(p.link) + '"><strong>' + escapeHtml(p.tipo) + ' ' + escapeHtml(p.numero) + '/' + escapeHtml(p.ano) + '</strong></a><br><span style="font-size:11px;color:#667085">Proc. ' + escapeHtml(p.processo || '-') + '</span></td><td style="padding:8px;border-bottom:1px solid #eee">' + escapeHtml(p.ementa) + '</td></tr>').join('');
  await transporter.sendMail({
    from: '"Monitor ' + CASA + '" <' + process.env.EMAIL_REMETENTE + '>',
    to: process.env.EMAIL_DESTINO,
    subject: '🏛️ Macapá: ' + novas.length + ' nova(s) proposição(ões)' + (alertas.length ? ' | alerta sequência' : '') + ' — ' + new Date().toLocaleDateString('pt-BR'),
    html: '<div style="font-family:Arial,sans-serif;max-width:960px"><h2>Macapá — ' + novas.length + ' nova(s) proposição(ões)</h2>' + renderAlertasSaltos(alertas) + '<table style="border-collapse:collapse;width:100%">' + linhas + '</table><p><a href="' + LISTA + '">Fonte oficial</a></p></div>',
  });
}

(async () => {
  console.log('Iniciando Monitor Proposições Macapá...');
  const estado = carregarEstado();
  const ids = new Set((estado.proposicoes_vistas || []).map(String));
  const proposicoes = await buscarProposicoes(ids);
  const novas = proposicoes.filter(p => !ids.has(p.id));
  const { alertas, atuais } = detectarSaltos(proposicoes, estado);
  console.log('Total: ' + proposicoes.length + ' | Novas: ' + novas.length);
  if (process.env.SEED_ONLY === '1') {
    proposicoes.forEach(p => ids.add(p.id));
    estado.proposicoes_vistas = Array.from(ids);
    estado.ultimos_por_tipo_ano = { ...(estado.ultimos_por_tipo_ano || {}), ...atuais };
    estado.ultima_execucao = new Date().toISOString();
    salvarEstado(estado);
    console.log('SEED_ONLY=1 — estado semeado sem envio.');
    return;
  }
  if (novas.length || alertas.length) {
    await enviarEmail(novas, alertas);
    novas.forEach(p => ids.add(p.id));
    estado.proposicoes_vistas = Array.from(ids);
  }
  estado.ultimos_por_tipo_ano = { ...(estado.ultimos_por_tipo_ano || {}), ...atuais };
  estado.ultima_execucao = new Date().toISOString();
  salvarEstado(estado);
})();
