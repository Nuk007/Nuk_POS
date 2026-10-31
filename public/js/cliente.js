// ═══════════════════════════════════════════════
//  DADOS
// ═══════════════════════════════════════════════
const MENU = {
  comidas:[
    {n:'Frango Grelhado',e:'🍗',p:3500},
    {n:'Funge c/ Muamba',e:'🍲',p:4000},
    {n:'Bife de Vitela',e:'🥩',p:5500},
    {n:'Peixe Frito',e:'🐟',p:4500},
    {n:'Churrasco Misto',e:'🍖',p:7000},
    {n:'Salada Mista',e:'🥗',p:2000},
    {n:'Camarão Grelhado',e:'🦐',p:8000},
    {n:'Sopa do Dia',e:'🍜',p:1500},
  ],
  bebidas:[
    {n:'Cuca (lata)',e:'🍺',p:500},
    {n:'Cuca (600ml)',e:'🍺',p:700},
    {n:'Água (500ml)',e:'💧',p:300},
    {n:'Refrigerante',e:'🥤',p:500},
    {n:'Sumo Natural',e:'🍊',p:1200},
    {n:'Whisky',e:'🥃',p:3000},
    {n:'Vinho (taça)',e:'🍷',p:2500},
    {n:'Café',e:'☕',p:400},
  ],
  cigarros:[
    {n:'Marlboro',e:'🚬',p:1200},
    {n:'LM',e:'🚬',p:1000},
    {n:'SG',e:'🚬',p:800},
    {n:'Peter Stuyvesant',e:'🚬',p:1100},
  ],
  outros:[
    {n:'Sobremesa do Dia',e:'🍮',p:1500},
    {n:'Fruta da Época',e:'🍍',p:1200},
    {n:'Água Tónica',e:'🫧',p:600},
    {n:'Gelado',e:'🍦',p:1000},
  ]
};

// ═══════════════════════════════════════════════
//  CONFIGURAÇÃO API
// ═══════════════════════════════════════════════
const API_BASE = window.location.origin;
// O estabelecimento vem do QR code: /cliente?r=<slug>. Fica guardado para o resto da visita.
const TENANT_SLUG = (() => {
  const q = new URLSearchParams(location.search);
  let v = (q.get('r') || q.get('slug') || '').toLowerCase().trim();
  try { if (v) sessionStorage.setItem('nuk_slug', v); else v = sessionStorage.getItem('nuk_slug') || ''; } catch (e) {}
  return v;
})();
function api(path, opts = {}) {
  const headers = Object.assign({ 'X-Tenant-Slug': TENANT_SLUG }, opts.headers || {});
  return fetch(API_BASE + path, Object.assign({}, opts, { headers }));
}

// ═══════════════════════════════════════════════
//  ESTADO DA SESSÃO
// ═══════════════════════════════════════════════
let session = {
  nome:'', tel:'', prov:'',
  isCliente:false, clienteId:null, stars:0, wallet:0, pontos:50,
  cart:{}, payMethod:null, creditSel:0,
  // cardápio real carregado da API
  menuLoaded:false, menuData:{}
};

