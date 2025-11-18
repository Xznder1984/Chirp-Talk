const token = localStorage.getItem('ct_token') || ''
if (!token) location.href = '/login.html'

const state = { kind: 'chirp', feed: [], me: null }

function qs(x){return document.querySelector(x)}
function el(tag, attrs={}, children=[]) { const e = document.createElement(tag); Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v)); children.forEach(c=>{ if(typeof c==='string') e.textContent=c; else e.appendChild(c) }); return e }

async function api(path, method='GET', body) {
  const res = await fetch(path, { method, headers: { 'Content-Type':'application/json', 'Authorization': 'Bearer '+token }, body: body?JSON.stringify(body):undefined })
  const data = await res.json().catch(()=>({}))
  return { ok: res.ok, data }
}

function fmtTime(ts){ const d=new Date(ts); return d.toLocaleString() }

function renderFeed(){
  const wrap = qs('#feed')
  wrap.innerHTML = ''
  state.feed.forEach(p=>{
    const meta = el('div',{class:'meta'},[ el('span',{},[p.author]), el('span',{},[fmtTime(p.createdAt)]) ])
    const chip = el('span',{class:'chip'},[ p.kind === 'thread' ? 'Thread' : 'Chirp' ])
    const title = p.kind==='thread' ? el('div',{class:'title'},[p.title]) : null
    const body = el('div',{class:'body'},[p.content])
    const like = el('button',{class:'btn', disabled: p.liked?true:false},[ (p.liked?'Liked ':'Like ')+p.likes ])
    like.onclick = async ()=>{ const r = await api('/api/like','POST',{ postId: p.id }); if(r.ok){ p.likes=r.data.likes; p.liked=true; renderFeed() } }
    const up = el('button',{class:'btn'},[ 'Up '+p.score ])
    up.onclick = async ()=>{ const r = await api('/api/vote','POST',{ postId: p.id, delta: 1 }); if(r.ok){ p.score=r.data.score; renderFeed() } }
    const down = el('button',{class:'btn'},[ 'Down' ])
    down.onclick = async ()=>{ const r = await api('/api/vote','POST',{ postId: p.id, delta: -1 }); if(r.ok){ p.score=r.data.score; renderFeed() } }
    const actions = el('div',{class:'row'},[like,up,down,chip])
    if (state.me && state.me.username === p.author) {
      const del = el('button',{class:'btn'},['Delete'])
      del.onclick = async ()=>{ const r = await api('/api/post/'+p.id,'DELETE'); if(r.ok){ loadFeed() } }
      actions.prepend(del)
    }
    const comments = el('div',{},[])
    const inputWrap = el('div',{class:'comment-input'},[])
    const input = el('input',{placeholder:'Reply'})
    const send = el('button',{},['Reply'])
    send.onclick = async ()=>{ const v=input.value.trim(); if(!v) return; const r=await api('/api/comment','POST',{ postId:p.id, content:v }); if(r.ok){ input.value=''; loadComments(p.id, comments) } }
    inputWrap.append(input, send)
    const postEl = el('article',{class:'post'},[])
    postEl.append(meta)
    if(title) postEl.append(title)
    postEl.append(body, actions, inputWrap, comments)
    wrap.append(postEl)
    loadComments(p.id, comments)
  })
}

async function loadFeed(){
  const r = await api('/api/feed')
  if (!r.ok) return
  state.feed = r.data
  renderFeed()
}

async function loadComments(id, container){
  const r = await api('/api/comments/'+id)
  if(!r.ok) return
  container.innerHTML=''
  r.data.forEach(c=>{
    const meta = el('div',{class:'meta'},[ el('span',{},[c.author]), el('span',{},[fmtTime(c.createdAt)]) ])
    const body = el('div',{},[c.content])
    const block = el('div',{class:'comment'},[])
    if (state.me && state.me.username === c.author) {
      const del = el('button',{class:'btn'},['Delete'])
      del.onclick = async ()=>{ const r = await api('/api/comment/'+c.id+'?post='+id,'DELETE'); if(r.ok){ loadComments(id, container) } }
      const row = el('div',{class:'row'},[])
      row.append(del)
      block.append(meta, body, row)
    } else {
      block.append(meta, body)
    }
    container.append(block)
  })
}

function setupComposer(){
  const tChirp = document.querySelector('[data-kind="chirp"]')
  const tThread = document.querySelector('[data-kind="thread"]')
  const title = qs('#titleInput')
  const content = qs('#contentInput')
  const post = qs('#postBtn')
  function setKind(k){ state.kind=k; tChirp.classList.toggle('active',k==='chirp'); tThread.classList.toggle('active',k==='thread'); title.style.display=k==='thread'?'block':'none'; content.placeholder = k==='chirp' ? "What's happening?" : "Share your thoughts" }
  tChirp.onclick=()=>setKind('chirp')
  tThread.onclick=()=>setKind('thread')
  setKind('chirp')
  post.onclick = async ()=>{
    const body = { kind: state.kind, content: content.value.trim() }
    if(state.kind==='thread') body.title = title.value.trim()
    if(!body.content || (state.kind==='thread'&&!body.title)) return
    const r = await api('/api/post','POST', body)
    if(r.ok){ title.value=''; content.value=''; loadFeed() }
  }
}

function setupLogout(){
  const btn = qs('#logoutBtn')
  btn.onclick = ()=>{ localStorage.removeItem('ct_token'); location.href='/login.html' }
}

async function init(){
  const me = await api('/api/me')
  if(me.ok) state.me = me.data
  setupComposer()
  setupLogout()
  loadFeed()
}

init()