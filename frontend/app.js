const API = "http://localhost:3000"

/* ── Token helpers ── */
function saveToken(token) {
  localStorage.setItem("token", token)
}

function getToken() {
  return localStorage.getItem("token")
}

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
    window.location.href = "blogs.html"
  } catch {
    showError("Could not reach the server.")
  } finally {
    setLoading(".btn-submit", false)
  }
}

/* ── Create blog ── */
async function createBlog() {
  const title   = document.getElementById("title").value.trim()
  const content = document.getElementById("content").value.trim()

  if (!title || !content) { showToast("Title and content are required.", "error"); return }

  setLoading(".btn-post", true)
  try {
    const res  = await fetch(API + "/blog", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + getToken()
      },
      body: JSON.stringify({ title, content })
    })
    const data = await res.json()
    if (!res.ok) { showToast(data.message || "Failed to publish.", "error"); return }

    document.getElementById("title").value   = ""
    document.getElementById("content").value = ""
    const tc = document.getElementById("title-count")
    const cc = document.getElementById("content-count")
    if (tc) tc.textContent = "0 / 120"
    if (cc) cc.textContent = "0 / 1000"

    showToast("Memory saved ✦", "success")
    loadBlogs()
  } catch {
    showToast("Could not reach the server.", "error")
  } finally {
    setLoading(".btn-post", false)
  }
}

/* ── Load blogs ── */
async function loadBlogs() {
  const container = document.getElementById("blogs")
  if (!container) return

  container.innerHTML = `
    <div class="state-msg">
      <span class="state-icon">…</span>
      Loading memories
    </div>`

  try {
    const res   = await fetch(API + "/blogs", {
      headers: { "Authorization": "Bearer " + getToken() }
    })
    const blogs = await res.json()

    if (!res.ok) {
      container.innerHTML = `<div class="state-msg"><span class="state-icon">∅</span>Could not load posts.</div>`
      return
    }

    if (!blogs.length) {
      container.innerHTML = `<div class="state-msg"><span class="state-icon">✦</span>No memories yet. Write the first one.</div>`
      return
    }

    container.innerHTML = blogs.map((b, i) => {
      const initials = (b.author || "?").slice(0, 2).toUpperCase()
      const date = b.createdAt
        ? new Date(b.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        : ""
      return `
        <div class="blog-card" style="animation-delay:${i * 60}ms">
          <div class="blog-card-meta">
            <div class="blog-avatar">${initials}</div>
            <span class="blog-author">${b.author || "Anonymous"}</span>
            ${date ? `<span class="blog-dot"></span><span class="blog-date">${date}</span>` : ""}
          </div>
          <h4>${b.title}</h4>
          <p>${b.content}</p>
        </div>`
    }).join("")

  } catch {
    container.innerHTML = `<div class="state-msg"><span class="state-icon">∅</span>Could not reach the server.</div>`
  }
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
          <button class="btn-connect reject" onclick="respondRequest('${u.username}','rejected')">Decline</button>`
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
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + getToken()
      },
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
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + getToken()
      },
      body: JSON.stringify({ from, action })
    })
    const data = await res.json()
    showToast(data.message, res.ok ? "success" : "error")
    if (res.ok) { loadUsers(); loadPendingBadge() }
  } catch {
    showToast("Could not reach the server.", "error")
  }
}

/* ── Pending badge in nav ── */
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

/* ── Logout ── */
function logout() {
  localStorage.removeItem("token")
  window.location.href = "login.html"
}