// ═══════════════════════════════════════════════
//  UTILIDADES
// ═══════════════════════════════════════════════
if(!TENANT_SLUG){ document.addEventListener('DOMContentLoaded',()=>{ const a=document.getElementById('acc-sem-slug'); if(a) a.style.display='block'; }); }
function go(id){ document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active')); document.getElementById(id).classList.add('active'); window.scrollTo(0,0); }
function fmt(n){ return n.toLocaleString('pt-PT')+' Kz'; }
function toast(msg,type='info'){
  const t=document.getElementById('toast');
  t.textContent=msg; t.className='show '+(type||'');
  clearTimeout(t._t); t._t=setTimeout(()=>t.className='',2800);
}

// ═══════════════════════════════════════════════
//  ECRÃ 0 — ACESSO
// ═══════════════════════════════════════════════
async function submitAcesso(){
  const nome=document.getElementById('acc-nome').value.trim();
  const tel=document.getElementById('acc-tel').value.trim();
  const prov=document.getElementById('acc-prov').value;
  if(!nome){ toast('Insira o seu nome.','err'); return; }
  if(!/^9[0-9]{8}$/.test(tel)){ toast('Telemóvel inválido (9XXXXXXXX).','err'); return; }
  if(!prov){ toast('Seleccione a sua província.','err'); return; }
  session.nome=nome; session.tel=tel; session.prov=prov;

  // Identificar cliente registado (telefone + PIN). Sem PIN → visitante.
  const pin=document.getElementById('acc-pin').value.trim();
  if(pin){
    if(!/^\d{4}$/.test(pin)){ toast('O PIN tem 4 dígitos.','err'); return; }
    try {
      let r = await api(`/api/cliente/login`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ telefone: tel, pin })
      });
      if(r.status===403){
        // cliente antigo sem PIN: o PIN escolhido fica definido (só é possível enquanto não existir um)
        const d = await api(`/api/cliente/definir-pin`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ telefone: tel, pin }) });
        if(d.ok){ toast('PIN definido. Guarde-o: é a sua chave.','ok'); r = await api(`/api/cliente/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ telefone: tel, pin }) }); }
      }
      if(r.status===401){ toast('Telefone ou PIN incorrecto. Ainda não tem conta? Crie uma abaixo.','err'); return; }
      if(r.status===400 || r.status===404 || r.status===403){ const e=await r.json().catch(()=>({})); toast(e.erro||'Não foi possível entrar.','err'); return; }
      if(r.ok){
        const data = await r.json();
        const c = data.cliente;
        session.isCliente = true;
        session.clienteId = c.id;
        session.pin = pin;
        session.stars = c.estrelas || 0;
        session.wallet = parseFloat(c.nukcoin_saldo) || 0;
        session.pontos = c.pontos || 50;
        session.nome = c.nome; // usa nome do BD
      }
    } catch(e) {
      toast('Sem ligação ao servidor. Tente novamente.','err'); return;
    }
  }

  // Actualizar ecrã auth
  document.getElementById('auth-greeting').textContent='Seja bem-vindo'+(session.isCliente?', '+session.nome.split(' ')[0]+'!':'!');
  document.getElementById('auth-name-sub').textContent=session.isCliente?'Como pretende prosseguir?':'Seleccione uma opção abaixo.';
  if(session.isCliente){ renderStars(session.stars); document.getElementById('stars-bar').style.display='flex'; }
  else { document.getElementById('stars-bar').style.display='none'; }
  go('s-auth');
}

function renderStars(n){
  const bar=document.getElementById('stars-bar');
  bar.style.display='flex';
  const stars=bar.querySelectorAll('.star');
  stars.forEach((s,i)=>s.classList.toggle('on',i<n));
  document.getElementById('stars-desc').textContent=n>=5?'🎁 Tem 20% de desconto disponível!':n+' / 5 para 20% desconto';
}

// ═══════════════════════════════════════════════
//  ECRÃ 1 — AUTH / SAIR
// ═══════════════════════════════════════════════
function sair(){
  // Se veio do formulário de acesso, volta; caso contrário recomeça
  go('s-acesso');
  session={nome:'',tel:'',prov:'',isCliente:false,stars:0,wallet:0,pontos:50,cart:{},payMethod:null,creditSel:0};
}

// ═══════════════════════════════════════════════
//  ECRÃ 3 — PERFIL TILE
// ═══════════════════════════════════════════════
function loadClienteMenu(){
  document.getElementById('cli-nome-tile').textContent=session.nome||'—';
  document.getElementById('cli-tel-tile').textContent='+244 '+session.tel;
  document.getElementById('cli-avatar').textContent=(session.nome||'?')[0].toUpperCase();
  document.getElementById('cli-wallet-pill').textContent='💜 '+fmt(session.wallet);
  document.getElementById('cli-stars-pill').textContent='⭐ '+session.stars+'/5';
  go('s-cliente-menu');
}

// ═══════════════════════════════════════════════
//  ECRÃ 4 — NUK-COIN
// ═══════════════════════════════════════════════
function loadNukCoin(){
  document.getElementById('wlt-saldo').innerHTML=fmt(session.wallet).replace(' Kz','')+'<span> Kz</span>';
  session.creditSel=0;
  document.querySelectorAll('.credit-opt').forEach(o=>o.classList.remove('selected'));
  const cc=document.getElementById('credit-confirm'); if(cc) cc.style.display='none';
  go('s-nukcoin');
  atualizarSaldo();
}
// Saldo e movimentos reais (exige o PIN da sessão)
async function atualizarSaldo(){
  if(!session.clienteId || !session.pin) return;
  try {
    const p = await api(`/api/cliente/perfil`,{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ telefone: session.tel, pin: session.pin }) });
    if(p.ok){
      const d = await p.json();
      session.wallet = parseFloat(d.cliente.nukcoin_saldo)||0; session.stars = d.cliente.estrelas||0;
      document.getElementById('wlt-saldo').innerHTML=fmt(session.wallet).replace(' Kz','')+'<span> Kz</span>';
      document.getElementById('cli-wallet-pill').textContent='💜 '+fmt(session.wallet);
    }
    const h = await api(`/api/cliente/nukcoin/historico?cliente_id=${session.clienteId}`,{ headers:{ 'X-Cliente-Pin': session.pin } });
    if(h.ok){
      const { movimentos } = await h.json();
      const nomes = { CARREGAMENTO:'Carregamento', CONSUMO:'Consumo', ESTORNO:'Estorno', BONUS:'Bónus' };
      document.getElementById('wlt-hist').innerHTML = movimentos.length ? movimentos.map(m=>{
        const entra = m.tipo!=='CONSUMO';
        return '<div class="hist-item"><div><div style="font-weight:600">'+(nomes[m.tipo]||m.tipo)+'</div><div class="hist-date">'+new Date(m.criado_em).toLocaleString('pt-PT')+'</div></div><div class="hist-val">'+(entra?'+':'−')+fmt(parseFloat(m.valor))+'</div></div>';
      }).join('') : '<div class="hist-item"><div class="hist-date">Ainda sem movimentos</div></div>';
    }
  } catch(e){ /* sem ligação: mantém o que está no ecrã */ }
}
function selectCredit(el,val){
  session.creditSel=val;
  document.querySelectorAll('.credit-opt').forEach(o=>o.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('credit-confirm').style.display='block';
  document.getElementById('credit-chosen').textContent='Carregar '+fmt(val)+' na carteira Nuk-Coin.';
}
async function confirmarCredito(){
  if(!session.creditSel) return;
  if(!session.clienteId){ toast('Necessário ser cliente registado.','err'); return; }
  try {
    const r = await api(`/api/cliente/nukcoin/carregar`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ cliente_id: session.clienteId, valor: session.creditSel })
    });
    const data = await r.json();
    if(!r.ok){ toast(data.erro||'Erro ao carregar.','err'); return; }
    session.wallet = parseFloat(data.saldo_atual);
    document.getElementById('wlt-saldo').innerHTML=fmt(session.wallet).replace(' Kz','')+'<span> Kz</span>';
    const hist=document.getElementById('wlt-hist');
    const li=document.createElement('div'); li.className='hist-item';
    li.innerHTML='<div><div style="font-weight:600">Carregamento</div><div class="hist-date">Agora</div></div><div class="hist-val">+'+fmt(session.creditSel)+'</div>';
    hist.prepend(li);
    document.getElementById('cli-wallet-pill').textContent='💜 '+fmt(session.wallet);
    document.getElementById('credit-confirm').style.display='none';
    document.querySelectorAll('.credit-opt').forEach(o=>o.classList.remove('selected'));
    toast('✓ Carteira carregada com '+fmt(session.creditSel),'ok');
    session.creditSel=0;
  } catch(e) {
    // Fallback offline
    session.wallet+=session.creditSel;
    document.getElementById('wlt-saldo').innerHTML=fmt(session.wallet).replace(' Kz','')+'<span> Kz</span>';
    document.getElementById('cli-wallet-pill').textContent='💜 '+fmt(session.wallet);
    document.getElementById('credit-confirm').style.display='none';
    document.querySelectorAll('.credit-opt').forEach(o=>o.classList.remove('selected'));
    toast('✓ Carteira carregada (demo)','ok');
    session.creditSel=0;
  }
}

// ═══════════════════════════════════════════════
//  ECRÃ 5 — RESTAURANTE
// ═══════════════════════════════════════════════
// Mapeamento categoria → emoji e grid
const CAT_MAP={
  'Comidas':{e:'🍽️',grid:'grid-comidas'},
  'Bebidas':{e:'🥤',grid:'grid-bebidas'},
  'Cigarros':{e:'🚬',grid:'grid-cigarros'},
  'Outros':{e:'📦',grid:'grid-outros'},
};
function emojiForCat(cat){
  const k=Object.keys(CAT_MAP).find(k=>cat&&cat.toLowerCase().includes(k.toLowerCase()));
  return k?CAT_MAP[k].e:'📦';
}
function gridForCat(cat){
  const k=Object.keys(CAT_MAP).find(k=>cat&&cat.toLowerCase().includes(k.toLowerCase()));
  return k?CAT_MAP[k].grid:'grid-outros';
}

function buildMenu(){
  // Limpar todos os grids
  ['grid-comidas','grid-bebidas','grid-cigarros','grid-outros'].forEach(id=>{
    document.getElementById(id).innerHTML='';
  });
  // Usar menuData (API) ou MENU (fallback)
  let produtos=[];
  if(session.menuLoaded && session.menuData.produtos && session.menuData.produtos.length>0){
    produtos=session.menuData.produtos;
  } else {
    // Converter MENU estático para formato API
    ['comidas','bebidas','cigarros','outros'].forEach(cat=>{
      (MENU[cat]||[]).forEach(item=>produtos.push({id:null,nome:item.n,preco:item.p,categoria:cat.charAt(0).toUpperCase()+cat.slice(1),_emoji:item.e}));
    });
  }
  produtos.forEach(item=>{
    const gid=gridForCat(item.categoria);
    const g=document.getElementById(gid); if(!g) return;
    const d=document.createElement('div'); d.className='menu-item';
    const qty=session.cart[item.nome]||0; if(qty>0) d.classList.add('in-cart');
    const em=item._emoji||emojiForCat(item.categoria);
    d.innerHTML='<span class="menu-item-emoji">'+em+'</span><div class="menu-item-name">'+item.nome+'</div><div class="menu-item-price">'+fmt(parseFloat(item.preco))+'</div>';
    if(qty>0) d.innerHTML+='<div style="font-size:.65rem;color:var(--ok);margin-top:3px">No carrinho: '+qty+'</div>';
    d.onclick=()=>{ addToCart({n:item.nome,p:parseFloat(item.preco),e:em,id:item.id}); };
    g.appendChild(d);
  });
}
function addToCart(item){
  session.cart[item.n]=(session.cart[item.n]||0)+1;
  session.cart[item.n+'_price']=item.p;
  if(item.id) session.cart[item.n+'_id']=item.id;
  updateCartBadge(); buildMenu();
  toast(item.e+' '+item.n+' adicionado','info');
}

async function loadRestaurante(){
  // Carregar cardápio da API se ainda não carregado
  if(!session.menuLoaded){
    try {
      const r=await api(`/api/cliente/cardapio`);
      if(r.ok){
        session.menuData=await r.json();
        session.menuLoaded=true;
      }
    } catch(e){ console.warn('Cardápio offline, usando demo'); }
  }
  buildMenu(); updateCartBadge();
}
function updateCartBadge(){
  const total=Object.entries(session.cart).filter(([k])=>!k.endsWith('_price') && !k.endsWith('_id')).reduce((s,[,v])=>s+v,0);
  document.getElementById('cart-badge').textContent=total;
  document.getElementById('cart-badge-btn').textContent=total;
  document.getElementById('cart-count').textContent=total;
}
function voltarDeRestaurante(){ session.isCliente?go('s-cliente-menu'):go('s-convidado'); }

// ═══════════════════════════════════════════════
//  ECRÃ 6 — CARRINHO
// ═══════════════════════════════════════════════
function loadCarrinho(){
  const items=Object.entries(session.cart).filter(([k])=>!k.endsWith('_price') && !k.endsWith('_id'));
  const ul=document.getElementById('cart-list');
  ul.innerHTML='';
  let total=0;
  if(items.length===0){
    ul.innerHTML='<li style="color:var(--muted);font-size:.82rem;padding:12px 0;text-align:center">Carrinho vazio</li>';
  } else {
    items.forEach(([name,qty])=>{
      const price=session.cart[name+'_price']||0;
      total+=price*qty;
      const li=document.createElement('li'); li.className='cart-item';
      const nameSpan=document.createElement('span'); nameSpan.className='cart-item-name'; nameSpan.textContent=name;
      const qtySpan=document.createElement('span'); qtySpan.className='cart-item-qty';
      const btnMinus=document.createElement('button'); btnMinus.className='qty-btn'; btnMinus.textContent='−';
      btnMinus.addEventListener('click',()=>changeQty(name,-1));
      const qtyNum=document.createElement('span'); qtyNum.textContent=qty;
      const btnPlus=document.createElement('button'); btnPlus.className='qty-btn'; btnPlus.textContent='+';
      btnPlus.addEventListener('click',()=>changeQty(name,1));
      qtySpan.appendChild(btnMinus); qtySpan.appendChild(qtyNum); qtySpan.appendChild(btnPlus);
      const priceSpan=document.createElement('span'); priceSpan.className='cart-item-price'; priceSpan.textContent=fmt(price*qty);
      li.appendChild(nameSpan); li.appendChild(qtySpan); li.appendChild(priceSpan);
      ul.appendChild(li);
    });
  }
  // Desconto estrelas
  let desc=false;
  if(session.stars>=5 && total<=25000){ desc=true; total=Math.round(total*0.8); }
  document.getElementById('disc-info').style.display=desc?'block':'none';
  document.getElementById('cart-total').textContent=fmt(total);
  document.getElementById('pay-coin-sub').textContent='Saldo: '+fmt(session.wallet);
  document.getElementById('coin-pay-info').style.display='none';
  session.cartTotal=total;
  go('s-carrinho');
}
function changeQty(name,delta){
  session.cart[name]=Math.max(0,(session.cart[name]||0)+delta);
  if(session.cart[name]===0){ delete session.cart[name]; delete session.cart[name+'_price']; delete session.cart[name+'_id']; }
  updateCartBadge(); loadCarrinho();
}
function selectPay(el,method){
  session.payMethod=method;
  document.querySelectorAll('.pay-opt').forEach(o=>o.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('coin-pay-info').style.display=method==='coin'?'block':'none';
}
async function confirmarPedido(){
  const items=Object.entries(session.cart).filter(([k])=>!k.endsWith('_price') && !k.endsWith('_id'));
  if(items.length===0){ toast('Adicione produtos ao carrinho.','err'); return; }
  if(!session.payMethod){ toast('Seleccione a forma de pagamento.','err'); return; }
  if(session.payMethod==='coin' && session.wallet<session.cartTotal){ toast('Saldo insuficiente. Carregue a carteira.','err'); return; }

  // Mapear método para o formato da API
  const metodosMap={coin:'NUKCOIN',cash:'CASH',tpa:'TPA',express:'EXPRESS',transfer:'TRANSFERENCIA'};
  const metodoApi=metodosMap[session.payMethod]||'CASH';

  // Montar itens para API
  const itensApi=items.map(([nome,qty])=>{
    const pid=session.cart[nome+'_id'];
    return pid?{produto_id:pid,quantidade:qty}:null;
  }).filter(Boolean);

  let earnStar=false, totalFinal=session.cartTotal, novoSaldo=session.wallet;

  if(itensApi.length>0 && session.clienteId){
    // Enviar pedido real à API
    try {
      const r=await api(`/api/cliente/pedido-restaurante`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          itens:itensApi,
          cliente_id:session.clienteId,
          pin:session.pin,
          metodo_pagamento:metodoApi,
          observacoes:null
        })
      });
      const data=await r.json();
      if(!r.ok){ toast(data.erro||'Erro ao enviar pedido.','err'); return; }
      earnStar=data.estrela_ganha||false;
      totalFinal=parseFloat(data.total_final)||session.cartTotal;
      if(data.nukcoin_saldo_novo!=null) novoSaldo=parseFloat(data.nukcoin_saldo_novo);
    } catch(e){
      console.warn('API indisponível — modo demo');
      // Continuar offline: calcular localmente
      if(session.payMethod==='coin') novoSaldo=session.wallet-session.cartTotal;
      earnStar=session.cartTotal>=25000;
    }
  } else {
    // Convidado ou produtos sem ID — modo demo
    if(session.payMethod==='coin') novoSaldo=session.wallet-session.cartTotal;
    earnStar=session.cartTotal>=25000;
  }

  // Actualizar estado local
  if(session.payMethod==='coin') session.wallet=novoSaldo;
  if(earnStar){ session.stars=Math.min(5,session.stars+1); renderStars(session.stars); }
  session.cart={}; session.payMethod=null; updateCartBadge(); buildMenu();

  // Actualizar pilulas no menu cliente
  if(session.isCliente){
    document.getElementById('cli-wallet-pill').textContent='💜 '+fmt(session.wallet);
    document.getElementById('cli-stars-pill').textContent='⭐ '+session.stars+'/5';
  }

  // Ecrã confirmação
  const nomeMetodo={coin:'Nuk-Coin',cash:'Dinheiro',tpa:'TPA',express:'Express',transfer:'Transferência'}[session.payMethod||'cash'];
  document.getElementById('pedido-ok-msg').textContent='Pedido confirmado. Pagamento: '+(nomeMetodo||metodoApi)+' — '+fmt(totalFinal);
  document.getElementById('star-earned').style.display=earnStar?'block':'none';
  document.getElementById('disc-earned').style.display=(session.stars>=5)?'block':'none';
  go('s-pedido-ok');
}

// ═══════════════════════════════════════════════
//  ECRÃ 8 — SERVIÇOS
// ═══════════════════════════════════════════════
function voltarDeServicos(){ session.isCliente?go('s-cliente-menu'):go('s-convidado'); }
// Mapeamento serviço → fracao API
const FRACAO_MAP={'2 Horas':'DUAS_HORAS','Pernoite':'PERNOITE','Diária':'DIARIA','Semana':'DIARIA'};
async function solicitarServico(tipo,preco){
  const fracao=FRACAO_MAP[tipo]||'DIARIA';
  try {
    await api(`/api/cliente/pedido-hospedagem`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        fracao, quantidade:1,
        nome_hospede:session.nome||null,
        telefone:session.tel||null,
        cliente_id:session.clienteId||null,
        observacoes:tipo
      })
    });
  } catch(e){ /* continuar offline */ }
  document.getElementById('sol-emoji').textContent='🛎️';
  document.getElementById('sol-titulo').textContent='Solicitação enviada!';
  document.getElementById('sol-msg').textContent=tipo+' ('+preco+') — a nossa equipa entrará em contacto para confirmar.';
  document.getElementById('sol-btn-menu').style.display=session.isCliente?'block':'none';
  document.getElementById('sol-btn-menu').onclick=()=>session.isCliente?loadClienteMenu():go('s-convidado');
  go('s-solicitacao-ok');
}

// ═══════════════════════════════════════════════
//  ECRÃ 9 — EVENTOS
// ═══════════════════════════════════════════════
function voltarDeEventos(){ session.isCliente?go('s-cliente-menu'):go('s-convidado'); }
function solicitarEvento(tipo){
  document.getElementById('sol-emoji').textContent='🎉';
  document.getElementById('sol-titulo').textContent='Evento solicitado!';
  document.getElementById('sol-msg').textContent=tipo+' — receberá um orçamento personalizado em breve. Obrigado!';
  document.getElementById('sol-btn-menu').style.display=session.isCliente?'block':'none';
  go('s-solicitacao-ok');
}

// ═══════════════════════════════════════════════
//  ECRÃ 10 — CADASTRAR
// ═══════════════════════════════════════════════
async function cadastrar(){
  const nome=document.getElementById('cad-nome').value.trim();
  const tel=document.getElementById('cad-tel').value.trim();
  const prov=document.getElementById('cad-prov').value;
  const ref=document.getElementById('cad-ref').value.trim();
  if(!nome){ toast('Insira o nome.','err'); return; }
  if(!/^9[0-9]{8}$/.test(tel)){ toast('Telemóvel inválido (9XXXXXXXX).','err'); return; }
  if(!prov){ toast('Seleccione a província.','err'); return; }
  const cadPin=document.getElementById('cad-pin').value.trim();
  if(!/^\d{4}$/.test(cadPin)){ toast('Escolha um PIN de 4 dígitos.','err'); return; }

  try {
    const r=await api(`/api/cliente/cadastrar`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({nome,telefone:tel,provincia:prov,pin:cadPin,referido_por_tel:ref||null})
    });
    const data=await r.json();
    if(!r.ok){ toast(data.erro||'Erro no cadastro.','err'); return; }
    const c=data.cliente;
    session.nome=c.nome; session.tel=c.telefone; session.prov=c.provincia||prov;
    session.isCliente=true; session.clienteId=c.id; session.pin=cadPin;
    session.stars=c.estrelas||0; session.wallet=parseFloat(c.nukcoin_saldo)||0;
    session.pontos=c.pontos||50;
    if(ref && /^9[0-9]{8}$/.test(ref)){
      toast('⭐ O seu amigo (+244 '+ref+') ganhou uma estrela!','info');
    }
  } catch(e){
    // Fallback offline
    session.nome=nome; session.tel=tel; session.prov=prov;
    session.isCliente=true; session.stars=0; session.wallet=0; session.pontos=50;
    if(ref && /^9[0-9]{8}$/.test(ref)){
      toast('⭐ O seu amigo (+244 '+ref+') ganhou uma estrela! (demo)','info');
    }
  }

  document.getElementById('sol-emoji').textContent='🎉';
  document.getElementById('sol-titulo').textContent='Cadastro concluído!';
  document.getElementById('sol-msg').textContent='Bem-vindo, '+session.nome.split(' ')[0]+'! Recebeu 50 pontos de boas-vindas. Pode agora aceder a todos os serviços.';
  document.getElementById('sol-btn-menu').style.display='block';
  document.getElementById('sol-btn-menu').onclick=()=>loadClienteMenu();
  go('s-solicitacao-ok');
}

// ═══════════════════════════════════════════════
//  NAVEGAÇÃO CLIENTE (botão Cliente no auth)
// ═══════════════════════════════════════════════
document.querySelector('#s-auth .btn-ok').onclick=function(){
  if(!session.nome){ toast('Identifique-se primeiro no formulário.','err'); go('s-acesso'); return; }
  if(!session.isCliente){ go('s-cadastrar'); return; }
  loadClienteMenu();
};

// Botão Nuk-Coin no menu cliente
document.querySelector('#s-cliente-menu .btn-coin').onclick=loadNukCoin;

// Botão Restaurante nos dois menus
document.querySelectorAll('#s-convidado .btn-primary, #s-cliente-menu .btn-primary').forEach(b=>{
  b.onclick=()=>{ loadRestaurante(); go('s-restaurante'); };
});

// Ver carrinho
const btnVerCarrinho=document.querySelector('#s-restaurante button[data-action="go"][data-screen="s-carrinho"]');
if(btnVerCarrinho) btnVerCarrinho.addEventListener('click',loadCarrinho);
const btnCarrinhoPrimary=document.querySelector('#s-restaurante .btn-primary[data-action="go"]');
if(btnCarrinhoPrimary) btnCarrinhoPrimary.addEventListener('click',loadCarrinho);

// ═══════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════
function voltarInicio(){ session.isCliente?loadClienteMenu():go('s-auth'); }

// ═══════════════════════════════════════════════
//  EVENT DELEGATION — substitui onclick= inline (bloqueados pela CSP)
// ═══════════════════════════════════════════════
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  if      (action === 'go')                 go(el.dataset.screen);
  else if (action === 'submit-acesso')      submitAcesso();
  else if (action === 'sair')               sair();
  else if (action === 'select-credit')      selectCredit(el, parseFloat(el.dataset.value));
  else if (action === 'confirmar-credito')  confirmarCredito();
  else if (action === 'atualizar-saldo')    atualizarSaldo();
  else if (action === 'voltar-de-restaurante') voltarDeRestaurante();
  else if (action === 'select-pay')         selectPay(el, el.dataset.method);
  else if (action === 'confirmar-pedido')   confirmarPedido();
  else if (action === 'voltar-inicio')      voltarInicio();
  else if (action === 'voltar-de-servicos') voltarDeServicos();
  else if (action === 'solicitar-servico')  solicitarServico(el.dataset.tipo, el.dataset.preco);
  else if (action === 'voltar-de-eventos')  voltarDeEventos();
  else if (action === 'solicitar-evento')   solicitarEvento(el.dataset.tipo);
  else if (action === 'cadastrar')          cadastrar();
});
