const cors      = require("cors")
const express   = require("express")
const mongoose  = require("mongoose")
const bcrypt    = require("bcryptjs")
const jwt       = require("jsonwebtoken")

const app = express()
app.use(express.json())
app.use(cors())

/* ── Environment ── */
const mongoURL  = process.env.MONGO_URL
const jwtSecret = process.env.JWT_SECRET

if (!mongoURL || !jwtSecret) {
  console.error("❌  Missing MONGO_URL or JWT_SECRET in environment")
  process.exit(1)
}

/* ── Database ── */
mongoose.connect(mongoURL)
  .then(() => console.log("✅  MongoDB connected"))
  .catch(err => {
    console.error("❌  MongoDB connection failed:", err.message)
    process.exit(1)
  })

/* ── User model ── */
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true }
})
const User = mongoose.model("User", UserSchema)

/* ── Blog model ── */
const BlogSchema = new mongoose.Schema({
  title:     { type: String, required: true, trim: true },
  content:   { type: String, required: true },
  author:    { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
})
const Blog = mongoose.model("Blog", BlogSchema)

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
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No token provided" })
  }
  const token = header.split(" ")[1]
  try {
    const decoded = jwt.verify(token, jwtSecret)
    req.user = decoded
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

    const existing = await User.findOne({ username: username.trim() })
    if (existing)
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
    if (!user)
      return res.status(401).json({ message: "Invalid username or password" })

    const valid = await bcrypt.compare(password, user.password)
    if (!valid)
      return res.status(401).json({ message: "Invalid username or password" })

    const token = jwt.sign({ username: user.username }, jwtSecret, { expiresIn: "7d" })
    res.json({ token })
  } catch (err) {
    console.error("Login error:", err.message)
    res.status(500).json({ message: "Server error" })
  }
})

/* ── Get all users except self ── */
app.get("/users", auth, async (req, res) => {
  try {
    const me = req.user.username

    // Get all connections involving me
    const connections = await Connection.find({
      $or: [{ from: me }, { to: me }]
    })

    // Build status map: username -> status
    const statusMap = {}
    connections.forEach(c => {
      const other = c.from === me ? c.to : c.from
      statusMap[other] = { status: c.status, direction: c.from === me ? "sent" : "received" }
    })

    const users = await User.find(
      { username: { $ne: me } },
      { username: 1, _id: 0 }
    )

    const result = users.map(u => ({
      username: u.username,
      connection: statusMap[u.username] || null
    }))

    res.json(result)
  } catch (err) {
    console.error("Get users error:", err.message)
    res.status(500).json({ message: "Server error" })
  }
})

/* ── Send connection request ── */
app.post("/connect/request", auth, async (req, res) => {
  try {
    const { to } = req.body
    const from = req.user.username

    if (from === to)
      return res.status(400).json({ message: "Cannot connect with yourself" })

    const existing = await Connection.findOne({
      $or: [{ from, to }, { from: to, to: from }]
    })
    if (existing)
      return res.status(409).json({ message: "Request already exists" })

    await new Connection({ from, to }).save()
    res.status(201).json({ message: "Request sent" })
  } catch (err) {
    console.error("Connect request error:", err.message)
    res.status(500).json({ message: "Server error" })
  }
})

/* ── Accept or reject request ── */
app.post("/connect/respond", auth, async (req, res) => {
  try {
    const { from, action } = req.body
    const to = req.user.username

    if (!["accepted", "rejected"].includes(action))
      return res.status(400).json({ message: "Invalid action" })

    const connection = await Connection.findOne({ from, to, status: "pending" })
    if (!connection)
      return res.status(404).json({ message: "Request not found" })

    connection.status = action
    await connection.save()
    res.json({ message: `Request ${action}` })
  } catch (err) {
    console.error("Connect respond error:", err.message)
    res.status(500).json({ message: "Server error" })
  }
})

/* ── Get pending incoming requests ── */
app.get("/connect/pending", auth, async (req, res) => {
  try {
    const requests = await Connection.find({
      to: req.user.username,
      status: "pending"
    })
    res.json(requests)
  } catch (err) {
    res.status(500).json({ message: "Server error" })
  }
})

/* ── Create blog ── */
app.post("/blog", auth, async (req, res) => {
  try {
    const { title, content } = req.body
    if (!title || !content)
      return res.status(400).json({ message: "Title and content are required" })
    if (title.trim().length < 3)
      return res.status(400).json({ message: "Title must be at least 3 characters" })

    const blog = new Blog({
      title:   title.trim(),
      content: content.trim(),
      author:  req.user.username
    })
    await blog.save()
    res.status(201).json(blog)
  } catch (err) {
    console.error("Create blog error:", err.message)
    res.status(500).json({ message: "Server error" })
  }
})

/* ── Get blogs — only from self + accepted connections ── */
app.get("/blogs", auth, async (req, res) => {
  try {
    const me = req.user.username
    const connections = await Connection.find({
      status: "accepted",
      $or: [{ from: me }, { to: me }]
    })
    const allowedUsers = [
      me,
      ...connections.map(c => c.from === me ? c.to : c.from)
    ]
    const blogs = await Blog.find({
      author: { $in: allowedUsers }
    }).sort({ createdAt: -1 })

    res.json(blogs)
  } catch (err) {
    console.error("Load blogs error:", err.message)
    res.status(500).json({ message: "Server error" })
  }
})

/* ── Start ── */
app.listen(3000, () => {
  console.log("🚀  Server running on http://localhost:3000")
})