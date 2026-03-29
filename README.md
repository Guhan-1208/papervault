# PaperVault — Question Paper Portal

A full-stack web app for college students to upload and browse previous year exam question papers, with admin moderation.

---

## Architecture

```
papervault-app/
├── index.html      ← Frontend (single HTML file, no build needed)
├── server.js       ← Node.js + Express REST API
├── package.json
├── papervault.db   ← SQLite database (auto-created on first run)
└── uploads/        ← PDF files (auto-created on first run)
```

---

## Quick Start

### 1. Install dependencies

```bash
cd papervault-app
npm install
```

### 2. Start the backend

```bash
npm start
# or for auto-reload during development:
npm run dev
```

API runs at: `http://localhost:4000`

### 3. Open the frontend

Open `index.html` directly in your browser, **or** serve it from any static host (Nginx, GitHub Pages, Netlify).

> The frontend currently uses `localStorage` as a demo backend.  
> To connect it to the real Node.js API, replace the data functions in `index.html` with `fetch()` calls (see API Reference below).

---

## Default Accounts



Students register themselves via the Register tab.

---

## Features

### Students
- Register / Login with JWT auth
- Browse approved question papers with filters (department, year, semester)
- Upload PDF papers (submitted as **pending**, await admin review)
- Track their own uploads and statuses in "My Uploads"

### Admins
- **Pending Review tab** — preview, approve, or reject each submission
- **All Papers tab** — manage all papers (approve / reject / delete)
- **Users tab** — view all registered users and their upload counts
- Dashboard stats (total, pending, approved, user count)

---

## API Reference

### Auth

| Method | Endpoint              | Auth     | Description          |
|--------|-----------------------|----------|----------------------|
| POST   | `/api/auth/register`  | None     | Register new student |
| POST   | `/api/auth/login`     | None     | Login, returns JWT   |
| GET    | `/api/auth/me`        | Bearer   | Get current user     |

**Register body:**
```json
{ "fname": "Ananya", "lname": "Sharma", "email": "a@college.edu", "password": "secret123", "dept": "CS" }
```

**Login body:**
```json
{ "email": "a@college.edu", "password": "secret123" }
```

---

### Papers (Public)

| Method | Endpoint                | Auth   | Description                        |
|--------|-------------------------|--------|------------------------------------|
| GET    | `/api/papers`           | None   | List approved papers (filterable)  |
| GET    | `/api/papers/filters`   | None   | Filter dropdown values             |
| GET    | `/api/papers/:id`       | None   | Get single approved paper          |

Query params for `GET /api/papers`: `dept`, `year`, `semester`, `q` (search)

---

### Papers (Student)

| Method | Endpoint         | Auth   | Description                |
|--------|------------------|--------|----------------------------|
| POST   | `/api/papers`    | Bearer | Upload paper (multipart)   |
| GET    | `/api/my/papers` | Bearer | My uploaded papers         |

**Upload (multipart/form-data):**
```
file        → PDF file (max 20 MB)
subject     → "Data Structures"
code        → "CS301" (optional)
dept        → "Computer Science"
semester    → "3"
year        → "2023"
exam_type   → "End Semester"
notes       → "..." (optional)
```

---

### Admin

| Method | Endpoint                          | Auth    | Description             |
|--------|-----------------------------------|---------|-------------------------|
| GET    | `/api/admin/papers`               | Admin   | All papers (all status) |
| PATCH  | `/api/admin/papers/:id/status`    | Admin   | Approve / Reject        |
| DELETE | `/api/admin/papers/:id`           | Admin   | Delete paper            |
| GET    | `/api/admin/users`                | Admin   | All users               |
| PATCH  | `/api/admin/users/:id/role`       | Admin   | Change user role        |
| GET    | `/api/admin/stats`                | Admin   | Dashboard stats         |

**Approve/Reject body:**
```json
{ "status": "approved" }   // or "rejected"
```

---

## Environment Variables

| Variable      | Default                  | Description               |
|---------------|--------------------------|---------------------------|
| `PORT`        | `4000`                   | Server port               |
| `JWT_SECRET`  | `changeme_in_production` | JWT signing secret ⚠️    |
| `FRONTEND_URL`| `*`                      | CORS allowed origin       |

Create a `.env` file:
```
PORT=4000
JWT_SECRET=your_super_secret_key_here
FRONTEND_URL=https://your-frontend.com
```

---

## Production Deployment

### Backend (Railway / Render / VPS)
1. Push code to GitHub
2. Set environment variables (`JWT_SECRET`, `FRONTEND_URL`)
3. Build command: `npm install`
4. Start command: `node server.js`

### File Storage (Production)
For production, replace local `multer` disk storage with **AWS S3** or **Cloudinary**:
- Install `@aws-sdk/client-s3` or `cloudinary`
- Use `multer-s3` or `multer-storage-cloudinary`
- Store `file_url` in DB instead of `file_path`

### Frontend
Deploy `index.html` to **Netlify**, **Vercel**, or **GitHub Pages**.  
Update the API base URL constant in the script section.

---

## Tech Stack

| Layer      | Technology                              |
|------------|-----------------------------------------|
| Frontend   | Vanilla HTML / CSS / JS (no build)      |
| Backend    | Node.js, Express 4                      |
| Database   | SQLite via `better-sqlite3`             |
| Auth       | JWT (`jsonwebtoken`) + bcrypt           |
| Files      | Multer (local disk)                     |
