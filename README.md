# FinancePro — Personal Finance Management System

A professional, full-stack Personal Finance Management System built with **Node.js, Express, MySQL, and Vanilla JavaScript ES6+**. Designed as a production-ready SaaS-style application suitable for a Junior Full-Stack Developer / Data Analyst portfolio.

## Features

- **User Dashboard** — Total balance, income, expense, monthly stats, savings rate
- **Transaction Management** — Full CRUD with search, filter, sort, pagination
- **Analytics & Charts** — Income vs Expense, Expense by Category, Cash Flow, Trends (Chart.js)
- **Admin Dashboard** — System overview, user management, category management, activity logs
- **CSV Import/Export** — Bulk import transactions, export all data (Admin only)
- **Authentication** — JWT-based, login with email or phone, bcrypt password hashing
- **Authorization** — Role-based (ADMIN/USER), backend-enforced, no client-side trust
- **Security** — Helmet, CORS, rate limiting, input validation, SQL injection prevention
- **Responsive Design** — Mobile-first CSS supporting 320px to 2560px
- **Activity Logging** — Tracks login, logout, CRUD, admin actions, import/export
- **Dark Mode** — Toggle between light and dark themes

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | HTML5, CSS3, Vanilla JS ES6+, Chart.js, Fetch API |
| **Backend** | Node.js, Express.js, JWT, bcryptjs, Helmet, CORS, express-validator, multer, express-rate-limit |
| **Database** | MySQL 8.0+, mysql2 (parameterized queries) |
| **Dev** | npm, nodemon, dotenv |

## Project Structure

```
personal-finance-dashboard/
├── frontend/
│   ├── index.html              # Landing page
│   ├── login.html              # Login page
│   ├── register.html          # Registration page
│   ├── dashboard.html         # User dashboard
│   ├── transactions.html      # Transaction management
│   ├── charts.html            # Analytics page
│   ├── admin.html             # Admin panel
│   ├── profile.html           # User profile
│   ├── css/
│   │   ├── style.css          # Main stylesheet
│   │   ├── components.css     # UI components
│   │   └── responsive.css     # Responsive breakpoints
│   └── js/
│       ├── config.js          # API base URL, constants
│       ├── utils.js            # Formatting & helpers
│       ├── api.js              # REST API client
│       ├── auth.js             # Auth & route guards
│       ├── components.js       # Toast, modal, sidebar
│       ├── charts.js            # Chart.js renderers
│       ├── dashboard.js         # Dashboard logic
│       ├── transactions.js     # Transactions logic
│       ├── admin.js             # Admin panel logic
│       └── profile.js           # Profile logic
│
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── db.js            # MySQL connection pool
│   │   │   └── response.js      # Standardized responses
│   │   ├── middleware/
│   │   │   ├── auth.js          # JWT auth & RBAC
│   │   │   ├── validate.js      # Express validator
│   │   │   ├── errorHandler.js  # Centralized errors
│   │   │   └── activityLog.js   # Activity logging
│   │   ├── routes/
│   │   │   ├── auth.js          # Auth endpoints
│   │   │   ├── transactions.js  # Transaction CRUD
│   │   │   ├── categories.js    # Category CRUD
│   │   │   ├── dashboard.js     # Dashboard stats
│   │   │   ├── admin.js         # Admin endpoints
│   │   │   └── csv.js           # CSV import/export
│   │   ├── validators/
│   │   │   ├── auth.js
│   │   │   ├── transaction.js
│   │   │   ├── category.js
│   │   │   └── user.js
│   │   └── server.js            # Express app entry
│   ├── database/
│   │   ├── schema.sql           # DB schema & seed categories
│   │   └── seed.js              # DB init & admin seeder
│   ├── uploads/                 # CSV upload temp
│   ├── package.json
│   ├── .env.example
│   └── .env                     # (gitignored)
│
├── .gitignore
└── README.md
```

## Requirements

- **Node.js** v16+ 
- **MySQL** 8.0+ (or MariaDB 10.5+)
- npm

## Installation

### 1. Clone & Install Backend

```bash
cd backend
npm install
```

### 2. MySQL Setup

Ensure MySQL is running on `localhost:3306`.

The seed script will auto-create the database and tables. Just make sure your MySQL credentials are correct in `.env`.

### 3. Environment Setup

Copy the example env file and fill in values:

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env`:

```env
PORT=3000
NODE_ENV=development

DB_HOST=localhost
DB_PORT=3306
DB_NAME=personal_finance
DB_USER=root
DB_PASSWORD=your_mysql_password

