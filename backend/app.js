const cors      = require("cors")
const express   = require("express")
const http      = require("http")
const { Server } = require("socket.io")
const mongoose  = require("mongoose")
const bcrypt    = require("bcryptjs")
const jwt       = require("jsonwebtoken")

const app    = express()
const server = http.createServer(app)
const io     = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
})

app.use(express.json())
app.use(cors())

/* ── Environment ── */
const mongoURL  = process.env.MONGO_URL
const jwtSecret = process.env.JWT_SECRET

if (!mongoURL || !jwtSecret) {
  console.error("❌  Missing MONGO_URL or JWT_SECRET")
  process.exit(1)
}

/* ── Database ── */
mongoose.connect(mongoURL)
  .then(() => console.log("✅  MongoDB connected"))
  .catch(err => { console.error("❌  MongoDB error:", err.message); process.exit(1) })

/* ── User model ── */
const UserSchema = new mongoose.Schema({
  username:   { type: String, required: true, unique: true, trim: true },
  password:   { type: String, required: true },
  lastSeenAt: { type: Date, default: new Date(0) }
})
const User = mongoose.model("User", UserSchema)

/* ── Message model ── */
const MessageSchema = new mongoose.Schema({
  from:      { type: String, required: true },
  to:        { type: String, required: true },
  content:   { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  read:      { type: Boolean, default: false }
})
const Message = mongoose.model("Message", MessageSchema)

/* ── Connection model ── */
const ConnectionSchema = new mongoose.Schema({
  from:      { type: String, required: true },
  to:        { type: String, required: true },
  status:    { type: String, enum: ["pending", "accepted", "rejected"], default: "pending" },
  createdAt: { type: Date, default: Date.now }
})
const Connection = mongoose.model("Connection", ConnectionSchema)

/* ── Auth middleware ── */
function auth(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith("Bearer "))
    return res.status(401).json({ message: "No token provided" })
  try {
    req.user = jwt.verify(header.split(" ")[1], jwtSecret)
    next()
  } catch {
    res.status(401).json({ message: "Invalid or expired token" })
  }
}

/* ── Register ── */
app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body
    if (!username || !password)
      return res.status(400).json({ message: "Username and password are required" })
    if (username.trim().length < 3)
      return res.status(400).json({ message: "Username must be at least 3 characters" })
    if (password.length < 6)
      return res.status(400).json({ message: "Password must be at least 6 characters" })
    if (await User.findOne({ username: username.trim() }))
      return res.status(409).json({ message: "Username already taken" })

    const hash = await bcrypt.hash(password, 10)
    await new User({ username: username.trim(), password: hash }).save()
    res.status(201).json({ message: "User created" })
  } catch (err) {
    console.error("Register error:", err.message)
    res.status(500).json({ message: "Server error" })
  }
})

/* ── Login ── */
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body
    if (!username || !password)
      return res.status(400).json({ message: "Username and password are required" })

    const user = await User.findOne({ username: username.trim() })
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ message: "Invalid username or password" })

    const token = jwt.sign({ username: user.username }, jwtSecret, { expiresIn: "7d" })
    res.json({ token })
  } catch (err) {
    console.error("Login error:", err.message)
    res.status(500).json({ message: "Server error" })
  }
})

/* ── Get all users ── */
app.get("/users", auth, async (req, res) => {
  try {
    const me = req.user.username
    const connections = await Connection.find({ $or: [{ from: me }, { to: me }] })

    const statusMap = {}
    connections.forEach(c => {
      const other = c.from === me ? c.to : c.from
      statusMap[other] = { status: c.status, direction: c.from === me ? "sent" : "received" }
    })

    const users = await User.find({ username: { $ne: me } }, { username: 1, _id: 0 })
    res.json(users.map(u => ({ username: u.username, connection: statusMap[u.username] || null })))
  } catch (err) {
    res.status(500).json({ message: "Server error" })
  }
})

