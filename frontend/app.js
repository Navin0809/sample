const API = "http://localhost:3000"
const SOCKET_URL = "http://localhost:3000"

let socket = null
let currentChat = null  // username of currently open conversation

/* ── Token helpers ── */
function saveToken(token) { localStorage.setItem("token", token) }
function getToken()       { return localStorage.getItem("token") }

/* ── UI helpers ── */
function showToast(msg, type = "success") {
  const t = document.getElementById("toast")
  if (!t) return
  t.textContent = msg
  t.className = `toast ${type} show`
  setTimeout(() => t.classList.remove("show"), 3000)
}

function showError(msg) {
  const el = document.getElementById("error-msg")
  if (!el) return
  el.textContent = msg
  el.classList.add("visible")
}

function showSuccess(msg) {
  const el = document.getElementById("success-msg")
  if (!el) return
  el.textContent = msg
  el.classList.add("visible")
}

function clearMessages() {
  ["error-msg", "success-msg"].forEach(id => {
    const el = document.getElementById(id)
    if (el) el.classList.remove("visible")
  })
}

function setLoading(selector, loading) {
  const btn = document.querySelector(selector)
  if (!btn) return
  loading ? btn.classList.add("loading") : btn.classList.remove("loading")
}

/* ── Register ── */
async function register() {
  const username = document.getElementById("username").value.trim()
  const password = document.getElementById("password").value
  clearMessages()
  if (!username || !password) { showError("Please fill in all fields."); return }
  setLoading(".btn-submit", true)
  try {
    const res  = await fetch(API + "/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    })
    const data = await res.json()
    if (!res.ok) { showError(data.message || "Registration failed."); return }
    showSuccess("Account created! Redirecting…")
    setTimeout(() => window.location.href = "login.html", 1500)
  } catch {
    showError("Could not reach the server.")
  } finally {
    setLoading(".btn-submit", false)
  }
}

/* ── Login ── */
async function login() {
  const username = document.getElementById("username").value.trim()
  const password = document.getElementById("password").value
  clearMessages()
  if (!username || !password) { showError("Please enter your username and password."); return }
  setLoading(".btn-submit", true)
  try {
    const res  = await fetch(API + "/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    })
    const data = await res.json()
    if (!res.ok || !data.token) { showError(data.message || "Invalid username or password."); return }
    saveToken(data.token)
    window.location.href = "chat.html"
  } catch {
    showError("Could not reach the server.")
  } finally {
    setLoading(".btn-submit", false)
  }
}

/* ── Init socket ── */
function initSocket() {
  const token = getToken()
  if (!token) return

  socket = io(SOCKET_URL, { auth: { token } })

  socket.on("connect", () => {
    console.log("Socket connected")
  })

  socket.on("receive_message", (message) => {
    // If chat with this person is open, append message
    if (currentChat === message.from) {
      appendMessage(message, false)
      scrollToBottom()
    } else {
      // Show unread badge on sidebar
      incrementUnreadBadge(message.from)
      showToast(`New message from ${message.from}`, "success")
    }
  })

  socket.on("message_sent", (message) => {
    appendMessage(message, true)
    scrollToBottom()
  })

  socket.on("user_online", ({ username }) => {
    setOnlineStatus(username, true)
  })

  socket.on("user_offline", ({ username }) => {
    setOnlineStatus(username, false)
  })

  socket.on("disconnect", () => {
    console.log("Socket disconnected")
  })
}

/* ── Send message ── */
function sendMessage() {
  const input = document.getElementById("message-input")
  if (!input) return
  const content = input.value.trim()
  if (!content || !currentChat || !socket) return
  socket.emit("send_message", { to: currentChat, content })
  input.value = ""
  input.style.height = "auto"
}

/* ── Append message bubble ── */
function appendMessage(message, isMine) {
  const container = document.getElementById("messages")
  if (!container) return

  const div = document.createElement("div")
  div.className = `bubble ${isMine ? "mine" : "theirs"}`

  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit"
  })

  div.innerHTML = `
    <div class="bubble-content">${escapeHtml(message.content)}</div>
    <div class="bubble-time">${time}</div>
  `
  container.appendChild(div)
}

/* ── Escape HTML ── */
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/* ── Scroll chat to bottom ── */
function scrollToBottom() {
  const container = document.getElementById("messages")
  if (container) container.scrollTop = container.scrollHeight
}

/* ── Open conversation ── */
async function openChat(username) {
  currentChat = username

  // Highlight active in sidebar
  document.querySelectorAll(".contact-item").forEach(el => {
    el.classList.toggle("active", el.dataset.username === username)
  })

  // Clear unread badge
  clearUnreadBadge(username)

  // Update chat header
  const header = document.getElementById("chat-header-name")
  if (header) header.textContent = username

  const initEl = document.getElementById("chat-header-avatar")
  if (initEl) initEl.textContent = username.slice(0, 2).toUpperCase()

  // Show chat panel, hide empty state
  document.getElementById("empty-state").style.display  = "none"
  document.getElementById("chat-panel").style.display   = "flex"

  // Load messages
  const container = document.getElementById("messages")
  container.innerHTML = `<div class="msg-loading">Loading…</div>`

  try {
    const res      = await fetch(API + "/messages/" + username, {
      headers: { "Authorization": "Bearer " + getToken() }
    })
    const messages = await res.json()
    container.innerHTML = ""
    if (!messages.length) {
      container.innerHTML = `<div class="msg-empty">Say hello ✦</div>`
    } else {
      const me = getMyUsername()
      messages.forEach(m => appendMessage(m, m.from === me))
    }
    scrollToBottom()
  } catch {
    container.innerHTML = `<div class="msg-empty">Could not load messages.</div>`
  }
}