JWT_SECRET=change_this_to_a_random_secret
JWT_EXPIRES_IN=7d

ADMIN_EMAIL=vayneyudha@gmail.com
ADMIN_PASSWORD=YourSecurePassword

FRONTEND_URL=http://localhost:8080
```

> **IMPORTANT**: Set `ADMIN_PASSWORD` to a secure password (min 8 characters). This password is only stored in `.env` (gitignored) and is hashed with bcrypt before database storage. It is never exposed in frontend code, API responses, or the database schema.

### 4. Seed Database & Create Admin

```bash
cd backend
npm run seed
```

This will:
1. Create the `personal_finance` database
2. Create all tables (users, categories, transactions, activity_logs)
3. Seed 13 default categories (Income & Expense)
4. Create the primary ADMIN account from `ADMIN_EMAIL` and `ADMIN_PASSWORD`
5. Hash the admin password with bcrypt
6. Skip if admin already exists (no duplicates)

### 5. Start Backend

```bash
cd backend
npm run dev    # Development (with nodemon auto-reload)
# or
npm start      # Production
```

Backend runs on `http://localhost:3000`.

### 6. Start Frontend

The frontend is pure HTML/CSS/JS — serve it with any static server:

```bash
# Option A: npx serve
npx serve frontend -p 8080

# Option B: Python
cd frontend && python -m http.server 8080

# Option C: VS Code Live Server extension
# Right-click frontend/index.html → Open with Live Server
```

Frontend runs on `http://localhost:8080`.

## Admin Account

The primary admin account is created automatically by the seed system:

- **Email**: `vayneyudha@gmail.com`
- **Password**: Set via `ADMIN_PASSWORD` in `backend/.env`

Login at `http://localhost:8080/login.html`.

## Registration

- Open `http://localhost:8080/register.html`
- Fill in: Name, Email, Phone, Password, Confirm Password
- All new registrations are automatically assigned `USER` role
- Users cannot choose or change their role

## API Reference

### Auth
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | Public | Register new user (USER role) |
| POST | `/api/auth/login` | Public | Login with email or phone |
| POST | `/api/auth/logout` | JWT | Logout |
| GET | `/api/auth/me` | JWT | Get current user |
| PUT | `/api/auth/profile` | JWT | Update profile |
| PUT | `/api/auth/change-password` | JWT | Change password |

### Transactions
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/transactions` | JWT | List (paginated, filtered) |
| POST | `/api/transactions` | JWT | Create |
| GET | `/api/transactions/:id` | JWT | Get single |
| PUT | `/api/transactions/:id` | JWT | Update (owner/admin) |
| DELETE | `/api/transactions/:id` | JWT | Delete (owner/admin) |

### Categories
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/categories` | JWT | List all |
| POST | `/api/categories` | Admin | Create |
| PUT | `/api/categories/:id` | Admin | Update |
| DELETE | `/api/categories/:id` | Admin | Delete |

### Dashboard
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/dashboard` | JWT | User stats & chart data |

### Admin
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/admin/dashboard` | Admin | System overview |
| GET | `/api/admin/users` | Admin | List users (paginated) |
| GET | `/api/admin/users/:id` | Admin | User detail |
| PUT | `/api/admin/users/:id` | Admin | Update user |
| DELETE | `/api/admin/users/:id` | Admin | Delete user |
| GET | `/api/admin/transactions` | Admin | All transactions |
| GET | `/api/admin/activity-logs` | Admin | Activity logs |