/* ── Connection routes ── */
app.post("/connect/request", auth, async (req, res) => {
  try {
    const { to } = req.body
    const from = req.user.username
    if (from === to) return res.status(400).json({ message: "Cannot connect with yourself" })
    if (await Connection.findOne({ $or: [{ from, to }, { from: to, to: from }] }))
      return res.status(409).json({ message: "Request already exists" })
    await new Connection({ from, to }).save()
    res.status(201).json({ message: "Request sent" })
  } catch (err) {
    res.status(500).json({ message: "Server error" })
  }
})

app.post("/connect/respond", auth, async (req, res) => {
  try {
    const { from, action } = req.body
    const to = req.user.username
    if (!["accepted", "rejected"].includes(action))
      return res.status(400).json({ message: "Invalid action" })
    const connection = await Connection.findOne({ from, to, status: "pending" })
    if (!connection) return res.status(404).json({ message: "Request not found" })
    connection.status = action
    await connection.save()
    res.json({ message: `Request ${action}` })
  } catch (err) {
    res.status(500).json({ message: "Server error" })
  }
})

app.get("/connect/pending", auth, async (req, res) => {
  try {
    const requests = await Connection.find({ to: req.user.username, status: "pending" })
    res.json(requests)
  } catch (err) {
    res.status(500).json({ message: "Server error" })
  }
})

/* ── Get messages between two users ── */
app.get("/messages/:with", auth, async (req, res) => {
  try {
    const me   = req.user.username
    const other = req.params.with

    // Verify they are connected
    const conn = await Connection.findOne({
      status: "accepted",
      $or: [{ from: me, to: other }, { from: other, to: me }]
    })
    if (!conn) return res.status(403).json({ message: "Not connected" })

    const messages = await Message.find({
      $or: [
        { from: me, to: other },
        { from: other, to: me }
      ]
    }).sort({ createdAt: 1 })

    // Mark messages from other as read
    await Message.updateMany(
      { from: other, to: me, read: false },
      { read: true }
    )

    res.json(messages)
  } catch (err) {
    res.status(500).json({ message: "Server error" })
  }
})

/* ── Get unread counts per conversation ── */
app.get("/messages/unread/counts", auth, async (req, res) => {
  try {
    const me = req.user.username
    const unread = await Message.aggregate([
      { $match: { to: me, read: false } },
      { $group: { _id: "$from", count: { $sum: 1 } } }
    ])
    const result = {}
    unread.forEach(u => result[u._id] = u.count)
    res.json(result)
  } catch (err) {
    res.status(500).json({ message: "Server error" })
  }
})

/* ── Socket.io — real-time messaging ── */
const onlineUsers = {} // username -> socketId

io.use((socket, next) => {
  const token = socket.handshake.auth.token
  if (!token) return next(new Error("No token"))
  try {
    socket.user = jwt.verify(token, jwtSecret)
    next()
  } catch {
    next(new Error("Invalid token"))
  }
})

io.on("connection", (socket) => {
  const username = socket.user.username
  onlineUsers[username] = socket.id
  console.log(`🟢 ${username} connected`)

  // Notify others this user is online
  socket.broadcast.emit("user_online", { username })

  // Send message
  socket.on("send_message", async ({ to, content }) => {
    if (!content || !to) return

    // Verify connection
    const conn = await Connection.findOne({
      status: "accepted",
      $or: [{ from: username, to }, { from: to, to: username }]
    })
    if (!conn) return

    const message = await new Message({ from: username, to, content }).save()

    // Send to recipient if online
    const recipientSocket = onlineUsers[to]
    if (recipientSocket) {
      io.to(recipientSocket).emit("receive_message", message)
    }

    // Confirm to sender
    socket.emit("message_sent", message)
  })

  socket.on("disconnect", () => {
    delete onlineUsers[username]
    socket.broadcast.emit("user_offline", { username })
    console.log(`🔴 ${username} disconnected`)
  })
})

/* ── Start ── */
server.listen(3000, () => {
  console.log("🚀  Server running on http://localhost:3000")
})