/* ── Load contacts (connected users) ── */
async function loadContacts() {
  const container = document.getElementById("contacts")
  if (!container) return

  try {
    const res   = await fetch(API + "/users", {
      headers: { "Authorization": "Bearer " + getToken() }
    })
    const users = await res.json()

    // Get unread counts
    const unreadRes    = await fetch(API + "/messages/unread/counts", {
      headers: { "Authorization": "Bearer " + getToken() }
    })
    const unreadCounts = await unreadRes.json()

    // Only show accepted connections
    const connected = users.filter(u => u.connection && u.connection.status === "accepted")

    if (!connected.length) {
      container.innerHTML = `
        <div class="contacts-empty">
          No connections yet.<br>
          <a href="people.html">Find people →</a>
        </div>`
      return
    }

    container.innerHTML = connected.map(u => {
      const initials = u.username.slice(0, 2).toUpperCase()
      const unread   = unreadCounts[u.username] || 0
      return `
        <div class="contact-item" data-username="${u.username}" onclick="openChat('${u.username}')">
          <div class="contact-avatar">
            ${initials}
            <span class="online-dot" id="dot-${u.username}"></span>
          </div>
          <div class="contact-info">
            <span class="contact-name">${u.username}</span>
          </div>
          ${unread ? `<span class="unread-badge" id="badge-${u.username}">${unread}</span>` : `<span class="unread-badge" id="badge-${u.username}" style="display:none">${unread}</span>`}
        </div>`
    }).join("")

  } catch {
    container.innerHTML = `<div class="contacts-empty">Could not load contacts.</div>`
  }
}

/* ── Unread badge helpers ── */
function incrementUnreadBadge(username) {
  const badge = document.getElementById(`badge-${username}`)
  if (!badge) return
  const current = parseInt(badge.textContent) || 0
  badge.textContent = current + 1
  badge.style.display = "flex"
}

function clearUnreadBadge(username) {
  const badge = document.getElementById(`badge-${username}`)
  if (!badge) return
  badge.textContent = "0"
  badge.style.display = "none"
}

/* ── Online status ── */
function setOnlineStatus(username, online) {
  const dot = document.getElementById(`dot-${username}`)
  if (!dot) return
  dot.classList.toggle("online", online)
}

/* ── Get my username from token ── */
function getMyUsername() {
  try {
    return JSON.parse(atob(getToken().split(".")[1])).username
  } catch { return "" }
}

/* ── Pending badge ── */
async function loadPendingBadge() {
  try {
    const res     = await fetch(API + "/connect/pending", {
      headers: { "Authorization": "Bearer " + getToken() }
    })
    const pending = await res.json()
    const badge   = document.getElementById("pending-badge")
    if (!badge) return
    if (pending.length > 0) {
      badge.textContent = pending.length
      badge.style.display = "flex"
    } else {
      badge.style.display = "none"
    }
  } catch {}
}

/* ── Load users (people page) ── */
async function loadUsers() {
  const container = document.getElementById("users-list")
  if (!container) return
  container.innerHTML = `<div class="state-msg"><span class="state-icon">…</span>Finding people</div>`
  try {
    const res   = await fetch(API + "/users", {
      headers: { "Authorization": "Bearer " + getToken() }
    })
    const users = await res.json()
    if (!users.length) {
      container.innerHTML = `<div class="state-msg"><span class="state-icon">∅</span>No other users yet.</div>`
      return
    }
    container.innerHTML = users.map(u => {
      const conn = u.connection
      let actionHTML = ""
      if (!conn) {
        actionHTML = `<button class="btn-connect" onclick="sendRequest('${u.username}')">Connect</button>`
      } else if (conn.status === "pending" && conn.direction === "sent") {
        actionHTML = `<span class="conn-badge pending">Pending</span>`
      } else if (conn.status === "pending" && conn.direction === "received") {
        actionHTML = `
          <button class="btn-connect accept" onclick="respondRequest('${u.username}','accepted')">Accept</button>
          <button class="btn-connect reject"  onclick="respondRequest('${u.username}','rejected')">Decline</button>`
      } else if (conn.status === "accepted") {
        actionHTML = `<span class="conn-badge accepted">✦ Connected</span>`
      } else if (conn.status === "rejected") {
        actionHTML = `<span class="conn-badge rejected">Declined</span>`
      }
      const initials = u.username.slice(0, 2).toUpperCase()
      return `
        <div class="user-card">
          <div class="user-avatar">${initials}</div>
          <span class="user-name">${u.username}</span>
          <div class="user-actions">${actionHTML}</div>
        </div>`
    }).join("")
  } catch {
    container.innerHTML = `<div class="state-msg"><span class="state-icon">∅</span>Could not reach the server.</div>`
  }
}

/* ── Send connection request ── */
async function sendRequest(to) {
  try {
    const res  = await fetch(API + "/connect/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + getToken() },
      body: JSON.stringify({ to })
    })
    const data = await res.json()
    showToast(data.message, res.ok ? "success" : "error")
    if (res.ok) loadUsers()
  } catch {
    showToast("Could not reach the server.", "error")
  }
}

/* ── Respond to connection request ── */
async function respondRequest(from, action) {
  try {
    const res  = await fetch(API + "/connect/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + getToken() },
      body: JSON.stringify({ from, action })
    })
    const data = await res.json()
    showToast(data.message, res.ok ? "success" : "error")
    if (res.ok) { loadUsers(); loadPendingBadge() }
  } catch {
    showToast("Could not reach the server.", "error")
  }
}

/* ── Logout ── */
function logout() {
  if (socket) socket.disconnect()
  localStorage.removeItem("token")
  window.location.href = "login.html"
}