### CSV Import/Export
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/csv/export` | Admin | Export all transactions |
| GET | `/api/csv/template` | Admin | Download CSV template |
| POST | `/api/csv/import` | Admin | Import CSV (multipart) |

### Response Format

**Success:**
```json
{
  "success": true,
  "message": "Success",
  "data": { ... }
}
```

**Error:**
```json
{
  "success": false,
  "message": "Error description",
  "errors": [{ "field": "name", "message": "..." }]
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | OK |
| 201 | Created |
| 400 | Bad Request |
| 401 | Unauthorized (not logged in / token expired) |
| 403 | Forbidden (insufficient role) |
| 404 | Not Found |
| 409 | Conflict (duplicate) |
| 422 | Validation Error |
| 500 | Internal Server Error |

## Authentication & Authorization

- **JWT** tokens with 7-day expiry
- Tokens stored in `localStorage` on frontend
- Sent as `Authorization: Bearer <token>` header
- **Role-based access control** (RBAC):
  - `USER`: Can only access their own transactions, profile, dashboard
  - `ADMIN`: Full system access, user management, all transactions, CSV import/export, activity logs
- Backend **always** verifies ownership — users cannot access other users' transactions
- If a USER calls an Admin API → **HTTP 403**
- If unauthenticated → **HTTP 401**
- Role is never trusted from the frontend — always read from JWT payload

## Security

- **bcrypt** password hashing (10 rounds)
- **JWT** authentication with secret key
- **Helmet** security headers
- **CORS** configured for frontend origin
- **Rate limiting** (500 requests / 15 min per IP)
- **express-validator** input validation on all routes
- **Parameterized queries** (mysql2) — SQL injection prevention
- **XSS prevention** — HTML escaping in frontend
- **Password never sent to frontend** — `password_hash` excluded from all API responses
- **No plaintext password storage** — bcrypt only
- **Admin password in .env only** — never in code, schema, or Git
- **Upload validation** — CSV only, 5MB max
- **Centralized error handling** — no raw database errors exposed

## Database Schema

### users
| Column | Type | Notes |
|--------|------|-------|
| id | INT AUTO_INCREMENT | PK |
| name | VARCHAR(100) | NOT NULL |
| email | VARCHAR(255) | UNIQUE, NOT NULL |
| phone | VARCHAR(20) | UNIQUE |
| password_hash | VARCHAR(255) | bcrypt hash |
| role | ENUM('ADMIN','USER') | Default USER |
| status | ENUM('ACTIVE','INACTIVE') | Default ACTIVE |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | Auto-update |

### categories
| Column | Type | Notes |
|--------|------|-------|
| id | INT AUTO_INCREMENT | PK |
| name | VARCHAR(50) | NOT NULL |
| type | ENUM('Income','Expense') | NOT NULL |
| description | VARCHAR(200) | |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

### transactions
| Column | Type | Notes |
|--------|------|-------|
| id | INT AUTO_INCREMENT | PK |
| user_id | INT | FK → users(id) |
| category_id | INT | FK → categories(id) |
| type | ENUM('Income','Expense') | NOT NULL |
| amount | DECIMAL(15,2) | NOT NULL, no float |
| description | VARCHAR(200) | NOT NULL |
| transaction_date | DATE | NOT NULL |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

### activity_logs
| Column | Type | Notes |
|--------|------|-------|
| id | INT AUTO_INCREMENT | PK |
| user_id | INT | FK → users(id), nullable |
| action | VARCHAR(100) | NOT NULL |
| description | VARCHAR(500) | |
| ip_address | VARCHAR(45) | |
| created_at | TIMESTAMP | |

## Import/Export

### Export
- Admin → Import/Export page → Click Export
- Downloads `transactions_export.csv` with all transactions

### Import
- Admin → Import/Export page → Upload CSV file
- CSV columns: `transaction_date,type,category,description,amount`
- Each row validated:
  - Date must be valid YYYY-MM-DD
  - Type must be Income or Expense
  - Category must exist for the given type
  - Amount must be > 0
- Invalid rows are reported but don't block valid rows
- Shows count of imported + errors

### CSV Template
Download from `/api/csv/template` or create manually:
```csv
transaction_date,type,category,description,amount
2025-01-15,Income,Gaji,Gaji Januari,5000000
2025-01-16,Expense,Makanan,Makan siang,50000
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Cannot connect to MySQL | Ensure MySQL is running, check DB_USER/DB_PASSWORD in .env |
| Seed fails: ADMIN_PASSWORD not found | Set ADMIN_PASSWORD in backend/.env (min 8 chars) |
| 401 Unauthorized | Token expired — login again |
| 403 Forbidden | User accessing admin API — only ADMIN role allowed |
| CORS error | Ensure FRONTEND_URL in .env matches your frontend port |
| "Cannot connect to server" | Backend not running — `cd backend && npm run dev` |
| Charts empty | No transactions yet — add some transactions first |

## NPM Scripts

```bash
cd backend
npm install          # Install dependencies
npm run dev          # Start dev server (nodemon)
npm start            # Start production server
npm run seed         # Initialize database & create admin
npm run migrate      # Same as seed
npm test             # Run seed verification
```

## Future Improvements

- [ ] Budget management with limits and alerts
- [ ] Recurring transactions
- [ ] Email notifications
- [ ] Multi-currency support
- [ ] Mobile app (React Native)
- [ ] Advanced analytics with date range comparison
- [ ] Two-factor authentication (2FA)
- [ ] API documentation with Swagger/OpenAPI
- [ ] Unit & integration tests with Jest
- [ ] Docker containerization

## License

MIT License — Free to use for portfolio and educational purposes.

---

Built as a portfolio project for Junior Full-Stack Developer / Data Analyst.
