const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = process.env.PORT || 3000

const DATA_FILE = path.join(__dirname, 'data.json')
let db = {
  users: [],
  sessions: {},
  posts: [],
  comments: {},
}

function loadDB() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8')
      const parsed = JSON.parse(raw)
      db = {
        users: Array.isArray(parsed.users) ? parsed.users : [],
        sessions: parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {},
        posts: Array.isArray(parsed.posts) ? parsed.posts : [],
        comments: parsed.comments && typeof parsed.comments === 'object' ? parsed.comments : {},
      }
    }
  } catch {}
}

function saveDB() {
  try {
    const payload = JSON.stringify(db, null, 2)
    fs.writeFileSync(DATA_FILE, payload, 'utf-8')
  } catch {}
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function readBody(req) {
  return new Promise(resolve => {
    let body = ''
    req.on('data', chunk => (body += chunk))
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch {
        resolve({})
      }
    })
  })
}

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function getUserByToken(req) {
  const auth = req.headers['authorization'] || ''
  const token = auth.replace('Bearer ', '').trim()
  const uid = db.sessions[token]
  if (!uid) return null
  return db.users.find(u => u.id === uid) || null
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`)
  let filePath = url.pathname
  if (filePath === '/') filePath = '/index.html'
  if (filePath === '/login') filePath = '/login.html'
  const full = path.join(__dirname, 'public', path.normalize(filePath).replace(/^\\+|^\/+/, ''))
  if (!full.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403)
    return res.end('Forbidden')
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404)
      return res.end('Not found')
    }
    const ext = path.extname(full).toLowerCase()
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.ico': 'image/x-icon',
      '.json': 'application/json; charset=utf-8',
    }
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' })
    res.end(data)
  })
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (req.method === 'POST' && url.pathname === '/api/signup') {
    const body = await readBody(req)
    const username = (body.username || '').trim().toLowerCase()
    const password = String(body.password || '')
    if (!username || !password) return json(res, 400, { error: 'invalid' })
    if (db.users.find(u => u.username === username)) return json(res, 409, { error: 'exists' })
    const user = { id: genId(), username, password }
    db.users.push(user)
    const token = genId()
    db.sessions[token] = user.id
    saveDB()
    return json(res, 201, { token, user: { id: user.id, username: user.username } })
  }
  if (req.method === 'POST' && url.pathname === '/api/login') {
    const body = await readBody(req)
    const username = (body.username || '').trim().toLowerCase()
    const password = String(body.password || '')
    const user = db.users.find(u => u.username === username && u.password === password)
    if (!user) return json(res, 401, { error: 'unauthorized' })
    const token = genId()
    db.sessions[token] = user.id
    return json(res, 200, { token, user: { id: user.id, username: user.username } })
  }
  if (req.method === 'GET' && url.pathname === '/api/me') {
    const user = getUserByToken(req)
    if (!user) return json(res, 401, { error: 'unauthorized' })
    return json(res, 200, { id: user.id, username: user.username })
  }
  if (req.method === 'GET' && url.pathname === '/api/feed') {
    const user = getUserByToken(req)
    if (!user) return json(res, 401, { error: 'unauthorized' })
    const feed = db.posts.slice().sort((a, b) => b.createdAt - a.createdAt)
    return json(res, 200, feed.map(p => ({
      id: p.id,
      author: p.author,
      kind: p.kind,
      title: p.title,
      content: p.content,
      likes: p.likes,
      score: p.score,
      createdAt: p.createdAt,
      comments: (db.comments[p.id] || []).length,
      liked: Array.isArray(p.likedBy) ? p.likedBy.includes(user.username) : false,
    })))
  }
  if (req.method === 'POST' && url.pathname === '/api/post') {
    const user = getUserByToken(req)
    if (!user) return json(res, 401, { error: 'unauthorized' })
    const body = await readBody(req)
    const kind = body.kind === 'thread' ? 'thread' : 'chirp'
    const content = String(body.content || '').trim()
    const title = kind === 'thread' ? String(body.title || '').trim() : ''
    if (!content || (kind === 'thread' && !title)) return json(res, 400, { error: 'invalid' })
    const post = {
      id: genId(),
      author: user.username,
      kind,
      title,
      content,
      likes: 0,
      score: 0,
      createdAt: Date.now(),
      likedBy: [],
    }
    db.posts.push(post)
    db.comments[post.id] = []
    saveDB()
    return json(res, 201, post)
  }
  if (req.method === 'POST' && url.pathname === '/api/comment') {
    const user = getUserByToken(req)
    if (!user) return json(res, 401, { error: 'unauthorized' })
    const body = await readBody(req)
    const postId = String(body.postId || '')
    const content = String(body.content || '').trim()
    const post = db.posts.find(p => p.id === postId)
    if (!post || !content) return json(res, 400, { error: 'invalid' })
    const comment = { id: genId(), author: user.username, content, createdAt: Date.now() }
    db.comments[post.id].push(comment)
    saveDB()
    return json(res, 201, comment)
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/comments/')) {
    const user = getUserByToken(req)
    if (!user) return json(res, 401, { error: 'unauthorized' })
    const postId = url.pathname.split('/').pop()
    const list = db.comments[postId] || []
    return json(res, 200, list.slice().sort((a, b) => a.createdAt - b.createdAt))
  }
  if (req.method === 'POST' && url.pathname === '/api/like') {
    const user = getUserByToken(req)
    if (!user) return json(res, 401, { error: 'unauthorized' })
    const body = await readBody(req)
    const post = db.posts.find(p => p.id === body.postId)
    if (!post) return json(res, 404, { error: 'not_found' })
    post.likedBy = Array.isArray(post.likedBy) ? post.likedBy : []
    if (post.likedBy.includes(user.username)) {
      return json(res, 409, { error: 'already_liked', likes: post.likes })
    }
    post.likedBy.push(user.username)
    post.likes += 1
    saveDB()
    return json(res, 200, { likes: post.likes, liked: true })
  }
  if (req.method === 'POST' && url.pathname === '/api/vote') {
    const user = getUserByToken(req)
    if (!user) return json(res, 401, { error: 'unauthorized' })
    const body = await readBody(req)
    const post = db.posts.find(p => p.id === body.postId)
    if (!post) return json(res, 404, { error: 'not_found' })
    const delta = Number(body.delta || 0)
    post.score += delta > 0 ? 1 : -1
    saveDB()
    return json(res, 200, { score: post.score })
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/post/')) {
    const user = getUserByToken(req)
    if (!user) return json(res, 401, { error: 'unauthorized' })
    const postId = url.pathname.split('/').pop()
    const idx = db.posts.findIndex(p => p.id === postId)
    if (idx === -1) return json(res, 404, { error: 'not_found' })
    const post = db.posts[idx]
    if (post.author !== user.username) return json(res, 403, { error: 'forbidden' })
    db.posts.splice(idx, 1)
    delete db.comments[postId]
    saveDB()
    return json(res, 200, { ok: true })
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/comment/')) {
    const user = getUserByToken(req)
    if (!user) return json(res, 401, { error: 'unauthorized' })
    const commentId = url.pathname.split('/').pop()
    const urlObj = new URL(req.url, `http://${req.headers.host}`)
    const postId = urlObj.searchParams.get('post') || ''
    const list = db.comments[postId]
    if (!Array.isArray(list)) return json(res, 404, { error: 'not_found' })
    const idx = list.findIndex(c => c.id === commentId)
    if (idx === -1) return json(res, 404, { error: 'not_found' })
    const comment = list[idx]
    if (comment.author !== user.username) return json(res, 403, { error: 'forbidden' })
    list.splice(idx, 1)
    saveDB()
    return json(res, 200, { ok: true })
  }
  res.writeHead(404)
  res.end('Not found')
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return handleApi(req, res)
  return serveStatic(req, res)
})

if (process.env.VERCEL) {
  module.exports = (req, res) => {
    if (req.url.startsWith('/api/')) return handleApi(req, res)
    return serveStatic(req, res)
  }
} else {
  loadDB()
  server.listen(PORT, () => {
    console.log(`Chirp & Talk running on port ${PORT}`)
  })
}